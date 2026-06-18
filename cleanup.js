/**
 * cleanup.js
 * Script unificado de limpieza de INDICE_MASTER.
 * Reemplaza cleanupOrphans.js y cleanupByPageId.js.
 *
 * Detecta y archiva tres tipos de problemas:
 *
 *   A) Huérfanos por PAGE_ID
 *      El PAGE_ID guardado en INDICE_MASTER ya no existe como página
 *      activa en ninguna base fuente. La página fue eliminada o movida.
 *
 *   B) Huérfanos por relación vacía
 *      El PAGE_ID existe en la fuente pero la propiedad de relación en
 *      INDICE_MASTER está vacía. Indica un bug de creación donde el
 *      registro se guardó sin establecer la relación.
 *
 *   C) Duplicados activos
 *      El mismo PAGE_ID aparece más de una vez en INDICE_MASTER y la
 *      página fuente sigue activa. Se conserva el registro más reciente
 *      y se archivan los extra.
 *
 * IMPORTANTE: DRY_RUN = true por defecto.
 * Cambia a false SOLO para ejecutar el borrado real.
 * No toca las bases fuente originales.
 *
 * Uso:
 *   node cleanup.js          → DRY RUN, solo muestra el plan
 *   (cambiar DRY_RUN = false y volver a ejecutar para borrado real)
 */

require('dotenv').config();

const notion = require('./lib/notionClient');
const { INDICE_MASTER, dbMap } = require('./config');

const DRY_RUN = !process.argv.includes('--execute');

const DELAY_MS = 350;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─────────────────────────────────────────────
// Mapeo de relaciones por Origen_Base
// Necesario para verificar si la relación está vacía (Categoría B)
// ─────────────────────────────────────────────

const relationByOrigen = Object.values(dbMap).reduce((acc, config) => {
  acc[config.origen] = config.relacion;
  return acc;
}, {});

// Alias para valores anteriores de Origen_Base
relationByOrigen['PROY Y PROG'] = 'Programas y Proyectos';
relationByOrigen['PANEL WP']   = 'Dominio Wordpress Panel y Correos Contraseñas y siteground,REDES';

// ─────────────────────────────────────────────
// Lectura de bases fuente
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
    for (const page of response.results) ids.add(page.id);
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);

  return ids;
};

// ─────────────────────────────────────────────
// Lectura de INDICE_MASTER
// ─────────────────────────────────────────────

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
      if (page.archived) continue;

      const pageIdProp = page.properties?.PAGE_ID;
      const pageId = pageIdProp?.rich_text?.map(t => t.plain_text).join('').trim() || '';

      const origenProp = page.properties?.Origen_Base;
      const origen = origenProp?.multi_select?.[0]?.name || 'SIN ORIGEN';

      const nombreProp = Object.values(page.properties).find(p => p.type === 'title');
      const nombre = nombreProp?.title?.map(t => t.plain_text).join('').trim() || '(sin título)';

      // Verificar si la relación está activa
      const relationName = relationByOrigen[origen];
      const relationProp = relationName ? page.properties?.[relationName] : null;
      const hasRelation =
        relationProp?.type === 'relation' &&
        Array.isArray(relationProp.relation) &&
        relationProp.relation.length > 0;

      records.push({
        masterRecordId: page.id,
        pageId,
        origen,
        nombre,
        hasRelation,
        updatedAt: page.last_edited_time || ''
      });
    }

    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);

  return records;
};

// ─────────────────────────────────────────────
// Archivar registro
// ─────────────────────────────────────────────

const archiveRecord = async (masterRecordId, nombre, categoria, counters) => {
  if (DRY_RUN) {
    counters.dryRun++;
    return;
  }

  try {
    await notion.pages.update({ page_id: masterRecordId, archived: true });
    counters.archived++;
  } catch (error) {
    if (error.code === 'validation_error' && error.message?.includes('archived')) {
      counters.skipped++;
    } else {
      console.error(`  [ERROR] "${nombre}": ${error.message}`);
      counters.errors++;
    }
  }
};

// ─────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────

