/**
 * lib/lock.js
 * Lock en memoria para evitar race condition.
 * Si dos webhooks del mismo pageId llegan simultáneos, el segundo se descarta.
 *
 * Nota: solo funciona dentro de una misma instancia del Worker.
 * Si se escala a múltiples instancias, migrar a Redis o similar.
 */

const processingLocks = new Set();

/**
 * Intenta tomar el lock para un pageId.
 * Entrada: pageId (string)
 * Salida: true si lo tomó, false si ya estaba ocupado
 */
const acquire = (pageId) => {
  if (processingLocks.has(pageId)) return false;
  processingLocks.add(pageId);
  return true;
};

/**
 * Libera el lock de un pageId.
 * Entrada: pageId (string)
 */
const release = (pageId) => {
  processingLocks.delete(pageId);
};

module.exports = { acquire, release };