/**
 * cleanupByPageId.js
 * Solo lectura en DRY_RUN = true (por defecto).
 *
 * Archiva en INDICE_MASTER:
 *   - HUÉRFANOS: registros cuyo PAGE_ID ya no existe como página activa
 *     en ninguna base fuente. Incluye los duplicados cuya fuente fue eliminada.
 *   - DUPLICADOS ACTIVOS: cuando el mismo PAGE_ID tiene más de un registro
 *     en INDICE_MASTER y la fuente sigue existiendo, conserva el más reciente
 *     y archiva el resto.
 *
 * Uso:
 *   node cleanupByPageId.js            → DRY RUN, solo muestra
 *   (cambiar DRY_RUN = false y volver a ejecutar para borrado real)
 */

require('dotenv').config();

const notion = require('./lib/notionClient');
const { INDICE_MASTER, dbMap } = require('./config');

const DRY_RUN = true; // Cambiar a false SOLO para ejecutar borrado real

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const DELAY_MS = 350;

// ─────────────────────────────────────────────
// Lectura
// ─────────────────────────────────────────────

const getSourcePageIds = async (dataSourceId) => {
  const ids = new Set();
  let cursor = undefined;

  do {
    const response = await notion.dataSources.query({
      data_source_id: dataSourceId,
      start_cursor: cursor,
      page_size: 100
    });
    for (const page of response.results) {
      ids.add(page.id);
    }
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);

  return ids;
};

const getMasterRecords = async () => {
  const records = [];
  let cursor = undefined;

  do {
    const response = await notion.dataSources.query({
      data_source_id: INDICE_MASTER,
      start_cursor: cursor,
      page_size: 100
    });

    for (const page of response.results) {
      const pageIdProp = page.properties?.PAGE_ID;
      const pageId = pageIdProp?.rich_text?.map(t => t.plain_text).join('').trim() || '';

      const origenProp = page.properties?.Origen_Base;
      const origen = origenProp?.multi_select?.[0]?.name || 'SIN ORIGEN';

      const nombreProp = Object.values(page.properties).find(p => p.type === 'title');
      const nombre = nombreProp?.title?.map(t => t.plain_text).join('').trim() || '(sin título)';

      records.push({
        masterRecordId: page.id,
        pageId,
        origen,
        nombre,
        updatedAt: page.last_edited_time || ''
      });
    }

    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);

  return records;
};

// ─────────────────────────────────────────────
// Limpieza
// ─────────────────────────────────────────────

const archiveRecord = async (masterRecordId, nombre, razon, counters) => {
  if (DRY_RUN) {
    counters.dryRun++;
    return;
  }

  try {
    await notion.pages.update({
      page_id: masterRecordId,
      archived: true
    });
    counters.archived++;
  } catch (error) {
    if (error.code === 'validation_error' && error.message?.includes('archived')) {
      counters.skipped++;
    } else {
      console.error(`  [ERROR] "${nombre}" | ${masterRecordId}: ${error.message}`);
      counters.errors++;
    }
  }
};

// ─────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────

