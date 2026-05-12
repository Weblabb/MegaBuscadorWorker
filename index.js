/**
 * index.js
 * Entrada de la app. Configura Express y conecta el webhook handler.
 */

const express = require('express');
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

// Arranque
app.listen(PORT, () => {
  console.log('================================================');
  console.log(`Worker corriendo en puerto ${PORT}`);
  console.log(`Bases configuradas: ${Object.keys(dbMap).length}`);
  console.log('================================================');
});