/**
 * verify.js
 * Compara cuántos registros hay en cada base fuente
 * contra cuántos hay en INDICE_MASTER por Origen_Base.
 *
 * Uso: node verify.js
 */

require('dotenv').config();

const notion = require('./lib/notionClient');
const { INDICE_MASTER, dbMap } = require('./config');

const countPages = async (dataSourceId) => {
  let count = 0;
  let cursor = undefined;

  do {
    const response = await notion.dataSources.query({
      data_source_id: dataSourceId,
      start_cursor: cursor,
      page_size: 100
    });
    count += response.results.length;
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);

  return count;
};

const countMasterByOrigen = async () => {
  const counts = {};
  let cursor = undefined;

  do {
    const response = await notion.dataSources.query({
      data_source_id: INDICE_MASTER,
      start_cursor: cursor,
      page_size: 100
    });

    for (const page of response.results) {
      const origenProp = page.properties?.Origen_Base;
      const origen = origenProp?.multi_select?.[0]?.name || 'SIN ORIGEN';
      counts[origen] = (counts[origen] || 0) + 1;
    }

    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);

  return counts;
};

const main = async () => {
  console.log('\n========================================');
  console.log('  VERIFICACIÓN DE SINCRONIZACIÓN');
  console.log('========================================\n');

  console.log('Leyendo INDICE_MASTER...');
  const masterCounts = await countMasterByOrigen();

  console.log('Leyendo bases fuente...\n');

  let totalFuente = 0;
  let totalMaster = 0;

  const col1 = 26;
  const header =
    'BASE'.padEnd(col1) + ' | ' +
    'FUENTE'.padStart(6) + ' | ' +
    'INDICE_MASTER'.padStart(13) + ' | ' +
    'ESTADO';

  const separador = '-'.repeat(header.length);

  console.log(header);
  console.log(separador);

  for (const [dsId, config] of Object.entries(dbMap)) {
    const fuenteCount = await countPages(dsId);
    const masterCount = masterCounts[config.origen] || 0;
    const diff = fuenteCount - masterCount;

    totalFuente += fuenteCount;
    totalMaster += masterCount;

    const estado = diff === 0
      ? 'OK'
      : diff > 0
        ? `FALTAN ${diff}`
        : `EXTRA ${Math.abs(diff)}`;

    console.log(
      config.origen.padEnd(col1) + ' | ' +
      String(fuenteCount).padStart(6) + ' | ' +
      String(masterCount).padStart(13) + ' | ' +
      estado
    );
  }

  const totalDiff = totalFuente - totalMaster;
  const totalEstado = totalDiff === 0
    ? 'OK'
    : totalDiff > 0
      ? `FALTAN ${totalDiff}`
      : `EXTRA ${Math.abs(totalDiff)}`;

  console.log(separador);
  console.log(
    'TOTAL'.padEnd(col1) + ' | ' +
    String(totalFuente).padStart(6) + ' | ' +
    String(totalMaster).padStart(13) + ' | ' +
    totalEstado
  );

  console.log('\n========================================\n');
};

main().catch(error => {
  console.error('[ERROR verify]', error);
  process.exit(1);
});