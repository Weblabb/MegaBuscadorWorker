require('dotenv').config();
const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_TOKEN });

const bases = {
  INDICE_MASTER: process.env.INDICE_MASTER_DB_ID,
  PROGRAMAS_Y_PROYECTOS: process.env.DB_PROGRAMAS_Y_PROYECTOS,
  REVISIONES: process.env.DB_REVISIONES,
  USUARIOS: process.env.DB_USUARIOS,
  COBRAR_Y_PAGAR: process.env.DB_COBRAR_Y_PAGAR,
  SERVIDORES: process.env.DB_SERVIDORES
};

(async () => {
  for (const [nombre, dbId] of Object.entries(bases)) {
    if (!dbId) {
      console.log(`${nombre}: SIN ID`);
      continue;
    }
    try {
      const db = await notion.databases.retrieve({ database_id: dbId });
      console.log(`\n${nombre}:`);
      console.log(`  database_id: ${dbId}`);
      console.log(`  data_source_id: ${db.data_sources?.[0]?.id || 'no disponible'}`);
    } catch (error) {
      console.log(`${nombre}: ERROR - ${error.message}`);
    }
  }
})();