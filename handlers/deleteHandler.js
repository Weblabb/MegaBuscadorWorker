/**
 * handlers/deleteHandler.js
 * Soft delete (page.deleted) y restore (page.undeleted).
 * No borra físicamente; marca campo Eliminado en INDICE_MASTER.
 */

const notion = require('../lib/notionClient');
const { findExisting } = require('./upsertHandler');

/**
 * Marca un registro como eliminado en INDICE_MASTER.
 * Entrada: pageId (string)
 * Salida: void (log)
 */
const handleDelete = async (pageId) => {
  const existing = await findExisting(pageId);

  if (!existing) {
    console.log(`[INFO] page.deleted sin registro en INDICE_MASTER: ${pageId}`);
    return;
  }

  await notion.pages.update({
    page_id: existing.id,
    properties: {
      'Eliminado': { checkbox: true },
      'Fecha_Eliminacion': { date: { start: new Date().toISOString() } },
      'Última actualización': { date: { start: new Date().toISOString() } }
    }
  });
  console.log(`[ELIMINADO] pageId: ${pageId}`);
};

/**
 * Restaura un registro previamente marcado como eliminado.
 * Entrada: pageId (string)
 * Salida: void (log)
 */
const handleRestore = async (pageId) => {
  const existing = await findExisting(pageId);

  if (!existing) {
    console.log(`[INFO] page.undeleted sin registro en INDICE_MASTER: ${pageId}`);
    return;
  }

  await notion.pages.update({
    page_id: existing.id,
    properties: {
      'Eliminado': { checkbox: false },
      'Fecha_Eliminacion': { date: null },
      'Última actualización': { date: { start: new Date().toISOString() } }
    }
  });
  console.log(`[RESTAURADO] pageId: ${pageId}`);
};

module.exports = { handleDelete, handleRestore };