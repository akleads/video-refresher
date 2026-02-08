import fs from 'node:fs';
import path from 'node:path';

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const EVICTION_THRESHOLD = 0.85; // 85% usage triggers eviction

export class CleanupDaemon {
  constructor(db, queries, dataDir) {
    this.db = db;
    this.queries = queries;
    this.dataDir = dataDir;
    this.timer = null;
  }

  start() {
    this.timer = setInterval(() => this.run(), CLEANUP_INTERVAL_MS);
    this.timer.unref(); // Don't block process exit
    console.log('Cleanup daemon started (interval: 5m, eviction threshold: 85%)');
    // Run immediately once
    this.run();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('Cleanup daemon stopped');
    }
  }

  run() {
    try {
      this.expireOldJobs();
      this.markStuckJobs();
      this.evictIfNeeded();
    } catch (err) {
      console.error('Cleanup daemon error:', err.message);
    }
  }

  expireOldJobs() {
    const expiredJobs = this.queries.getExpiredJobs.all();

    for (const job of expiredJobs) {
      // Delete output files from disk FIRST
      const outputPath = path.join(this.dataDir, 'output', job.id);
      fs.rmSync(outputPath, { recursive: true, force: true });

      // Then delete DB row (CASCADE handles child rows)
      this.queries.deleteJob.run(job.id);

      console.log('Expired job ' + job.id);
    }

    if (expiredJobs.length > 0) {
      console.log(`Expired ${expiredJobs.length} job(s)`);
    }
  }

  markStuckJobs() {
    const stuckJobs = this.queries.getStuckQueuedJobs.all();

    for (const job of stuckJobs) {
      this.queries.updateJobError.run('Job expired while queued', job.id);
    }

    // These will be picked up by expireOldJobs on the NEXT cycle
  }

  evictIfNeeded() {
    // Get disk stats
    const stats = fs.statfsSync(this.dataDir);
    const totalBytes = stats.blocks * stats.bsize;
    const freeBytes = stats.bavail * stats.bsize;
    const usedBytes = totalBytes - freeBytes;
    let usageRatio = usedBytes / totalBytes;

    if (usageRatio <= EVICTION_THRESHOLD) {
      return; // No eviction needed
    }

    console.log('Storage pressure: ' + Math.round(usageRatio * 100) + '% used, evicting oldest jobs...');

    const candidates = this.queries.getEvictionCandidates.all();

    for (const job of candidates) {
      // Delete output dir from disk
      const outputPath = path.join(this.dataDir, 'output', job.id);
      fs.rmSync(outputPath, { recursive: true, force: true });

      // Delete DB row
      this.queries.deleteJob.run(job.id);

      console.log('Evicted job ' + job.id + ' (storage pressure)');

      // Recheck disk
      const newStats = fs.statfsSync(this.dataDir);
      const newTotalBytes = newStats.blocks * newStats.bsize;
      const newFreeBytes = newStats.bavail * newStats.bsize;
      const newUsedBytes = newTotalBytes - newFreeBytes;
      usageRatio = newUsedBytes / newTotalBytes;

      if (usageRatio <= EVICTION_THRESHOLD) {
        break; // Below threshold, stop evicting
      }
    }
  }
}
