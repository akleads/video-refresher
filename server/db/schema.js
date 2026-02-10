export function createTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'queued',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT,
      total_videos INTEGER NOT NULL DEFAULT 0,
      total_variations INTEGER NOT NULL DEFAULT 0,
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS job_files (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      original_name TEXT NOT NULL,
      upload_path TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS output_files (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      job_file_id TEXT NOT NULL REFERENCES job_files(id) ON DELETE CASCADE,
      variation_index INTEGER NOT NULL,
      output_path TEXT NOT NULL,
      file_size INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_expires ON jobs(expires_at);
    CREATE INDEX IF NOT EXISTS idx_job_files_job_id ON job_files(job_id);
    CREATE INDEX IF NOT EXISTS idx_output_files_job_id ON output_files(job_id);
    CREATE INDEX IF NOT EXISTS idx_output_files_job_file_id ON output_files(job_file_id);
  `);
}

export function migrateSchema(db) {
  const columns = [
    { table: 'job_files', name: 'progress_percent', sql: "ALTER TABLE job_files ADD COLUMN progress_percent INTEGER NOT NULL DEFAULT 0" },
    { table: 'job_files', name: 'duration_seconds', sql: "ALTER TABLE job_files ADD COLUMN duration_seconds REAL" },
    { table: 'job_files', name: 'ffmpeg_pid', sql: "ALTER TABLE job_files ADD COLUMN ffmpeg_pid INTEGER" },
    { table: 'job_files', name: 'error', sql: "ALTER TABLE job_files ADD COLUMN error TEXT" },
    { table: 'job_files', name: 'completed_variations', sql: "ALTER TABLE job_files ADD COLUMN completed_variations INTEGER NOT NULL DEFAULT 0" },
    { table: 'job_files', name: 'updated_at', sql: "ALTER TABLE job_files ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'))" },
    { table: 'jobs', name: 'cancelled_at', sql: "ALTER TABLE jobs ADD COLUMN cancelled_at TEXT" },
  ];

  for (const col of columns) {
    try {
      db.exec(col.sql);
    } catch (err) {
      // "duplicate column name" means it already exists -- safe to ignore
      if (!err.message.includes('duplicate column name')) throw err;
    }
  }
}
