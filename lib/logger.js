/**
 * lib/logger.js
 * Escribe eventos en la base LOGS_WORKER de Notion.
 * Si falla el logging, no rompe el flujo del Worker.
 */

const notion = require('./notionClient');

const LOGS_WORKER = process.env.DB_LOGS_WORKER;

/**
 * Escribe un evento en LOGS_WORKER.
 * Entrada: objeto con tipoEvento, pageId, baseOrigen, resultado, mensaje, tiempoMs
 * Salida: void (no lanza errores)
 */
const writeLog = async ({
  tipoEvento,
  pageId = '',
  baseOrigen = '',
  resultado = 'OK',
  mensaje = '',
  tiempoMs = 0
}) => {
  if (!LOGS_WORKER) return;

  try {
    const nombre = `[${resultado}] ${tipoEvento} ${pageId.slice(0, 8)}`;

    await notion.pages.create({
      parent: { data_source_id: LOGS_WORKER },
      properties: {
        'Nombre': { title: [{ text: { content: nombre } }] },
        'Fecha_Hora': { date: { start: new Date().toISOString() } },
        'Tipo_Evento': { select: { name: tipoEvento } },
        'PAGE_ID': { rich_text: [{ text: { content: pageId } }] },
        'Base_Origen': baseOrigen ? { select: { name: baseOrigen } } : undefined,
        'Resultado': { select: { name: resultado } },
        'Mensaje': { rich_text: [{ text: { content: mensaje.slice(0, 2000) } }] },
        'Tiempo_ms': { number: tiempoMs }
      }
    });
  } catch (err) {
    console.error(`[LOGGER] No se pudo escribir log: ${err.message}`);
  }
};

module.exports = { writeLog };