const main = async () => {
  console.log('\n========================================');
  console.log('  CLEANUP UNIFICADO — INDICE_MASTER');
  console.log(`  Modo: ${DRY_RUN ? 'DRY RUN — no se archiva nada' : '*** BORRADO REAL ***'}`);
  console.log('========================================\n');

  // PASO 1: Cargar IDs activos de todas las bases fuente
  console.log('Paso 1/3 — Leyendo bases fuente...\n');
  const allSourceIds = new Set();

  for (const [dsId, config] of Object.entries(dbMap)) {
    process.stdout.write(`  ${config.origen.padEnd(28)} `);
    const ids = await getSourcePageIds(dsId);
    ids.forEach(id => allSourceIds.add(id));
    console.log(`${ids.size} activas`);
  }
  console.log(`\n  Total IDs activos en fuentes: ${allSourceIds.size}\n`);

  // PASO 2: Cargar todos los registros de INDICE_MASTER
  console.log('Paso 2/3 — Leyendo INDICE_MASTER...\n');
  const masterRecords = await getMasterRecords();
  console.log(`  Total registros: ${masterRecords.length}\n`);

  // PASO 3: Clasificar registros
  console.log('Paso 3/3 — Clasificando registros...\n');

  // Agrupar por PAGE_ID para detectar duplicados
  const pageIdGroups = {};
  for (const record of masterRecords) {
    if (!record.pageId) continue;
    if (!pageIdGroups[record.pageId]) pageIdGroups[record.pageId] = [];
    pageIdGroups[record.pageId].push(record);
  }

  const toArchive = [];
  const stats = {
    orphanById:       0,  // Categoría A
    orphanByRelation: 0,  // Categoría B
    duplicate:        0   // Categoría C
  };
  const byOrigen = {};

  for (const [pageId, group] of Object.entries(pageIdGroups)) {
    const sourceExists = allSourceIds.has(pageId);

    if (!sourceExists) {
      // CATEGORÍA A: página fuente eliminada o movida
      // Todos los registros de este PAGE_ID son huérfanos (incluye duplicados huérfanos)
      for (const record of group) {
        toArchive.push({ ...record, categoria: 'A - huérfano por PAGE_ID' });
        stats.orphanById++;
        byOrigen[record.origen] = (byOrigen[record.origen] || 0) + 1;
      }

    } else if (group.length > 1) {
      // CATEGORÍA C: duplicado con fuente activa
      // Conservar el más reciente, archivar el resto
      const sorted = [...group].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      const [keep, ...extras] = sorted;

      console.log(`  [DUPLICADO] "${keep.nombre}" | ${keep.origen}`);
      console.log(`    Conservar:  ${keep.masterRecordId}`);

      for (const record of extras) {
        toArchive.push({ ...record, categoria: 'C - duplicado activo' });
        stats.duplicate++;
        console.log(`    Archivar:   ${record.masterRecordId}`);
      }

    } else {
      // Un solo registro con fuente activa
      // CATEGORÍA B: verificar si la relación está vacía
      const record = group[0];
      if (!record.hasRelation && record.origen !== 'SIN ORIGEN') {
        toArchive.push({ ...record, categoria: 'B - huérfano por relación vacía' });
        stats.orphanByRelation++;
        byOrigen[record.origen] = (byOrigen[record.origen] || 0) + 1;
      }
    }
  }

  // Registros sin PAGE_ID (no se archivan automáticamente)
  const sinPageId = masterRecords.filter(r => !r.pageId);

  // ─────────────────────────────────────────────
  // Reporte del plan
  // ─────────────────────────────────────────────

  console.log('\n========================================');
  console.log('PLAN DE LIMPIEZA');
  console.log('========================================');
  console.log(`Total a archivar:                  ${toArchive.length}`);
  console.log(`  A) Huérfanos por PAGE_ID:        ${stats.orphanById}`);
  console.log(`  B) Huérfanos por relación vacía: ${stats.orphanByRelation}`);
  console.log(`  C) Duplicados activos:           ${stats.duplicate}`);

  if (sinPageId.length > 0) {
    console.log(`\n  Sin PAGE_ID (revisión manual):   ${sinPageId.length}`);
    for (const r of sinPageId.slice(0, 5)) {
      console.log(`    ${r.masterRecordId} | ${r.origen} | "${r.nombre}"`);
    }
  }

  if (Object.keys(byOrigen).length > 0) {
    console.log('\nPor origen:');
    for (const [origen, count] of Object.entries(byOrigen)) {
      console.log(`  ${origen.padEnd(30)} ${count}`);
    }
  }

  if (DRY_RUN) {
    console.log('\n========================================');
    console.log('DRY RUN activo. No se modificó nada.');
    console.log('');
    console.log('Para ejecutar el borrado real:');
    console.log('  1. Abre cleanup.js');
    console.log('  2. Cambia: const DRY_RUN = false;');
    console.log('  3. Ejecuta: node cleanup.js');
    console.log('  4. Verifica: node verify.js');
    console.log('========================================\n');
    return;
  }

  // ─────────────────────────────────────────────
  // Ejecución del borrado
  // ─────────────────────────────────────────────

  console.log('\n========================================');
  console.log('EJECUTANDO LIMPIEZA...');
  console.log('========================================\n');

  const counters = { archived: 0, dryRun: 0, skipped: 0, errors: 0 };

  for (let i = 0; i < toArchive.length; i++) {
    const item = toArchive[i];
    await archiveRecord(item.masterRecordId, item.nombre, item.categoria, counters);
    await sleep(DELAY_MS);

    if ((i + 1) % 25 === 0 || i + 1 === toArchive.length) {
      console.log(`  Progreso: ${i + 1}/${toArchive.length} | Archivados: ${counters.archived} | Errores: ${counters.errors}`);
    }
  }

  console.log('\n========================================');
  console.log('LIMPIEZA TERMINADA');
  console.log(`  Archivados: ${counters.archived}`);
  console.log(`  Omitidos:   ${counters.skipped}`);
  console.log(`  Errores:    ${counters.errors}`);
  console.log('');
  console.log('Verifica el resultado: node verify.js');
  console.log('========================================\n');
};

main().catch(error => {
  console.error('[ERROR cleanup]', error);
  process.exit(1);
});