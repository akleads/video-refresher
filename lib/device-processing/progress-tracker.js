/**
 * Progress Tracker for aggregating multi-worker video processing progress
 * Collects per-variation status and emits overall progress updates.
 */

export class ProgressTracker {
  /**
   * Create a progress tracker
   * @param {number} totalVariations - Total number of variations being processed
   * @param {Function} onUpdate - Callback function called with progress state
   */
  constructor(totalVariations, onUpdate) {
    this.totalVariations = totalVariations;
    this.onUpdate = onUpdate;
    this.variationStates = new Map();
    this.lastUpdatedVariation = 0;
    this.lastUpdatedProgress = 0;

    // Initialize all variations as pending
    for (let i = 0; i < totalVariations; i++) {
      this.variationStates.set(i, {
        progress: 0,
        status: 'pending'
      });
    }
  }

  /**
   * Update progress for a specific variation
   * @param {number} variationIndex - Index of the variation
   * @param {number} progress - Progress value (0-1)
   */
  updateVariationProgress(variationIndex, progress) {
    const state = this.variationStates.get(variationIndex);
    if (!state) return;

    // Update progress and status
    state.progress = progress;
    if (state.status === 'pending') {
      state.status = 'processing';
    }

    // Track most recently updated variation
    this.lastUpdatedVariation = variationIndex;
    this.lastUpdatedProgress = progress;

    this.emitUpdate();
  }

  /**
   * Mark a variation as complete
   * @param {number} variationIndex - Index of the variation
   */
  markComplete(variationIndex) {
    const state = this.variationStates.get(variationIndex);
    if (!state) return;

    state.progress = 1.0;
    state.status = 'complete';

    this.emitUpdate();
  }

  /**
   * Mark a variation as failed
   * @param {number} variationIndex - Index of the variation
   */
  markFailed(variationIndex) {
    const state = this.variationStates.get(variationIndex);
    if (!state) return;

    state.status = 'failed';

    this.emitUpdate();
  }

  /**
   * Emit progress update to callback
   */
  emitUpdate() {
    // Calculate overall progress (sum of all variation progresses / total)
    let totalProgress = 0;
    let completed = 0;
    let failed = 0;
    let processing = 0;
    let pending = 0;

    for (const [idx, state] of this.variationStates.entries()) {
      totalProgress += state.progress;

      switch (state.status) {
        case 'complete':
          completed++;
          break;
        case 'failed':
          failed++;
          break;
        case 'processing':
          processing++;
          break;
        case 'pending':
          pending++;
          break;
      }
    }

    const overall = totalProgress / this.totalVariations;

    // Find first active (processing) variation for display
    let currentVariation = 0;
    for (const [idx, state] of this.variationStates.entries()) {
      if (state.status === 'processing') {
        currentVariation = idx + 1; // 1-indexed for display
        break;
      }
    }

    // If no processing variations, use last completed or first pending
    if (currentVariation === 0) {
      if (completed > 0) {
        currentVariation = completed; // Show last completed
      } else {
        currentVariation = 1; // Default to first
      }
    }

    // Call update callback with structured state
    if (this.onUpdate) {
      this.onUpdate({
        overall,
        completed,
        failed,
        total: this.totalVariations,
        currentVariation,
        variationProgress: this.lastUpdatedProgress
      });
    }
  }

  /**
   * Reset tracker for reuse with a new video
   */
  reset() {
    this.variationStates.clear();
    this.lastUpdatedVariation = 0;
    this.lastUpdatedProgress = 0;

    // Re-initialize all variations as pending
    for (let i = 0; i < this.totalVariations; i++) {
      this.variationStates.set(i, {
        progress: 0,
        status: 'pending'
      });
    }
  }
}
