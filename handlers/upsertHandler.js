/**
 * handlers/upsertHandler.js
 * Lógica para crear o actualizar un registro en INDICE_MASTER.
 */

const notion = require('../lib/notionClient');
const { INDICE_MASTER, dbMap } = require('../config');

/**
 * Busca un registro en INDICE_MASTER por PAGE_ID.
 * Entrada: pageId (string)
 * Salida: registro existente o null
 */
const findExisting = async (pageId) => {
  const result = await notion.dataSources.query({
    data_source_id: INDICE_MASTER,
    filter: {
      property: 'PAGE_ID',
      rich_text: { equals: pageId }
    }
  });
  return result.results.length > 0 ? result.results[0] : null;
};

/**
 * Construye el objeto de propiedades comunes para crear o actualizar.
 * Entrada: pageId, parentDsId, nombre, url, config
 * Salida: objeto properties de Notion
 */
const buildProperties = ({ pageId, parentDsId, nombre, url, config }) => ({
  'Nombre': { title: [{ text: { content: nombre } }] },
  'PAGE_ID': { rich_text: [{ text: { content: pageId } }] },
  'DATABASE_ID_ORIGEN': { rich_text: [{ text: { content: parentDsId } }] },
  'Tipo': { multi_select: [{ name: config.tipo }] },
  'Origen_Base': { multi_select: [{ name: config.origen }] },
  'URL': { url: url },
  'Última actualización': { date: { start: new Date().toISOString() } },
  [config.relacion]: { relation: [{ id: pageId }] }
});

/**
 * Procesa un evento create/update/move/content_updated.
 * Entrada: pageId (string)
 * Salida: void (log)
 */
const handleUpsert = async (pageId) => {
  // 1. Obtener datos de la página original
  const pageData = await notion.pages.retrieve({ page_id: pageId });
  const parentDsId = pageData.parent.data_source_id;

  // 2. Validar que la base esté mapeada
  if (!parentDsId || !dbMap[parentDsId]) {
    console.log(`[IGNORADO] Base no mapeada. parent: ${JSON.stringify(pageData.parent)}`);
    return;
  }

  const config = dbMap[parentDsId];

  // 3. Extraer nombre y URL
  const titleProp = Object.values(pageData.properties).find(p => p.type === 'title');
  const nombre = titleProp?.title?.map(t => t.plain_text).join('').trim() || '';

  // Si no hay título, ignorar el evento (evita registros "Sin título")
  if (!nombre) {
    console.log(`[IGNORADO] Página sin título. pageId: ${pageId}`);
    return;
  }

  const url = pageData.url;

  // 4. Buscar si ya existe
  const existing = await findExisting(pageId);
  const properties = buildProperties({ pageId, parentDsId, nombre, url, config });

  // 5. Update o Create
  if (existing) {
    // Si estaba marcado como eliminado, restaurarlo en este update
    const wasDeleted = existing.properties?.Eliminado?.checkbox === true;
    if (wasDeleted) {
      properties['Eliminado'] = { checkbox: false };
      properties['Fecha_Eliminacion'] = { date: null };
    }

    await notion.pages.update({
      page_id: existing.id,
      properties
    });
    console.log(`[ACTUALIZADO] "${nombre}" (${config.origen})${wasDeleted ? ' [restaurado]' : ''}`);
  } else {
    await notion.pages.create({
      parent: { data_source_id: INDICE_MASTER },
      properties: {
        ...properties,
        'Fecha de creación': { date: { start: new Date().toISOString() } }
      }
    });
    console.log(`[CREADO] "${nombre}" (${config.origen})`);
  }
};

module.exports = { handleUpsert, findExisting };