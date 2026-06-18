/**
 * diagnose.js
 * Solo lectura. No modifica nada.
 *
 * Detecta dos tipos de problema en INDICE_MASTER:
 *   - DUPLICADOS: misma PAGE_ID indexada más de una vez
 *   - HUÉRFANOS: PAGE_ID que ya no existe como página activa en ninguna base fuente
 *
 * Uso: node diagnose.js
 */

require('dotenv').config();

const notion = require('./lib/notionClient');
const { INDICE_MASTER, dbMap } = require('./config');

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
    for (const page of response.results) {
      ids.add(page.id);
    }
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
      const pageIdProp = page.properties?.PAGE_ID;
      const pageId = pageIdProp?.rich_text?.map(t => t.plain_text).join('').trim() || '';

      const origenProp = page.properties?.Origen_Base;
      const origen = origenProp?.multi_select?.[0]?.name || 'SIN ORIGEN';

      const nombreProp = Object.values(page.properties).find(p => p.type === 'title');
      const nombre = nombreProp?.title?.map(t => t.plain_text).join('').trim() || '(sin título)';

      records.push({
        masterRecordId: page.id,  // ID del registro en INDICE_MASTER
        pageId,                    // PAGE_ID almacenado como campo de texto
        origen,
        nombre
      });
    }

    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);

  return records;
};

// ─────────────────────────────────────────────
// Análisis
// ─────────────────────────────────────────────

