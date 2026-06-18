/**
 * handlers/deleteHandler.js
 * Hard delete: archiva físicamente el registro en INDICE_MASTER (lo manda a papelera).
 * Restore: si la página se restaura en origen, llega como upsert y se crea de nuevo.
 */

const notion = require('../lib/notionClient');
const { writeLog } = require('../lib/logger');
const { findExisting } = require('./upsertHandler');

/**
 * Elimina físicamente el registro de INDICE_MASTER al recibir page.deleted o page.moved
 * hacia una base no conectada.
 * Entrada: pageId (string)
 * Salida: void
 */
const handleDelete = async (pageId) => {
  const startTime = Date.now();
  const existing = await findExisting(pageId);

  if (!existing) {
    console.log(`[INFO] delete sin registro en INDICE_MASTER: ${pageId}`);
    await writeLog({
      tipoEvento: 'ignored',
      pageId,
      resultado: 'OK',
      mensaje: 'delete sin registro en INDICE_MASTER',
      tiempoMs: Date.now() - startTime
    });
    return;
  }

  await notion.pages.update({
    page_id: existing.id,
    archived: true
  });

  console.log(`[ELIMINADO FISICO] pageId: ${pageId}`);
  await writeLog({
    tipoEvento: 'deleted',
    pageId,
    resultado: 'OK',
    mensaje: 'Eliminado físicamente de INDICE_MASTER',
    tiempoMs: Date.now() - startTime
  });
};

module.exports = { handleDelete };