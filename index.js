require('dotenv').config();
const express = require('express');
const { Client } = require('@notionhq/client');

const app = express();
app.use(express.json());

// Cliente Notion
const notion = new Client({ auth: process.env.NOTION_TOKEN });
const INDICE_MASTER = process.env.INDICE_MASTER_DB_ID;

// Tipos de evento que procesamos
const VALID_EVENT_TYPES = [
  'page.created',
  'page.properties_updated',
  'page.content_updated',
  'page.moved',
  'page.deleted',
  'page.undeleted'
];

// Construir dbMap ignorando variables vacías o undefined
const buildDbMap = () => {
  const candidates = [
    { dsId: process.env.DB_PROGRAMAS_Y_PROYECTOS, config: { tipo: 'Proyecto', origen: 'PROGRAMAS Y PROYECTOS', relacion: 'Proyecto' } },
    { dsId: process.env.DB_REVISIONES, config: { tipo: 'Revisión', origen: 'REVISIONES', relacion: 'Revisión' } },
    { dsId: process.env.DB_USUARIOS, config: { tipo: 'Cliente', origen: 'USUARIOS', relacion: 'Usuario' } },
    { dsId: process.env.DB_COBRAR_Y_PAGAR, config: { tipo: 'Factura', origen: 'COBRAR Y PAGAR', relacion: 'Cobranza' } },
    { dsId: process.env.DB_SERVIDORES, config: { tipo: 'Dominio', origen: 'SERVIDORES', relacion: 'Servidor' } }
  ];

  const map = {};
  for (const { dsId, config } of candidates) {
    if (dsId && dsId.trim() !== '') {
      map[dsId] = config;
    }
  }
  return map;
};

const dbMap = buildDbMap();

// Health check
app.get('/', (req, res) => {
  res.send('Worker activo');
});

// Webhook principal
app.post('/webhook', async (req, res) => {
  // Verificación inicial del webhook (primera conexión)
  if (req.body.verification_token) {
    console.log('[VERIFICACION] Token:', req.body.verification_token);
    return res.status(200).json({ verification_token: req.body.verification_token });
  }

  const event = req.body;

  // Filtro 1: debe tener entidad válida
  if (!event.entity || !event.entity.id) {
    return res.status(200).send('OK');
  }

  // Filtro 2: solo procesamos eventos de páginas
  if (event.entity.type !== 'page') {
    console.log(`[IGNORADO] Entidad no es página. Tipo: ${event.entity.type}, Evento: ${event.type}`);
    return res.status(200).send('OK');
  }

  // Filtro 3: solo tipos de evento válidos
  if (!VALID_EVENT_TYPES.includes(event.type)) {
    console.log(`[IGNORADO] Evento no soportado: ${event.type}`);
    return res.status(200).send('OK');
  }

  const pageId = event.entity.id;
  console.log(`[PROCESANDO] ${event.type} | pageId: ${pageId}`);

  try {
    // Caso especial: página eliminada (sin implementar todavía, Fase 3)
    if (event.type === 'page.deleted') {
      console.log(`[INFO] Página eliminada: ${pageId}. Manejo en Fase 3.`);
      return res.status(200).send('OK');
    }

    // 1. Obtener datos de la página
    const pageData = await notion.pages.retrieve({ page_id: pageId });

    // 2. Identificar la base origen
    const parentDsId = pageData.parent.data_source_id;

    if (!parentDsId || !dbMap[parentDsId]) {
      console.log(`[IGNORADO] Base no mapeada. parent: ${JSON.stringify(pageData.parent)}`);
      return res.status(200).send('OK');
    }

    const config = dbMap[parentDsId];

    // 3. Extraer nombre y URL
    const titleProp = Object.values(pageData.properties).find(p => p.type === 'title');
    const nombre = titleProp?.title?.[0]?.plain_text || 'Sin título';
    const url = pageData.url;

    // 4. Buscar si ya existe en INDICE_MASTER
    const existing = await notion.dataSources.query({
      data_source_id: INDICE_MASTER,
      filter: {
        property: 'PAGE_ID',
        rich_text: { equals: pageId }
      }
    });

    // 5. Propiedades comunes
    const properties = {
      'Nombre': { title: [{ text: { content: nombre } }] },
      'PAGE_ID': { rich_text: [{ text: { content: pageId } }] },
      'DATABASE_ID_ORIGEN': { rich_text: [{ text: { content: parentDsId } }] },
      'Tipo': { multi_select: [{ name: config.tipo }] },
      'Origen_Base': { multi_select: [{ name: config.origen }] },
      'URL': { url: url },
      'Última actualización': { date: { start: new Date().toISOString() } },
      [config.relacion]: { relation: [{ id: pageId }] }
    };

    // 6. UPDATE o CREATE
    if (existing.results.length > 0) {
      await notion.pages.update({
        page_id: existing.results[0].id,
        properties
      });
      console.log(`[ACTUALIZADO] "${nombre}" (${config.origen})`);
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

    res.status(200).send('OK');
  } catch (error) {
    console.error(`[ERROR] pageId ${pageId}: ${error.message}`);
    if (error.code) console.error(`  code: ${error.code}, status: ${error.status}`);
    // Respondemos 200 para evitar reintentos infinitos de Notion
    res.status(200).send('OK');
  }
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('================================================');
  console.log(`Worker corriendo en puerto ${PORT}`);
  console.log(`Bases configuradas: ${Object.keys(dbMap).length}`);
  console.log('================================================');
});