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
    `)
  };
}