const main = async () => {
  console.log('\n========================================');
  console.log('  LIMPIEZA POR PAGE_ID');
  console.log(`  Modo: ${DRY_RUN ? 'DRY RUN — no se archiva nada' : '*** BORRADO REAL ***'}`);
  console.log('========================================\n');

  // PASO 1: Cargar IDs activos de todas las bases fuente
  console.log('Paso 1/3 — Leyendo bases fuente...\n');
  const allSourceIds = new Set();

  for (const [dsId, config] of Object.entries(dbMap)) {
    process.stdout.write(`  ${config.origen.padEnd(26)} `);
    const ids = await getSourcePageIds(dsId);
    ids.forEach(id => allSourceIds.add(id));
    console.log(`${ids.size} activas`);
  }
  console.log(`\n  Total IDs activos en fuentes: ${allSourceIds.size}\n`);

  // PASO 2: Cargar todos los registros de INDICE_MASTER
  console.log('Paso 2/3 — Leyendo INDICE_MASTER...\n');
  const masterRecords = await getMasterRecords();
  console.log(`  Total registros: ${masterRecords.length}\n`);

  // PASO 3: Identificar qué archivar
  console.log('Paso 3/3 — Clasificando registros...\n');

  // Agrupar por PAGE_ID
  const pageIdGroups = {};
  for (const record of masterRecords) {
    if (!record.pageId) continue;
    if (!pageIdGroups[record.pageId]) pageIdGroups[record.pageId] = [];
    pageIdGroups[record.pageId].push(record);
  }

  const toArchive = [];
  let orphanCount = 0;
  let duplicateCount = 0;
  const orphansByOrigen = {};
  const activeDuplicates = [];

  for (const [pageId, group] of Object.entries(pageIdGroups)) {
    const isOrphan = !allSourceIds.has(pageId);

    if (isOrphan) {
      // Todos los registros con este PAGE_ID son huérfanos (incluye duplicados huérfanos)
      for (const record of group) {
        toArchive.push({
          masterRecordId: record.masterRecordId,
          nombre: record.nombre,
          razon: `huérfano | ${record.origen}`
        });
        orphanCount++;
        orphansByOrigen[record.origen] = (orphansByOrigen[record.origen] || 0) + 1;
      }
    } else if (group.length > 1) {
      // Duplicado con fuente ACTIVA: conservar el más reciente
      const sorted = [...group].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      const [keep, ...extras] = sorted;
      activeDuplicates.push({ pageId, nombre: keep.nombre, keep: keep.masterRecordId, extras });
      for (const record of extras) {
        toArchive.push({
          masterRecordId: record.masterRecordId,
          nombre: record.nombre,
          razon: `duplicado activo (se conserva ${keep.masterRecordId})`
        });
        duplicateCount++;
      }
    }
  }

  // Registros sin PAGE_ID (no se archivan automáticamente, requieren revisión manual)
  const sinPageId = masterRecords.filter(r => !r.pageId);

  // ─────────────────────────────────────────────
  // RESUMEN DEL PLAN
  // ─────────────────────────────────────────────

  console.log('========================================');
  console.log('PLAN DE LIMPIEZA');
  console.log('========================================');
  console.log(`Total a archivar: ${toArchive.length}`);
  console.log(`  Huérfanos:                ${orphanCount}`);
  console.log(`  Duplicados con fuente activa: ${duplicateCount}`);
  console.log('');
  console.log('Huérfanos por origen:');
  for (const [origen, count] of Object.entries(orphansByOrigen)) {
    console.log(`  ${origen.padEnd(28)} ${count}`);
  }

  if (activeDuplicates.length > 0) {
    console.log('\nDuplicados con fuente activa (se conserva el más reciente):');
    for (const d of activeDuplicates) {
      console.log(`  "${d.nombre}"`);
      console.log(`    Conservar:  ${d.keep}`);
      for (const e of d.extras) {
        console.log(`    Archivar:   ${e.masterRecordId}`);
      }
    }
  }

  if (sinPageId.length > 0) {
    console.log(`\nSin PAGE_ID (requieren revisión manual, NO se archivan aquí): ${sinPageId.length}`);
  }

  if (DRY_RUN) {
    console.log('\n========================================');
    console.log('DRY RUN activo. No se modificó nada.');
    console.log('');
    console.log('Para ejecutar el borrado real:');
    console.log('  1. Abre cleanupByPageId.js');
    console.log('  2. Cambia: const DRY_RUN = false;');
    console.log('  3. Ejecuta: node cleanupByPageId.js');
    console.log('  4. Luego verifica: node verify.js');
    console.log('========================================\n');
    return;
  }

  // ─────────────────────────────────────────────
  // EJECUCIÓN
  // ─────────────────────────────────────────────

  console.log('\n========================================');
  console.log('EJECUTANDO LIMPIEZA...');
  console.log('========================================\n');

  const counters = { archived: 0, dryRun: 0, skipped: 0, errors: 0 };

  for (let i = 0; i < toArchive.length; i++) {
    const item = toArchive[i];
    await archiveRecord(item.masterRecordId, item.nombre, item.razon, counters);
    await sleep(DELAY_MS);

    if ((i + 1) % 25 === 0 || i + 1 === toArchive.length) {
      console.log(`  Progreso: ${i + 1}/${toArchive.length} | Archivados: ${counters.archived} | Errores: ${counters.errors}`);
    }
  }

  console.log('\n========================================');
  console.log('LIMPIEZA TERMINADA');
  console.log(`  Archivados: ${counters.archived}`);
  console.log(`  Omitidos (ya archivados): ${counters.skipped}`);
  console.log(`  Errores: ${counters.errors}`);
  console.log('');
  console.log('Verifica el resultado:');
  console.log('  node verify.js');
  console.log('========================================\n');
};

main().catch(error => {
  console.error('[ERROR cleanupByPageId]', error);
  process.exit(1);
});