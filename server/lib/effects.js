/**
 * Server-side effects module.
 * Re-exports shared effects generation with seedrandom support.
 */
import seedrandom from 'seedrandom';
import {
  generateUniqueEffects as generateUniqueEffectsShared,
  buildFilterString as buildFilterStringShared
} from '../../lib/effects-shared.js';

/**
 * Generate unique random effects.
 * @param {number} count - Number of unique effects to generate
 * @param {string} [seed] - Optional seed for deterministic generation
 * @returns {Array<{rotation: number, brightness: number, contrast: number, saturation: number}>}
 */
export function generateUniqueEffects(count, seed) {
  const rng = seed ? seedrandom(seed) : Math.random;
  return generateUniqueEffectsShared(rng, count);
}

/**
 * Build FFmpeg filter string from effect object.
 * @param {Object} effects - Effect object with rotation, brightness, contrast, saturation
 * @returns {string} FFmpeg filter string
 */
export function buildFilterString(effects) {
  return buildFilterStringShared(effects);
}
