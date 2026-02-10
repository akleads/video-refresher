/**
 * Worker Pool Manager for parallel FFmpeg video processing
 * Orchestrates multiple Web Workers to process video variations concurrently.
 */

import { ProgressTracker } from './progress-tracker.js';

export class WorkerPool {
  constructor(workerCount = 2) {
    // Detect mobile — reduce workers and skip multi-threaded
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    this.workerCount = isMobile ? 1 : workerCount;
    this.singleThreadOnly = isMobile;
    this.workers = [];
    this.jobQueue = [];
    this.activeJobs = new Map();
    this.cancelled = false;
    this.completedResults = [];
    this.onProgress = null;
    this.onVariationComplete = null;
    this.originalBuffer = null;
    this.progressTracker = null;
  }

  /**
   * Initialize all workers
   * @returns {Promise<{success: boolean, mode: string, failedWorkers: number}>}
   */
  async init() {
    const initPromises = [];

    for (let i = 0; i < this.workerCount; i++) {
      const worker = new Worker('./lib/device-processing/ffmpeg-worker.js', { type: 'module' });

      const workerState = {
        worker,
        busy: false,
        initialized: false,
        mode: null
      };

      this.workers.push(workerState);

      // Set up message and error handlers
      worker.onmessage = (e) => this.handleMessage(i, e);
      worker.onerror = (e) => this.handleError(i, e);

      // Create init promise
      const initPromise = new Promise((resolve) => {
        const initHandler = (e) => {
          if (e.data.type === 'init-complete') {
            workerState.initialized = true;
            workerState.mode = e.data.mode;
            resolve({ success: true, mode: e.data.mode });
          } else if (e.data.type === 'init-error') {
            resolve({ success: false, error: e.data.error });
          }
        };

        worker.addEventListener('message', initHandler, { once: true });
      });

      initPromises.push(initPromise);

      // Send init message
      worker.postMessage({ type: 'init', singleThreadOnly: this.singleThreadOnly });
    }

    // Wait for all workers to initialize
    const results = await Promise.all(initPromises);

    const failedWorkers = results.filter(r => !r.success).length;
    const successfulWorkers = results.filter(r => r.success);

    if (failedWorkers === this.workerCount) {
      throw new Error('All workers failed to initialize. Server processing may be required.');
    }

    // Determine overall mode (prefer multi-threaded if any worker supports it)
    const mode = successfulWorkers.some(r => r.mode === 'multi-threaded')
      ? 'multi-threaded'
      : 'single-threaded';

    return {
      success: true,
      mode,
      failedWorkers
    };
  }

  /**
   * Process a video file with multiple effects
   * @param {File} videoFile - Input video file
   * @param {Array<Object>} effects - Array of effect objects
   * @param {Function} onProgress - Progress callback
   * @param {Function} onVariationComplete - Variation completion callback
   * @returns {Promise<{results: Array, completed: number, total: number, cancelled: boolean}>}
   */
  async processVideo(videoFile, effects, onProgress, onVariationComplete) {
    // Store callbacks
    this.onProgress = onProgress;
    this.onVariationComplete = onVariationComplete;

    // Read the file as ArrayBuffer and store it
    this.originalBuffer = await videoFile.arrayBuffer();

    // Get video duration (rough estimate - for better accuracy, could use video element)
    // For now, we'll pass 0 and let FFmpeg handle it
    const totalDuration = 0;

    // Get base name without extension
    const videoBaseName = videoFile.name.replace(/\.[^/.]+$/, '');

    // Create progress tracker
    this.progressTracker = new ProgressTracker(effects.length, onProgress);

    // Create jobs for each effect
    const jobPromises = effects.map((effect, idx) => {
      return new Promise((resolve, reject) => {
        const job = {
          effect,
          outputName: `${videoBaseName}/variation_${String(idx + 1).padStart(3, '0')}.mp4`,
          totalDuration,
          retries: 0,
          variationIndex: idx,
          resolve,
          reject
        };

        this.jobQueue.push(job);
      });
    });

    // Start processing
    this.processNext();

    // Wait for all jobs to complete
    const results = await Promise.all(jobPromises);

    return {
      results: this.completedResults,
      completed: this.completedResults.length,
      total: effects.length,
      cancelled: this.cancelled
    };
  }

  /**
   * Process next job in queue
   */
  processNext() {
    // Check if we should continue
    if (this.cancelled || this.jobQueue.length === 0) {
      return;
    }

    // Find an available worker
    const availableWorkerIdx = this.workers.findIndex(
      w => w.initialized && !w.busy
    );

    if (availableWorkerIdx === -1) {
      // No workers available right now
      return;
    }

    // Dequeue next job
    const job = this.jobQueue.shift();
    const workerState = this.workers[availableWorkerIdx];

    // Mark worker as busy and store active job
    workerState.busy = true;
    this.activeJobs.set(availableWorkerIdx, job);

    // Create fresh buffer copy for transfer (originalBuffer must not be neutered)
    const videoData = new Uint8Array(this.originalBuffer).slice();

    // Send process message with transferable buffer
    workerState.worker.postMessage(
      {
        type: 'process',
        videoData,
        effect: job.effect,
        outputName: job.outputName,
        totalDuration: job.totalDuration
      },
      [videoData.buffer]
    );
  }

