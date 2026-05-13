/**
 * resync.js
 * Re-sincroniza todas las páginas de las bases fuente hacia INDICE_MASTER.
 * Usa la lógica de handleUpsert (que ya incluye el fix de título completo).
 *
 * Uso: node resync.js
 */

require('dotenv').config();
const notion = require('./lib/notionClient');
const { dbMap } = require('./config');
const { handleUpsert } = require('./handlers/upsertHandler');

// Pausa entre llamadas para respetar rate limit de Notion (~3 req/seg)
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const DELAY_MS = 400;

/**
 * Recorre una base fuente completa, paginando resultados.
 * Entrada: dataSourceId (string)
 * Salida: array de pageIds
 */
const listAllPages = async (dataSourceId) => {
  const pageIds = [];
  let cursor = undefined;

  do {
    const response = await notion.dataSources.query({
      data_source_id: dataSourceId,
      start_cursor: cursor,
      page_size: 100
    });

    for (const page of response.results) {
      pageIds.push(page.id);
    }

    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);

  return pageIds;
};

/**
 * Proceso principal: itera todas las bases del dbMap y re-sincroniza cada página.
 */
(async () => {
  console.log('================================================');
  console.log('RE-SINCRONIZACION INICIADA');
  console.log(`Bases a procesar: ${Object.keys(dbMap).length}`);
  console.log('================================================\n');

  let totalProcesadas = 0;
  let totalErrores = 0;

  for (const [dsId, config] of Object.entries(dbMap)) {
    console.log(`\n--- Base: ${config.origen} ---`);

    try {
      const pageIds = await listAllPages(dsId);
      console.log(`Paginas encontradas: ${pageIds.length}`);

      for (let i = 0; i < pageIds.length; i++) {
        const pageId = pageIds[i];
        try {
          await handleUpsert(pageId);
          totalProcesadas++;
        } catch (error) {
          console.error(`[ERROR] pageId ${pageId}: ${error.message}`);
          totalErrores++;
        }
        await sleep(DELAY_MS);

        // Progreso cada 10 paginas
        if ((i + 1) % 10 === 0) {
          console.log(`  Progreso: ${i + 1}/${pageIds.length}`);
        }
      }

      console.log(`Base ${config.origen} terminada.`);
    } catch (error) {
      console.error(`[ERROR BASE] ${config.origen}: ${error.message}`);
    }
  }

  console.log('\n================================================');
  console.log('RE-SINCRONIZACION TERMINADA');
  console.log(`Total procesadas: ${totalProcesadas}`);
  console.log(`Total errores:    ${totalErrores}`);
  console.log('================================================');
})();