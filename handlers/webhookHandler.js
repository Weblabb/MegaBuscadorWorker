/**
 * handlers/webhookHandler.js
 * Recibe el webhook de Notion, aplica filtros base y despacha al handler correspondiente.
 */

const lock = require('../lib/lock');
const { VALID_EVENT_TYPES } = require('../config');
const { handleUpsert } = require('./upsertHandler');
const { handleDelete, handleRestore } = require('./deleteHandler');

/**
 * Handler principal del POST /webhook.
 * Entrada: req, res de Express
 * Salida: HTTP 200 siempre (evita reintentos infinitos de Notion)
 */
const webhookHandler = async (req, res) => {
  // Verificación inicial del webhook (primera conexión)
  if (req.body.verification_token) {
    console.log('[VERIFICACION] Token:', req.body.verification_token);
    return res.status(200).json({ verification_token: req.body.verification_token });
  }

  const event = req.body;

  // Filtro 1: entidad válida
  if (!event.entity || !event.entity.id) {
    return res.status(200).send('OK');
  }

  // Filtro 2: solo páginas
  if (event.entity.type !== 'page') {
    console.log(`[IGNORADO] Entidad no es página. Tipo: ${event.entity.type}, Evento: ${event.type}`);
    return res.status(200).send('OK');
  }

  // Filtro 3: tipos de evento válidos
  if (!VALID_EVENT_TYPES.includes(event.type)) {
    console.log(`[IGNORADO] Evento no soportado: ${event.type}`);
    return res.status(200).send('OK');
  }

  const pageId = event.entity.id;

  // Lock anti-race
  if (!lock.acquire(pageId)) {
    console.log(`[LOCK] Evento descartado, pageId en proceso: ${pageId} | evento: ${event.type}`);
    return res.status(200).send('OK');
  }

  console.log(`[PROCESANDO] ${event.type} | pageId: ${pageId}`);

  try {
    // Dispatcher por tipo de evento
    switch (event.type) {
      case 'page.deleted':
        await handleDelete(pageId);
        break;
      case 'page.undeleted':
        await handleRestore(pageId);
        break;
      default:
        // page.created, page.properties_updated, page.content_updated, page.moved
        await handleUpsert(pageId);
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error(`[ERROR] pageId ${pageId}: ${error.message}`);
    if (error.code) console.error(`  code: ${error.code}, status: ${error.status}`);
    res.status(200).send('OK');
  } finally {
    lock.release(pageId);
  }
};

module.exports = webhookHandler;