  /**
   * Handle worker message
   * @param {number} workerIdx - Worker index
   * @param {MessageEvent} event - Message event
   */
  handleMessage(workerIdx, event) {
    const { type } = event.data;
    const job = this.activeJobs.get(workerIdx);
    const workerState = this.workers[workerIdx];

    switch (type) {
      case 'complete': {
        if (!job) return;

        // Create blob from result
        const blob = new Blob([event.data.result], { type: 'video/mp4' });
        const result = {
          name: event.data.outputName,
          blob
        };

        // Store result
        this.completedResults.push(result);

        // Update progress tracker
        this.progressTracker.markComplete(job.variationIndex);

        // Call variation complete callback
        if (this.onVariationComplete) {
          this.onVariationComplete(job.variationIndex, true);
        }

        // Mark worker as not busy
        workerState.busy = false;
        this.activeJobs.delete(workerIdx);

        // Resolve job promise
        job.resolve(result);

        // Process next job
        this.processNext();
        break;
      }

      case 'progress': {
        if (!job) return;

        // Update progress tracker with worker's progress
        this.progressTracker.updateVariationProgress(
          job.variationIndex,
          event.data.progress
        );
        break;
      }

      case 'error': {
        if (!job) return;

        // Check if we should retry
        if (job.retries < 1) {
          // Retry once
          job.retries++;

          // Push back to front of queue
          this.jobQueue.unshift(job);

          // Mark worker as not busy
          workerState.busy = false;
          this.activeJobs.delete(workerIdx);

          // Process next (which will be this retry)
          this.processNext();
        } else {
          // Failed after retry - mark as failed and skip
          console.warn(`Variation ${job.variationIndex} failed after retry:`, event.data.error);

          // Update progress tracker
          this.progressTracker.markFailed(job.variationIndex);

          // Call variation complete callback with failure status
          if (this.onVariationComplete) {
            this.onVariationComplete(job.variationIndex, false);
          }

          // Mark worker as not busy
          workerState.busy = false;
          this.activeJobs.delete(workerIdx);

          // Resolve with null (don't reject - continue batch)
          job.resolve(null);

          // Process next job
          this.processNext();
        }
        break;
      }
    }
  }

  /**
   * Handle worker error
   * @param {number} workerIdx - Worker index
   * @param {ErrorEvent} error - Error event
   */
  handleError(workerIdx, error) {
    console.error(`Worker ${workerIdx} error:`, error);

    const job = this.activeJobs.get(workerIdx);
    if (!job) return;

    // Same retry logic as message error
    const workerState = this.workers[workerIdx];

    if (job.retries < 1) {
      // Retry once
      job.retries++;

      // Push back to queue
      this.jobQueue.unshift(job);

      // Mark worker as not busy
      workerState.busy = false;
      this.activeJobs.delete(workerIdx);

      // Process next
      this.processNext();
    } else {
      // Failed after retry
      console.warn(`Variation ${job.variationIndex} failed after retry (worker error)`);

      // Update progress tracker
      this.progressTracker.markFailed(job.variationIndex);

      // Call variation complete callback
      if (this.onVariationComplete) {
        this.onVariationComplete(job.variationIndex, false);
      }

      // Mark worker as not busy
      workerState.busy = false;
      this.activeJobs.delete(workerIdx);

      // Resolve with null
      job.resolve(null);

      // Process next
      this.processNext();
    }
  }

  /**
   * Cancel all remaining work
   * @returns {Array} Completed results so far
   */
  cancel() {
    this.cancelled = true;

    // Clear the queue
    this.jobQueue = [];

    // Reject all active jobs
    for (const [workerIdx, job] of this.activeJobs.entries()) {
      job.reject(new Error('Processing cancelled'));
    }

    this.activeJobs.clear();

    // Return completed results for partial download
    return this.completedResults;
  }

  /**
   * Terminate all workers and clean up
   */
  async terminate() {
    // Send terminate message to each worker
    for (const workerState of this.workers) {
      workerState.worker.postMessage({ type: 'terminate' });
    }

    // Give workers time to clean up
    await new Promise(resolve => setTimeout(resolve, 100));

    // Terminate workers
    for (const workerState of this.workers) {
      workerState.worker.terminate();
    }

    // Clear all state
    this.workers = [];
    this.jobQueue = [];
    this.activeJobs.clear();
    this.completedResults = [];
    this.originalBuffer = null;
    this.progressTracker = null;
  }
}
