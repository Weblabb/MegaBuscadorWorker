/**
 * lib/retry.js
 * Reintentos con backoff. Espera larga cuando Notion marca rate_limited.
 * Entrada: función async, contexto string (opcional)
 * Salida: resultado de la función, o lanza error si fallan todos los intentos
 */

const log = require('./log');

const MAX_RETRIES = Number(process.env.RETRY_MAX || 3);
const BASE_DELAY_MS = Number(process.env.RETRY_BASE_DELAY_MS || 2000);
const RATE_LIMIT_DELAY_MS = Number(process.env.RETRY_RATE_LIMIT_MS || 60000);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Decide si vale la pena reintentar
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

// Ejecuta fn con reintentos. Espera más en rate_limited.
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

      let waitMs;

      if (error.code === 'rate_limited') {
        waitMs = RATE_LIMIT_DELAY_MS * attempt; // 60s, 120s, 180s
        log.info(`[RATE LIMIT] Notion alcanzó límite. Esperando ${waitMs / 1000}s...`);
      } else {
        waitMs = BASE_DELAY_MS * attempt; // 2s, 4s, 6s
      }

      log.info(`[RETRY ${attempt}/${MAX_RETRIES}] ${context} - ${error.message}`);
      await sleep(waitMs);
    }
  }

  throw lastError;
};

module.exports = { withRetry, isRetryable };