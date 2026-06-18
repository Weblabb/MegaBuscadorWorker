require('dotenv').config();

const notion = require('./lib/notionClient');
const log = require('./lib/log');
const { dbMap } = require('./config');
const { handleUpsert } = require('./handlers/upsertHandler');
const { withRetry } = require('./lib/retry');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const DELAY_MS = Number(process.env.RESYNC_DELAY_MS || 400);
const DEFAULT_HOURS = Number(process.env.RESYNC_HOURS || 24);

const args = process.argv.slice(2);
const isFullSync = args.includes('--full');

// Reconstruir el valor de --base uniendo palabras sueltas tras el signo =
// Esto permite ejecutar sin comillas:
//   node resync.js --base=PROGRAMAS Y PROYECTOS
//   node resync.js --base=COBRAR Y PAGAR --full
const baseArgIndex = args.findIndex(arg => arg.startsWith('--base='));
let onlyBase = null;
if (baseArgIndex !== -1) {
  const firstPart = args[baseArgIndex].replace('--base=', '').trim();
  const extraParts = [];
  for (let i = baseArgIndex + 1; i < args.length; i++) {
    if (args[i].startsWith('--')) break;
    extraParts.push(args[i]);
  }
  const fullBase = [firstPart, ...extraParts].join(' ').trim();
  onlyBase = fullBase ? fullBase.toUpperCase() : null;
}

const hoursArg = args.find(arg => arg.startsWith('--hours='));
const hours = hoursArg
  ? Number(hoursArg.replace('--hours=', ''))
  : DEFAULT_HOURS;

const getSinceDate = () => {
  const date = new Date();
  date.setHours(date.getHours() - hours);
  return date.toISOString();
};

const listPages = async (dataSourceId, sinceIso = null) => {
  const pageIds = [];
  let cursor = undefined;

  const filter = sinceIso
    ? {
      timestamp: 'last_edited_time',
      last_edited_time: {
        on_or_after: sinceIso
      }
    }
    : undefined;

  do {
    const response = await notion.dataSources.query({
      data_source_id: dataSourceId,
      start_cursor: cursor,
      page_size: 100,
      ...(filter ? { filter } : {})
    });

    for (const page of response.results) {
      pageIds.push(page.id);
    }

    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);

  return pageIds;
};

const runResync = async () => {
  const sinceIso = isFullSync ? null : getSinceDate();

  log.info('================================================');
  log.info('RE-SINCRONIZACIÓN INICIADA');
  log.info(`Modo: ${isFullSync ? 'COMPLETA' : 'INCREMENTAL'}`);
  log.info(`Bases a procesar: ${onlyBase || 'TODAS'}`);

  if (!isFullSync) {
    log.info(`Rango: páginas editadas desde ${sinceIso}`);
  }

  log.info('================================================\n');

  let totalEncontradas = 0;
  let totalProcesadas = 0;
  let totalErrores = 0;

  for (const [dsId, config] of Object.entries(dbMap)) {
    if (onlyBase && config.origen.toUpperCase() !== onlyBase) {
      continue;
    }

    log.info(`\n--- Base: ${config.origen} ---`);

    try {
      const pageIds = await withRetry(
        () => listPages(dsId, sinceIso),
        `listPages | ${config.origen}`
      );

      totalEncontradas += pageIds.length;

      log.info(`Páginas encontradas: ${pageIds.length}`);

      for (let i = 0; i < pageIds.length; i++) {
        const pageId = pageIds[i];

        try {
          await withRetry(
            () => handleUpsert(pageId),
            `${config.origen} | ${pageId}`
          );

          totalProcesadas++;
        } catch (error) {
          totalErrores++;
          log.error(`[ERROR] ${config.origen} | pageId ${pageId}: ${error.message}`);

          if (error.code) {
            log.error(`  code: ${error.code}`);
          }
        }

        await sleep(DELAY_MS);

        if ((i + 1) % 10 === 0 || i + 1 === pageIds.length) {
          log.info(`  Progreso: ${i + 1}/${pageIds.length}`);
        }
      }

      log.info(`Base ${config.origen} terminada.`);
    } catch (error) {
      totalErrores++;
      log.error(`[ERROR BASE] ${config.origen}: ${error.message}`);

      if (error.code) {
        log.error(`  code: ${error.code}`);
      }
    }
  }

  log.info('\n================================================');
  log.info('RE-SINCRONIZACIÓN TERMINADA');
  log.info(`Total encontradas: ${totalEncontradas}`);
  log.info(`Total procesadas:  ${totalProcesadas}`);
  log.info(`Total errores:     ${totalErrores}`);
  log.info('================================================');
};

runResync().catch(error => {
  log.error('[ERROR FATAL resync]', error);
  process.exit(1);
});