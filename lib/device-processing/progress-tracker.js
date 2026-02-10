/**
 * Progress Tracker for aggregating multi-worker video processing progress.
 * Tracks completed/failed counts and emits updates.
 */

export class ProgressTracker {
  constructor(totalVariations, onUpdate) {
    this.total = totalVariations;
    this.onUpdate = onUpdate;
    this.completed = 0;
    this.failed = 0;
  }

  markComplete() {
    this.completed++;
    this.emitUpdate();
  }

  markFailed() {
    this.failed++;
    this.emitUpdate();
  }

  emitUpdate() {
    if (this.onUpdate) {
      this.onUpdate({
        completed: this.completed,
        failed: this.failed,
        total: this.total
      });
    }
  }

  reset() {
    this.completed = 0;
    this.failed = 0;
  }
}
