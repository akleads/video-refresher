export function createJobQueries(db) {
  return {
    insertJob: db.prepare(`
      INSERT INTO jobs (id, total_videos, total_variations, expires_at)
      VALUES (?, ?, ?, datetime('now', '+24 hours'))
    `),

    insertJobFile: db.prepare(`
      INSERT INTO job_files (id, job_id, original_name, upload_path, file_size)
      VALUES (?, ?, ?, ?, ?)
    `),

    getJob: db.prepare(`
      SELECT * FROM jobs WHERE id = ?
    `),

    getJobFiles: db.prepare(`
      SELECT * FROM job_files WHERE job_id = ?
    `),

    listJobs: db.prepare(`
      SELECT * FROM jobs ORDER BY created_at DESC LIMIT 50
    `),

    // Progress tracking
    updateFileProgress: db.prepare(`
      UPDATE job_files SET progress_percent = ?, updated_at = datetime('now') WHERE id = ?
    `),

    updateFileStatus: db.prepare(`
      UPDATE job_files SET status = ?, updated_at = datetime('now') WHERE id = ?
    `),

    updateFileDuration: db.prepare(`
      UPDATE job_files SET duration_seconds = ? WHERE id = ?
    `),

    updateFilePid: db.prepare(`
      UPDATE job_files SET ffmpeg_pid = ? WHERE id = ?
    `),

    updateFileError: db.prepare(`
      UPDATE job_files SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?
    `),

    incrementFileVariations: db.prepare(`
      UPDATE job_files SET completed_variations = completed_variations + 1 WHERE id = ?
    `),

    // Job status updates
    updateJobStatus: db.prepare(`
      UPDATE jobs SET status = ?, updated_at = datetime('now') WHERE id = ?
    `),

    updateJobError: db.prepare(`
      UPDATE jobs SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?
    `),

    // Output files
    insertOutputFile: db.prepare(`
      INSERT INTO output_files (id, job_id, job_file_id, variation_index, output_path, file_size)
      VALUES (?, ?, ?, ?, ?, ?)
    `),

    getOutputFiles: db.prepare(`
      SELECT * FROM output_files WHERE job_id = ?
    `),

    getOutputFilesByJobFile: db.prepare(`
      SELECT * FROM output_files WHERE job_file_id = ?
    `),

    // Recovery queries
    getProcessingJobs: db.prepare(`
      SELECT * FROM jobs WHERE status = 'processing'
    `),

    getFilesWithPid: db.prepare(`
      SELECT * FROM job_files WHERE ffmpeg_pid IS NOT NULL
    `),

    clearFilePid: db.prepare(`
      UPDATE job_files SET ffmpeg_pid = NULL WHERE id = ?
    `),

    getNextQueuedJob: db.prepare(`
      SELECT * FROM jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1
    `),

    // Cancel-related queries
    cancelJob: db.prepare(`
      UPDATE jobs SET status = 'cancelled', cancelled_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ? AND status IN ('queued', 'processing')
    `),

    isJobCancelled: db.prepare(`
      SELECT 1 FROM jobs WHERE id = ? AND status = 'cancelled'
    `),

    // Cleanup queries
    getExpiredJobs: db.prepare(`
      SELECT * FROM jobs
      WHERE expires_at < datetime('now')
        AND status IN ('completed', 'failed', 'cancelled')
    `),

    getEvictionCandidates: db.prepare(`
      SELECT * FROM jobs
      WHERE status IN ('completed', 'failed', 'cancelled')
      ORDER BY updated_at ASC
    `),

    deleteJob: db.prepare(`
      DELETE FROM jobs WHERE id = ?
    `),

    getStuckQueuedJobs: db.prepare(`
      SELECT * FROM jobs
      WHERE status = 'queued'
        AND expires_at < datetime('now')
    `),

    // Device job queries
    insertDeviceJob: db.prepare(`
      INSERT INTO jobs (id, total_videos, total_variations, source, status, expires_at)
      VALUES (?, ?, ?, 'device', 'completed', datetime('now', '+24 hours'))
    `),

    insertDeviceJobFile: db.prepare(`
      INSERT INTO job_files (id, job_id, original_name, upload_path, file_size, status, completed_variations)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
  };
}
