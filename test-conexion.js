/**
 * test-conexion.js
 * Prueba minima que valida token y acceso a INDICE_MASTER usando data_source_id.
 */

require('dotenv').config();
const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_TOKEN });

(async () => {
  try {
    console.log('Probando conexion a INDICE_MASTER...');
    const result = await notion.dataSources.query({
      data_source_id: process.env.INDICE_MASTER_DB_ID,
      page_size: 1
    });
    console.log('CONEXION OK');
    console.log(`Paginas en INDICE_MASTER (muestra): ${result.results.length}`);
  } catch (error) {
    console.log('ERROR:', error.message);
    if (error.code) console.log('Code:', error.code);
  }
})();