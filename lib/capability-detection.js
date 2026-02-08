/**
 * Browser capability detection for client-side processing.
 * Checks cross-origin isolation (COOP+COEP) and SharedArrayBuffer availability.
 */

/**
 * Check if browser supports client-side FFmpeg.wasm processing.
 * Requires both cross-origin isolation and SharedArrayBuffer.
 * @returns {boolean} True if client-side processing available
 */
export function supportsClientProcessing() {
  if (typeof window === 'undefined') {
    return false;
  }

  if (!window.crossOriginIsolated) {
    console.warn('[capability] Cross-origin isolation not enabled (COOP/COEP headers missing)');
    return false;
  }

  if (typeof SharedArrayBuffer === 'undefined') {
    console.warn('[capability] SharedArrayBuffer not available despite cross-origin isolation');
    return false;
  }

  return true;
}

/**
 * Get recommended processing mode based on browser capabilities.
 * @returns {'device'|'server'} Processing mode
 */
export function getProcessingMode() {
  return supportsClientProcessing() ? 'device' : 'server';
}
