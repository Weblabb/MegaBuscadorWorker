/**
 * lib/lock.js
 * Lock en memoria con TTL de seguridad.
 * Si el proceso se cuelga, el lock se libera automáticamente después de LOCK_TTL_MS.
 */

const LOCK_TTL_MS = 60_000; // 60 segundos

const processingLocks = new Map(); // pageId -> timeoutId

/**
 * Intenta tomar el lock para un pageId.
 * Entrada: pageId (string)
 * Salida: true si lo tomó, false si ya estaba ocupado
 */
const acquire = (pageId) => {
  if (processingLocks.has(pageId)) return false;

  const timeoutId = setTimeout(() => {
    if (processingLocks.has(pageId)) {
      console.warn(`[LOCK] TTL vencido, liberando lock atascado: ${pageId}`);
      processingLocks.delete(pageId);
    }
  }, LOCK_TTL_MS);

  processingLocks.set(pageId, timeoutId);
  return true;
};

/**
 * Libera el lock de un pageId y cancela su TTL.
 * Entrada: pageId (string)
 */
const release = (pageId) => {
  const timeoutId = processingLocks.get(pageId);
  if (timeoutId) clearTimeout(timeoutId);
  processingLocks.delete(pageId);
};

module.exports = { acquire, release };