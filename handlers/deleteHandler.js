/**
 * handlers/deleteHandler.js
 * Hard delete: archiva físicamente el registro en INDICE_MASTER (lo manda a papelera).
 * Restore: si la página se restaura en origen, llega como upsert y se crea de nuevo.
 */

const notion = require('../lib/notionClient');
const { writeLog } = require('../lib/logger');
const { findExisting } = require('./upsertHandler');

/**
 * Elimina físicamente el registro de INDICE_MASTER al recibir page.deleted.
 * Entrada: pageId (string)
 * Salida: void
 */
const handleDelete = async (pageId) => {
  const startTime = Date.now();
  const existing = await findExisting(pageId);

  if (!existing) {
    console.log(`[INFO] page.deleted sin registro en INDICE_MASTER: ${pageId}`);
    await writeLog({
      tipoEvento: 'ignored',
      pageId,
      resultado: 'OK',
      mensaje: 'page.deleted sin registro en INDICE_MASTER',
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

/**
 * Restaura un registro en INDICE_MASTER.
 * Si está archivado, lo desarchiva. Si no existe, se ignora (el siguiente upsert lo creará).
 * Entrada: pageId (string)
 * Salida: void
 */
const handleRestore = async (pageId) => {
  const startTime = Date.now();
  const existing = await findExisting(pageId);

  if (!existing) {
    console.log(`[INFO] page.undeleted sin registro en INDICE_MASTER: ${pageId}`);
    await writeLog({
      tipoEvento: 'ignored',
      pageId,
      resultado: 'OK',
      mensaje: 'page.undeleted sin registro en INDICE_MASTER. Se recreará al próximo upsert.',
      tiempoMs: Date.now() - startTime
    });
    return;
  }

  await notion.pages.update({
    page_id: existing.id,
    archived: false,
    properties: {
      'Última actualización': { date: { start: new Date().toISOString() } }
    }
  });

  console.log(`[RESTAURADO] pageId: ${pageId}`);
  await writeLog({
    tipoEvento: 'restored',
    pageId,
    resultado: 'OK',
    mensaje: 'Restaurado desde papelera',
    tiempoMs: Date.now() - startTime
  });
};

module.exports = { handleDelete, handleRestore };