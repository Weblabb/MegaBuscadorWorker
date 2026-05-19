require('dotenv').config();

const notion = require('./lib/notionClient');
const { dbMap } = require('./config');
const { handleUpsert } = require('./handlers/upsertHandler');
const MAX_RETRIES = Number(process.env.RESYNC_MAX_RETRIES || 3);

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const DELAY_MS = Number(process.env.RESYNC_DELAY_MS || 400);
const DEFAULT_HOURS = Number(process.env.RESYNC_HOURS || 24);

const args = process.argv.slice(2);
const isFullSync = args.includes('--full');
const baseArg = args.find(arg => arg.startsWith('--base='));

const onlyBase = baseArg
  ? baseArg.replace('--base=', '').trim().toUpperCase()
  : null;

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
const isRetryable = (error) => {
  const code = error.code || '';
  const message = error.message || '';

  return (
    code === 'notionhq_client_request_timeout' ||
    code === 'rate_limited' ||
    code === 'service_unavailable' ||
    message.includes('timeout') ||
    message.includes('ECONNRESET') ||
    message.includes('ETIMEDOUT')
  );
};
const withRetry = async (fn, context = '') => {
  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (!isRetryable(error) || attempt === MAX_RETRIES) {
        throw error;
      }

      const waitMs = DELAY_MS * attempt * 2;
      console.log(`[RETRY ${attempt}/${MAX_RETRIES}] ${context} - ${error.message}`);
      await sleep(waitMs);
    }
  }

  throw lastError;
};
const runResync = async () => {
  const sinceIso = isFullSync ? null : getSinceDate();

  console.log('================================================');
  console.log('RE-SINCRONIZACIÓN INICIADA');
  console.log(`Modo: ${isFullSync ? 'COMPLETA' : 'INCREMENTAL'}`);
  console.log(`Bases a procesar: ${onlyBase || 'TODAS'}`);

  if (!isFullSync) {
    console.log(`Rango: páginas editadas desde ${sinceIso}`);
  }

  console.log('================================================\n');

  let totalEncontradas = 0;
  let totalProcesadas = 0;
  let totalErrores = 0;
for (const [dsId, config] of Object.entries(dbMap)) {
  if (onlyBase && config.origen.toUpperCase() !== onlyBase) {
    continue;
  }

  console.log(`\n--- Base: ${config.origen} ---`);

    try {
      const pageIds = await listPages(dsId, sinceIso);

      totalEncontradas += pageIds.length;

      console.log(`Páginas encontradas: ${pageIds.length}`);

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
          console.error(`[ERROR] ${config.origen} | pageId ${pageId}: ${error.message}`);

          if (error.code) {
            console.error(`  code: ${error.code}`);
          }
        }

        await sleep(DELAY_MS);

        if ((i + 1) % 10 === 0 || i + 1 === pageIds.length) {
          console.log(`  Progreso: ${i + 1}/${pageIds.length}`);
        }
      }

      console.log(`Base ${config.origen} terminada.`);
    } catch (error) {
      totalErrores++;
      console.error(`[ERROR BASE] ${config.origen}: ${error.message}`);

      if (error.code) {
        console.error(`  code: ${error.code}`);
      }
    }
  }

  console.log('\n================================================');
  console.log('RE-SINCRONIZACIÓN TERMINADA');
  console.log(`Total encontradas: ${totalEncontradas}`);
  console.log(`Total procesadas:  ${totalProcesadas}`);
  console.log(`Total errores:     ${totalErrores}`);
  console.log('================================================');
};

runResync().catch(error => {
  console.error('[ERROR FATAL resync]', error);
  process.exit(1);
});