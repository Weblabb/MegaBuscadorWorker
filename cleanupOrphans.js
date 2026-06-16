/**
 * cleanupOrphans.js
 * Busca registros huérfanos en INDICE_MASTER:
 * - Tienen Origen_Base
 * - Pero NO tienen llena su relación correspondiente
 *
 * IMPORTANTE: DRY_RUN está en true por defecto.
 * Cambia a false SOLO cuando quieras ejecutar el borrado real.
 * No toca las bases originales.
 */

require('dotenv').config();

const notion = require('./lib/notionClient');
const { INDICE_MASTER, dbMap } = require('./config');

const DRY_RUN = false; // Cambiar a false solo para ejecutar borrado real

// Relación esperada según Origen_Base
const relationByOrigen = Object.values(dbMap).reduce((acc, config) => {
    acc[config.origen] = config.relacion;
    return acc;
}, {});

// Alias para valores antiguos de Origen_Base
relationByOrigen['PROY Y PROG'] = 'Programas y Proyectos';
relationByOrigen['PANEL WP'] = 'Dominio Wordpress Panel y Correos Contraseñas y siteground,REDES';

const getText = (prop) => {
    if (!prop) return '';

    if (prop.type === 'title') {
        return prop.title?.map(t => t.plain_text).join('').trim() || '';
    }

    if (prop.type === 'rich_text') {
        return prop.rich_text?.map(t => t.plain_text).join('').trim() || '';
    }

    if (prop.type === 'select') {
        return prop.select?.name || '';
    }

    if (prop.type === 'multi_select') {
        return prop.multi_select?.[0]?.name || '';
    }

    return '';
};

const getAllIndexPages = async () => {
    const results = [];
    let start_cursor = undefined;

    do {
        const response = await notion.dataSources.query({
            data_source_id: INDICE_MASTER,
            start_cursor,
            page_size: 100
        });

        results.push(...response.results);
        start_cursor = response.has_more ? response.next_cursor : undefined;
    } while (start_cursor);

    return results;
};

const main = async () => {
    console.log('========================================');
    console.log('Cleanup de huérfanos en INDICE_MASTER');
    console.log(`Modo: ${DRY_RUN ? 'DRY_RUN - NO BORRA' : 'BORRADO REAL'}`);
    console.log('========================================');

    const pages = await getAllIndexPages();

    console.log(`Registros revisados: ${pages.length}`);

    let orphanCount = 0;
    let deletedCount = 0;

    for (const page of pages) {
        // Si la página ya está archivada, se salta para evitar error de Notion
        if (page.archived) {
            continue;
        }

        const props = page.properties;

        const nombre = getText(props.Nombre);
        const pageIdOrigen = getText(props.PAGE_ID);
        const origen = getText(props.Origen_Base);

        if (!origen) {
            continue;
        }

        const relationName = relationByOrigen[origen];

        if (!relationName) {
            console.log(`[SKIP] Origen sin relación configurada: ${origen} | ${nombre}`);
            continue;
        }

        const relationProp = props[relationName];

        const hasRelation =
            relationProp &&
            relationProp.type === 'relation' &&
            relationProp.relation &&
            relationProp.relation.length > 0;

        if (!hasRelation) {
            orphanCount++;

            console.log(`[HUÉRFANO] ${nombre}`);
            console.log(`  Origen_Base: ${origen}`);
            console.log(`  PAGE_ID: ${pageIdOrigen}`);
            console.log(`  Relación esperada: ${relationName}`);

            if (!DRY_RUN) {
                try {
                    await notion.pages.update({
                        page_id: page.id,
                        archived: true
                    });

                    deletedCount++;
                    console.log('  → Archivado en INDICE_MASTER');
                } catch (error) {
                    if (
                        error.code === 'validation_error' &&
                        error.message.includes('archived')
                    ) {
                        console.log('  → Ya estaba archivado, se omite.');
                        continue;
                    }

                    console.error(`  → ERROR al archivar: ${error.message}`);
                    continue;
                }
            } else {
                console.log('  → Se archivaría en INDICE_MASTER');
            }
        }
    }

    console.log('========================================');
    console.log(`Huérfanos encontrados: ${orphanCount}`);
    console.log(`Archivados: ${deletedCount}`);
    console.log('========================================');
};

main().catch(error => {
    console.error('[ERROR cleanupOrphans]', error);
    process.exit(1);
});