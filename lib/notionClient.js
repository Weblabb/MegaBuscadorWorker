/**
 * lib/notionClient.js
 * Cliente Notion único, reutilizado en toda la app.
 */

const { Client } = require('@notionhq/client');
const { NOTION_TOKEN } = require('../config');

const notion = new Client({ auth: NOTION_TOKEN });

module.exports = notion;