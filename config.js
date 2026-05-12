/**
 * config.js
 * Centraliza variables de entorno, constantes y mapeo de bases.
 */

require('dotenv').config();

// Token de la integración Notion y data_source_id de INDICE_MASTER
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const INDICE_MASTER = process.env.INDICE_MASTER_DB_ID;

// Tipos de evento que el Worker procesa
const VALID_EVENT_TYPES = [
  'page.created',
  'page.properties_updated',
  'page.content_updated',
  'page.moved',
  'page.deleted',
  'page.undeleted'
];

/**
 * Construye el mapa de bases conectadas.
 * Ignora variables vacías o no definidas.
 * Salida: { [data_source_id]: { tipo, origen, relacion } }
 */
const buildDbMap = () => {
  const candidates = [
    { dsId: process.env.DB_PROGRAMAS_Y_PROYECTOS, config: { tipo: 'Proyecto', origen: 'PROGRAMAS Y PROYECTOS', relacion: 'Proyecto' } },
    { dsId: process.env.DB_REVISIONES,            config: { tipo: 'Revisión', origen: 'REVISIONES',            relacion: 'Revisión' } },
    { dsId: process.env.DB_USUARIOS,              config: { tipo: 'Cliente',  origen: 'USUARIOS',              relacion: 'Usuario' } },
    { dsId: process.env.DB_COBRAR_Y_PAGAR,        config: { tipo: 'Factura',  origen: 'COBRAR Y PAGAR',        relacion: 'Cobranza' } },
    { dsId: process.env.DB_SERVIDORES,            config: { tipo: 'Dominio',  origen: 'SERVIDORES',            relacion: 'Servidor' } }
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

const PORT = process.env.PORT || 3000;

module.exports = {
  NOTION_TOKEN,
  INDICE_MASTER,
  VALID_EVENT_TYPES,
  dbMap,
  PORT
};