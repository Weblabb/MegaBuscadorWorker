/**
 * lib/log.js
 * Logger con niveles. Controla verbosidad con LOG_LEVEL en .env.
 * Niveles: error < info < debug
 */

const LEVELS = { error: 0, info: 1, debug: 2 };
const CURRENT = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

const log = {
  error: (...args) => CURRENT >= LEVELS.error && console.error(...args),
  info:  (...args) => CURRENT >= LEVELS.info  && console.log(...args),
  debug: (...args) => CURRENT >= LEVELS.debug && console.log(...args),
};

module.exports = log;