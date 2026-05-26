/**
 * handlers/webhookHandler.js
 * Recibe el webhook de Notion, responde 200 OK inmediato y procesa en background.
 * Incluye reintentos automáticos (lib/retry.js) y logging de errores.
 */

const lock = require('../lib/lock');
const { writeLog } = require('../lib/logger');
const { withRetry } = require('../lib/retry');
const { VALID_EVENT_TYPES, INDICE_MASTER } = require('../config');
const { handleUpsert } = require('./upsertHandler');
const { handleDelete, handleRestore } = require('./deleteHandler');

/**
 * Procesa un evento en background.
 * Entrada: event (objeto del webhook de Notion)
 * Salida: void (no lanza errores hacia afuera)
 */
const processEventAsync = async (event) => {
  const pageId = event.entity.id;

  if (!lock.acquire(pageId)) {
    console.log(`[LOCK] Evento descartado, pageId en proceso: ${pageId} | evento: ${event.type}`);
    return;
  }

  console.log(`[PROCESANDO] ${event.type} | pageId: ${pageId}`);
  const startTime = Date.now();

  try {
    await withRetry(async () => {
      switch (event.type) {
        case 'page.deleted':
          await handleDelete(pageId);
          break;
        case 'page.undeleted':
          await handleRestore(pageId);
          break;
        default:
          await handleUpsert(pageId);
      }
    }, `${event.type} ${pageId}`);
  } catch (error) {
    console.error(`[ERROR DEFINITIVO] pageId ${pageId}: ${error.message}`);
    if (error.code) console.error(`  code: ${error.code}, status: ${error.status}`);

    await writeLog({
      tipoEvento: 'error',
      pageId,
      resultado: 'ERROR',
      mensaje: `${event.type}: ${error.message}`,
      tiempoMs: Date.now() - startTime
    });
  } finally {
    lock.release(pageId);
  }
};

/**
 * Handler principal del POST /webhook.
 * Responde 200 OK inmediato y delega el procesamiento a background.
 */
const webhookHandler = (req, res) => {
  // Verificación inicial del webhook
  if (req.body.verification_token) {
    console.log('[VERIFICACION] Token:', req.body.verification_token);
    return res.status(200).json({ verification_token: req.body.verification_token });
  }

  const event = req.body;
  const parentDataSourceId =
    event.data?.parent?.data_source_id ||
    event.entity?.parent?.data_source_id ||
    event.parent?.data_source_id;

  const ignoredDataSources = [
    INDICE_MASTER,
    process.env.DB_LOGS_WORKER
  ].filter(Boolean);

  // Filtros rápidos (responden 200 inmediato, sin procesar)
  if (parentDataSourceId && ignoredDataSources.includes(parentDataSourceId)) {
    return res.status(200).send('OK');
  }
  if (!event.entity || !event.entity.id) {
    return res.status(200).send('OK');
  }
  if (event.entity.type !== 'page') {
    return res.status(200).send('OK');
  }
  if (!VALID_EVENT_TYPES.includes(event.type)) {
    console.log(`[IGNORADO] Evento no soportado: ${event.type}`);
    return res.status(200).send('OK');
  }

  // Responder a Notion inmediato y procesar en background
  res.status(200).send('OK');
  setImmediate(() => {
    processEventAsync(event).catch(err => {
      console.error('[ERROR ASYNC]', err);
    });
  });
};

module.exports = webhookHandler;