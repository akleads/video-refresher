import { processJob } from './processor.js';

export class JobQueueWorker {
  constructor(db, queries, outputDir) {
    this.db = db;
    this.queries = queries;
    this.outputDir = outputDir;
    this.isRunning = false;
    this.pollTimer = null;
    this.currentJobId = null;
  }

  start() {
    this.isRunning = true;
    console.log('Job queue worker started');
    this.poll();
  }

  stop() {
    this.isRunning = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    console.log('Job queue worker stopped');
  }

  async poll() {
    if (!this.isRunning) return;

    try {
      const nextJob = this.queries.getNextQueuedJob.get();

      if (nextJob) {
        this.currentJobId = nextJob.id;
        console.log(`Processing job ${nextJob.id} (${nextJob.total_videos} videos, ${nextJob.total_variations} variations)`);

        try {
          await processJob(nextJob, this.db, this.queries, this.outputDir);
          console.log(`Job ${nextJob.id} completed`);
        } catch (err) {
          console.error(`Job ${nextJob.id} failed:`, err.message);
          // Only mark as failed if not already cancelled
          const finalJob = this.queries.getJob.get(nextJob.id);
          if (finalJob && finalJob.status !== 'cancelled') {
            this.queries.updateJobError.run(err.message, nextJob.id);
          }
        }

        this.currentJobId = null;

        if (this.isRunning) {
          setImmediate(() => this.poll());
          return;
        }
      }
    } catch (err) {
      console.error('Queue poll error:', err.message);
    }

    if (this.isRunning) {
      this.pollTimer = setTimeout(() => this.poll(), 2000);
    }
  }

  getCurrentJobId() {
    return this.currentJobId;
  }
}
