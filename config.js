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
    { dsId: process.env.DB_PROGRAMAS_Y_PROYECTOS, config: { tipo: 'Proyecto', origen: 'PROGRAMAS Y PROYECTOS', relacion: 'Programas y Proyectos' } },
    { dsId: process.env.DB_REVISIONES,            config: { tipo: 'Revisión', origen: 'REVISIONES',            relacion: 'Revisiones' } },
    { dsId: process.env.DB_USUARIOS,              config: { tipo: 'Cliente',  origen: 'USUARIOS',              relacion: 'Clientes' } },
    { dsId: process.env.DB_COBRAR_Y_PAGAR,        config: { tipo: 'Factura',  origen: 'COBRAR Y PAGAR',        relacion: 'COBRAR Y PAGAR' } },
    { dsId: process.env.DB_SERVIDORES,            config: { tipo: 'Dominio',  origen: 'SERVIDORES',            relacion: 'Dominios y WP (Contraseñas) Servers Accesos' } },
    { dsId: process.env.DB_REV2,                  config: { tipo: 'Revisión', origen: 'REV2',                  relacion: 'REV2' } },
    { dsId: process.env.DB_DOMINIO_WP_PANEL,      config: { tipo: 'Dominio',  origen: 'DOMINIO WP PANEL',      relacion: 'Dominio Wordpress Panel y Correos Contraseñas y siteground,REDES' } },
    { dsId: process.env.DB_DOMINIO_REGISTRANTE,   config: { tipo: 'Dominio',  origen: 'DOMINIO REGISTRANTE',   relacion: 'Dominio registrante GoDaddy Akky Nubox'} },
    { dsId: process.env.DB_INSPIRACION,           config: { tipo: 'Inspiración', origen: 'INSPIRACION',        relacion: 'INSPIRACION' } },
    { dsId: process.env.DB_PROVEEDORES,           config: { tipo: 'Proveedor', origen: 'PROVEEDORES',          relacion: 'PROVEEDORES' } },
    { dsId: process.env.DB_NUEVA_TABLA,           config: { tipo: 'General', origen: 'NUEVA TABLA',            relacion: 'NUEVA TABLA' } }
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