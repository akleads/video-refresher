/**
 * Generate a random number within a range.
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @returns {number}
 */
function randomInRange(min, max) {
  return min + Math.random() * (max - min);
}

/**
 * Generate unique random effects matching v1 behavior.
 * @param {number} count - Number of unique effects to generate
 * @returns {Array<{rotation: number, brightness: number, contrast: number, saturation: number}>}
 */
export function generateUniqueEffects(count) {
  const effects = [];
  const seen = new Set();
  const maxAttempts = count * 100;
  let attempts = 0;

  while (effects.length < count && attempts < maxAttempts) {
    attempts++;

    // Match v1 ranges exactly
    const effect = {
      rotation: parseFloat(randomInRange(0.001, 0.01).toFixed(4)), // radians
      brightness: parseFloat(randomInRange(-0.05, 0.05).toFixed(4)),
      contrast: parseFloat(randomInRange(0.95, 1.05).toFixed(4)),
      saturation: parseFloat(randomInRange(0.95, 1.05).toFixed(4))
    };

    const key = JSON.stringify(effect);
    if (!seen.has(key)) {
      seen.add(key);
      effects.push(effect);
    }
  }

  if (effects.length < count) {
    throw new Error(`Unable to generate ${count} unique effect combinations after ${maxAttempts} attempts`);
  }

  return effects;
}

/**
 * Build FFmpeg filter string from effect object.
 * @param {Object} effects - Effect object with rotation, brightness, contrast, saturation
 * @returns {string} FFmpeg filter string
 */
export function buildFilterString(effects) {
  return `rotate=${effects.rotation}:fillcolor=black@0,eq=brightness=${effects.brightness}:contrast=${effects.contrast}:saturation=${effects.saturation}`;
}