const main = async () => {
  console.log('\n========================================');
  console.log('  DIAGNÓSTICO: DUPLICADOS Y HUÉRFANOS');
  console.log('========================================\n');

  // 1. Cargar IDs activos de todas las bases fuente
  console.log('Paso 1/2 — Leyendo bases fuente...\n');
  const allSourceIds = new Set();
  const sourceCountByBase = {};

  for (const [dsId, config] of Object.entries(dbMap)) {
    process.stdout.write(`  ${config.origen.padEnd(26)} `);
    const ids = await getSourcePageIds(dsId);
    ids.forEach(id => allSourceIds.add(id));
    sourceCountByBase[config.origen] = ids.size;
    console.log(`${ids.size} páginas activas`);
  }

  console.log(`\n  Total IDs únicos en fuentes: ${allSourceIds.size}\n`);

  // 2. Cargar todos los registros de INDICE_MASTER
  console.log('Paso 2/2 — Leyendo INDICE_MASTER...\n');
  const masterRecords = await getMasterRecords();
  console.log(`  Total registros en INDICE_MASTER: ${masterRecords.length}\n`);

  // ─────────────────────────────────────────────
  // ANÁLISIS A: DUPLICADOS
  // Mismo PAGE_ID aparece más de una vez en INDICE_MASTER
  // ─────────────────────────────────────────────

  const pageIdGroups = {};
  for (const record of masterRecords) {
    if (!record.pageId) continue;
    if (!pageIdGroups[record.pageId]) pageIdGroups[record.pageId] = [];
    pageIdGroups[record.pageId].push(record);
  }

  const duplicateGroups = Object.entries(pageIdGroups).filter(([, group]) => group.length > 1);

  // Contar por origen
  const duplicatesByOrigen = {};
  let totalExtraByDuplication = 0;

  for (const [, group] of duplicateGroups) {
    const origen = group[0].origen;
    if (!duplicatesByOrigen[origen]) duplicatesByOrigen[origen] = { groups: 0, extraRecords: 0 };
    duplicatesByOrigen[origen].groups++;
    duplicatesByOrigen[origen].extraRecords += group.length - 1; // 1 es legítimo, el resto son extra
    totalExtraByDuplication += group.length - 1;
  }

  console.log('========================================');
  console.log(`ANÁLISIS A — DUPLICADOS`);
  console.log(`PAGE_IDs con más de 1 registro en INDICE_MASTER: ${duplicateGroups.length}`);
  console.log(`Registros extra por duplicación: ${totalExtraByDuplication}`);
  console.log('========================================');

  if (duplicateGroups.length === 0) {
    console.log('  No se encontraron duplicados.');
  } else {
    for (const [origen, stats] of Object.entries(duplicatesByOrigen)) {
      console.log(`  ${origen}: ${stats.groups} PAGE_IDs duplicados, ${stats.extraRecords} registros extra`);
    }

    console.log('\nDetalle primeros 10 grupos duplicados:');
    for (const [pageId, group] of duplicateGroups.slice(0, 10)) {
      console.log(`\n  PAGE_ID: ${pageId}`);
      console.log(`  Nombre:  "${group[0].nombre}"`);
      console.log(`  Origen:  ${group[0].origen}`);
      console.log(`  Registros en INDICE_MASTER (${group.length}):`);
      for (const r of group) {
        console.log(`    Master record ID: ${r.masterRecordId}`);
      }
    }
    if (duplicateGroups.length > 10) {
      console.log(`\n  ... y ${duplicateGroups.length - 10} grupos más`);
    }
  }

  // ─────────────────────────────────────────────
  // ANÁLISIS B: HUÉRFANOS
  // PAGE_ID en INDICE_MASTER que ya no existe en ninguna base fuente activa
  // ─────────────────────────────────────────────

  const orphans = masterRecords.filter(r => r.pageId && !allSourceIds.has(r.pageId));

  const orphansByOrigen = {};
  for (const r of orphans) {
    if (!orphansByOrigen[r.origen]) orphansByOrigen[r.origen] = [];
    orphansByOrigen[r.origen].push(r);
  }

  console.log('\n========================================');
  console.log(`ANÁLISIS B — HUÉRFANOS`);
  console.log(`Registros en INDICE_MASTER sin página activa en fuente: ${orphans.length}`);
  console.log('========================================');

  if (orphans.length === 0) {
    console.log('  No se encontraron huérfanos.');
  } else {
    for (const [origen, list] of Object.entries(orphansByOrigen)) {
      console.log(`  ${origen}: ${list.length}`);
    }

    console.log('\nPrimeros 10 ejemplos:');
    for (const r of orphans.slice(0, 10)) {
      console.log(`  Master ID: ${r.masterRecordId}`);
      console.log(`  PAGE_ID:   ${r.pageId}`);
      console.log(`  Origen:    ${r.origen}`);
      console.log(`  Nombre:    "${r.nombre}"\n`);
    }
    if (orphans.length > 10) {
      console.log(`  ... y ${orphans.length - 10} más`);
    }
  }

  // ─────────────────────────────────────────────
  // ANÁLISIS C: SIN PAGE_ID
  // Registros en INDICE_MASTER que tienen el campo PAGE_ID vacío
  // ─────────────────────────────────────────────

  const sinPageId = masterRecords.filter(r => !r.pageId);

  console.log('\n========================================');
  console.log(`ANÁLISIS C — SIN PAGE_ID`);
  console.log(`Registros en INDICE_MASTER con PAGE_ID vacío: ${sinPageId.length}`);
  console.log('========================================');

  if (sinPageId.length > 0) {
    for (const r of sinPageId.slice(0, 10)) {
      console.log(`  Master ID: ${r.masterRecordId} | ${r.origen} | "${r.nombre}"`);
    }
    if (sinPageId.length > 10) {
      console.log(`  ... y ${sinPageId.length - 10} más`);
    }
  } else {
    console.log('  Todos los registros tienen PAGE_ID. Bien.');
  }

  // ─────────────────────────────────────────────
  // RESUMEN FINAL
  // ─────────────────────────────────────────────

  const totalExtra = masterRecords.length - allSourceIds.size;
  const explicados = totalExtraByDuplication + orphans.length + sinPageId.length;

  console.log('\n========================================');
  console.log('RESUMEN');
  console.log('========================================');
  console.log(`Total páginas activas en fuentes:    ${allSourceIds.size}`);
  console.log(`Total registros en INDICE_MASTER:    ${masterRecords.length}`);
  console.log(`Diferencia (extra en master):        ${totalExtra}`);
  console.log('');
  console.log(`  De esos extra:`);
  console.log(`  Por duplicación:                   ${totalExtraByDuplication}`);
  console.log(`  Por huérfanos (fuente eliminada):  ${orphans.length}`);
  console.log(`  Sin PAGE_ID:                       ${sinPageId.length}`);
  console.log(`  Total explicados:                  ${explicados}`);
  if (totalExtra !== explicados) {
    console.log(`  No explicados:                     ${totalExtra - explicados} (revisar manualmente)`);
  }
  console.log('========================================\n');
};

main().catch(error => {
  console.error('[ERROR diagnose]', error);
  process.exit(1);
});