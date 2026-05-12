require('dotenv').config();
const express = require('express');
const { Client } = require('@notionhq/client');

const app = express();
app.use(express.json());

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const INDICE_MASTER = process.env.INDICE_MASTER_DB_ID;

// Mapeo de data_source_id a config
const dbMap = {
  [process.env.DB_PROGRAMAS_Y_PROYECTOS]: {
    tipo: 'Proyecto',
    origen: 'PROGRAMAS Y PROYECTOS',
    relacion: 'Proyecto'
  },
  [process.env.DB_REVISIONES]: {
    tipo: 'Revisión',
    origen: 'REVISIONES',
    relacion: 'Revisión'
  },
  [process.env.DB_USUARIOS]: {
    tipo: 'Cliente',
    origen: 'USUARIOS',
    relacion: 'Usuario'
  },
  [process.env.DB_COBRAR_Y_PAGAR]: {
    tipo: 'Factura',
    origen: 'COBRAR Y PAGAR',
    relacion: 'Cobranza'
  },
  [process.env.DB_SERVIDORES]: {
    tipo: 'Dominio',
    origen: 'SERVIDORES',
    relacion: 'Servidor'
  }
};

// Health check
app.get('/', (req, res) => {
  res.send('Worker activo');
});

// Webhook de Notion
app.post('/webhook', async (req, res) => {
  console.log('Evento recibido:', JSON.stringify(req.body, null, 2));

  // Verificación inicial del webhook
  if (req.body.verification_token) {
    console.log('Token de verificación:', req.body.verification_token);
    return res.status(200).json({ verification_token: req.body.verification_token });
  }

  try {
    const event = req.body;

    if (!event.entity || !event.entity.id) {
      return res.status(200).send('OK');
    }

    const pageId = event.entity.id;

    // 1. Obtener datos de la página
    const pageData = await notion.pages.retrieve({ page_id: pageId });
    
    // 2. Identificar de qué base viene (API nueva: data_source_id)
    const parentDsId = pageData.parent.data_source_id;

    if (!parentDsId || !dbMap[parentDsId]) {
      console.log('La página no viene de una base mapeada. Ignorando.');
      console.log('parent recibido:', pageData.parent);
      return res.status(200).send('OK');
    }

    const config = dbMap[parentDsId];

    // 3. Sacar nombre y URL
    const titleProp = Object.values(pageData.properties).find(p => p.type === 'title');
    const nombre = titleProp?.title?.[0]?.plain_text || 'Sin título';
    const url = pageData.url;

    // 4. Buscar en INDICE_MASTER por PAGE_ID
    const existing = await notion.dataSources.query({
      data_source_id: INDICE_MASTER,
      filter: {
        property: 'PAGE_ID',
        rich_text: { equals: pageId }
      }
    });

    // 5. Preparar propiedades
    const properties = {
      'Nombre': { title: [{ text: { content: nombre } }] },
      'PAGE_ID': { rich_text: [{ text: { content: pageId } }] },
      'DATABASE_ID_ORIGEN': { rich_text: [{ text: { content: parentDsId } }] },
      'Tipo': { select: { name: config.tipo } },
      'Origen_Base': { select: { name: config.origen } },
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
      console.log('Registro actualizado:', nombre);
    } else {
      await notion.pages.create({
        parent: { data_source_id: INDICE_MASTER },
        properties: {
          ...properties,
          'Fecha de creación': { date: { start: new Date().toISOString() } }
        }
      });
      console.log('Registro creado:', nombre);
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('Error procesando evento:', error);
    res.status(500).send('Error');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Worker corriendo en puerto ${PORT}`);
});