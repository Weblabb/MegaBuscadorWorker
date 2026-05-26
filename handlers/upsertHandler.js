/**
 * handlers/upsertHandler.js
 * Lee propiedades de la página origen, refleja metadata en INDICE_MASTER,
 * extrae tags tartamudos del título si no hay tags manuales,
 * evita duplicados por PAGE_ID y registra eventos en LOGS_WORKER.
 */

const notion = require('../lib/notionClient');
const { writeLog } = require('../lib/logger');
const { INDICE_MASTER, dbMap } = require('../config');

const PROP_ESTADO_MASTER = 'Estado opcion multiple';
const PROP_TAGS = 'TAGS Keywords (buscador tartamudo)';
const PROP_NOTAS = 'Descripción / Notas';

const ESTADO_CANDIDATES = [
  'Estado opcion multiple',
  'Estado',
  'estado',
  'Status'
];

const findExisting = async (pageId) => {
  const result = await notion.dataSources.query({
    data_source_id: INDICE_MASTER,
    filter: {
      property: 'PAGE_ID',
      rich_text: { equals: pageId }
    },
    page_size: 1
  });

  return result.results.length > 0 ? result.results[0] : null;
};

const getTitle = (pageData) => {
  const titleProp = Object.values(pageData.properties).find(p => p.type === 'title');
  return titleProp?.title?.map(t => t.plain_text).join('').trim() || '';
};

const getPlainText = (prop) => {
  if (!prop) return '';

  if (prop.type === 'rich_text') {
    return prop.rich_text?.map(t => t.plain_text).join('').trim() || '';
  }

  if (prop.type === 'title') {
    return prop.title?.map(t => t.plain_text).join('').trim() || '';
  }

  if (prop.type === 'select') {
    return prop.select?.name || '';
  }

  if (prop.type === 'status') {
    return prop.status?.name || '';
  }

  if (prop.type === 'multi_select') {
    return prop.multi_select?.map(x => x.name).filter(Boolean).join(', ') || '';
  }

  return '';
};

const getEstado = (pageData) => {
  for (const propName of ESTADO_CANDIDATES) {
    const prop = pageData.properties?.[propName];
    const value = getPlainText(prop);
    if (value) return value;
  }

  return '';
};

const getManualTags = (pageData) => {
  const prop = pageData.properties?.[PROP_TAGS];

  if (!prop) return [];

  if (prop.type === 'multi_select') {
    return prop.multi_select?.map(x => x.name).filter(Boolean) || [];
  }

  const textValue = getPlainText(prop);

  return textValue
    ? textValue.split(',').map(x => x.trim()).filter(Boolean)
    : [];
};

const getManualNotas = (pageData) => {
  return getPlainText(pageData.properties?.[PROP_NOTAS]);
};

const extraerTagsTartamudos = (nombre) => {
  const palabras = nombre
    .trim()
    .split(/\s+/)
    .map(p => p.replace(/[.,;:(){}\[\]"'¿?¡!]/g, '').trim())
    .filter(Boolean);

  const tags = palabras.filter(palabra => {
    const lower = palabra.toLowerCase();

    const empiezaConLetraDoble =
      lower.length >= 4 &&
      lower.length <= 7 &&
      lower[0] === lower[1];

    const noEsUrl =
      !lower.includes('.com') &&
      !lower.includes('http') &&
      !lower.includes('www');

    const noEsNumero = !/^\d+$/.test(lower);

    return empiezaConLetraDoble && noEsUrl && noEsNumero;
  });

  return [...new Set(tags)];
};

const buildProperties = ({ pageId, parentDsId, nombre, url, config, pageData }) => {
  const estado = getEstado(pageData);

  const manualTags = getManualTags(pageData);
  const tagsDesdeTitulo = extraerTagsTartamudos(nombre);
  const tagsFinales = manualTags.length > 0 ? manualTags : tagsDesdeTitulo;

  const notasFinales = getManualNotas(pageData);

  const properties = {
    'Nombre': { title: [{ text: { content: nombre } }] },
    'PAGE_ID': { rich_text: [{ text: { content: pageId } }] },
    'DATABASE_ID_ORIGEN': { rich_text: [{ text: { content: parentDsId } }] },
    'Tipo': { multi_select: [{ name: config.tipo }] },
    'Origen_Base': { multi_select: [{ name: config.origen }] },
    'URL': { url },
    'Última actualización': { date: { start: new Date().toISOString() } },
    [config.relacion]: { relation: [{ id: pageId }] }
  };

  if (estado) {
    properties[PROP_ESTADO_MASTER] = { status: { name: estado } };
  }

  if (tagsFinales.length > 0) {
    properties[PROP_TAGS] = {
      multi_select: tagsFinales.map(tag => ({ name: tag }))
    };
  }

  if (notasFinales) {
    properties[PROP_NOTAS] = {
      rich_text: [{ text: { content: notasFinales } }]
    };
  }

  return properties;
};

const handleUpsert = async (pageId) => {
  const startTime = Date.now();

  const pageData = await notion.pages.retrieve({ page_id: pageId });
  const parentDsId = pageData.parent.data_source_id;

  if (!parentDsId || !dbMap[parentDsId]) {
    return;
  }

  const config = dbMap[parentDsId];
  const nombre = getTitle(pageData);

  if (!nombre) {
    console.log(`[IGNORADO] Página sin título. pageId: ${pageId}`);
    await writeLog({
      tipoEvento: 'ignored',
      pageId,
      baseOrigen: config.origen,
      resultado: 'OK',
      mensaje: 'Página sin título',
      tiempoMs: Date.now() - startTime
    });
    return;
  }

  const url = pageData.url;
  const properties = buildProperties({ pageId, parentDsId, nombre, url, config, pageData });

  const existing = await findExisting(pageId);

  if (existing) {
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

    await writeLog({
      tipoEvento: wasDeleted ? 'restored' : 'updated',
      pageId,
      baseOrigen: config.origen,
      resultado: 'OK',
      mensaje: nombre,
      tiempoMs: Date.now() - startTime
    });

    return;
  }

  const existingBeforeCreate = await findExisting(pageId);

  if (existingBeforeCreate) {
    await notion.pages.update({
      page_id: existingBeforeCreate.id,
      properties
    });

    console.log(`[ACTUALIZADO EN SEGUNDA VERIFICACIÓN] "${nombre}" (${config.origen})`);

    await writeLog({
      tipoEvento: 'updated',
      pageId,
      baseOrigen: config.origen,
      resultado: 'OK',
      mensaje: `${nombre} | segunda verificación anti-duplicado`,
      tiempoMs: Date.now() - startTime
    });

    return;
  }

  await notion.pages.create({
    parent: { data_source_id: INDICE_MASTER },
    properties: {
      ...properties,
      'Fecha de creación': { date: { start: new Date().toISOString() } }
    }
  });

  console.log(`[CREADO] "${nombre}" (${config.origen})`);

  await writeLog({
    tipoEvento: 'created',
    pageId,
    baseOrigen: config.origen,
    resultado: 'OK',
    mensaje: nombre,
    tiempoMs: Date.now() - startTime
  });
};

module.exports = {
  handleUpsert,
  findExisting
};