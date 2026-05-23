/**
 * handlers/webhookHandler.js
 * Recibe el webhook de Notion, aplica filtros base y despacha al handler correspondiente.
 * Incluye reintentos automáticos y logging de errores.
 */

const lock = require('../lib/lock');
const { writeLog } = require('../lib/logger');
const { VALID_EVENT_TYPES, INDICE_MASTER } = require('../config');
const { handleUpsert } = require('./upsertHandler');
const { handleDelete, handleRestore } = require('./deleteHandler');

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Determina si un error es recuperable y vale la pena reintentar.
 */
const isRetryable = (error) => {
  const code = error.code || '';
  const message = error.message || '';
  return (
    code === 'notionhq_client_request_timeout' ||
    code === 'rate_limited' ||
    code === 'service_unavailable' ||
    message.includes('timeout') ||
    message.includes('ECONNRESET') ||
    message.includes('ETIMEDOUT')
  );
};

/**
 * Ejecuta una función async con reintentos automáticos.
 */
const withRetry = async (fn, context = '') => {
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === MAX_RETRIES) throw error;
      console.log(`[RETRY ${attempt}/${MAX_RETRIES}] ${context} - ${error.message}`);
      await sleep(RETRY_DELAY_MS * attempt);
    }
  }
  throw lastError;
};

/**
 * Handler principal del POST /webhook.
 */
const webhookHandler = async (req, res) => {
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

  const pageId = event.entity.id;

  if (!lock.acquire(pageId)) {
    console.log(`[LOCK] Evento descartado, pageId en proceso: ${pageId} | evento: ${event.type}`);
    return res.status(200).send('OK');
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

    res.status(200).send('OK');
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

    res.status(200).send('OK');
  } finally {
    lock.release(pageId);
  }
};

module.exports = webhookHandler;