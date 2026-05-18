require('dotenv').config();

const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_TOKEN });

const bases = {
  INDICE_MASTER: process.env.INDICE_MASTER_DB_ID,
  PROGRAMAS_Y_PROYECTOS: process.env.DB_PROGRAMAS_Y_PROYECTOS,
  REVISIONES: process.env.DB_REVISIONES,
  USUARIOS: process.env.DB_USUARIOS,
  COBRAR_Y_PAGAR: process.env.DB_COBRAR_Y_PAGAR,
  SERVIDORES: process.env.DB_SERVIDORES,
  REV2: process.env.DB_REV2,
  DOMINIO_WP_PANEL: process.env.DB_DOMINIO_WP_PANEL,
  DOMINIO_REGISTRANTE: process.env.DB_DOMINIO_REGISTRANTE,
  INSPIRACION: process.env.DB_INSPIRACION,
  PROVEEDORES: process.env.DB_PROVEEDORES
};

(async () => {
  console.log('========================================');
  console.log('VALIDANDO DATA_SOURCE_ID DE NOTION');
  console.log('========================================');

  for (const [nombre, dataSourceId] of Object.entries(bases)) {
    if (!dataSourceId) {
      console.log(`\n${nombre}: SIN ID`);
      continue;
    }

    try {
      const result = await notion.dataSources.query({
        data_source_id: dataSourceId,
        page_size: 1
      });

      console.log(`\n${nombre}: OK`);
      console.log(`  data_source_id: ${dataSourceId}`);
      console.log(`  muestra paginas: ${result.results.length}`);
    } catch (error) {
      console.log(`\n${nombre}: ERROR`);
      console.log(`  data_source_id: ${dataSourceId}`);
      console.log(`  mensaje: ${error.message}`);
      if (error.code) console.log(`  code: ${error.code}`);
    }
  }

  console.log('\n========================================');
  console.log('VALIDACIÓN TERMINADA');
  console.log('========================================');
})();