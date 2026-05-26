/**
 * index.js
 * Entrada de la app. Configura Express, conecta el webhook handler
 * y registra listeners globales para errores no atrapados.
 */

require('dotenv').config();

const express = require('express');
const log = require('./lib/log');
const { PORT, dbMap } = require('./config');
const webhookHandler = require('./handlers/webhookHandler');

const app = express();
app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.send('Worker activo');
});

// Webhook principal de Notion
app.post('/webhook', webhookHandler);

// Listeners globales: evitan que el Worker muera por un error no atrapado
process.on('unhandledRejection', (reason) => {
  log.error('[UNHANDLED REJECTION]', reason);
});

process.on('uncaughtException', (error) => {
  log.error('[UNCAUGHT EXCEPTION]', error);
});

// Arranque
app.listen(PORT, () => {
  log.info('================================================');
  log.info(`Worker corriendo en puerto ${PORT}`);
  log.info(`Bases configuradas: ${Object.keys(dbMap).length}`);
  log.info('================================================');
});