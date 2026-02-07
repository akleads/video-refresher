import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { authRouter } from './routes/auth.js';
import { healthRouter } from './routes/health.js';
import { createJobsRouter } from './routes/jobs.js';
import { errorHandler } from './middleware/error.js';
import { initDatabase } from './db/index.js';
import { createJobQueries } from './db/queries.js';
import { JobQueueWorker } from './lib/queue.js';

const PORT = process.env.PORT || 8080;
const DATA_DIR = process.env.DATA_DIR || './data';
const DB_PATH = process.env.DB_PATH || `${DATA_DIR}/video-refresher.db`;
const UPLOAD_DIR = process.env.UPLOAD_DIR || `${DATA_DIR}/uploads`;
const OUTPUT_DIR = process.env.OUTPUT_DIR || `${DATA_DIR}/output`;

function verifyVolume() {
  const dirs = [DATA_DIR, UPLOAD_DIR, OUTPUT_DIR, `${DATA_DIR}/tmp`];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
  // Write test file to verify volume is writable
  const testFile = path.join(DATA_DIR, '.write-test');
  try {
    fs.writeFileSync(testFile, 'ok');
    fs.unlinkSync(testFile);
  } catch (err) {
    console.error(`FATAL: Volume not writable at ${DATA_DIR}:`, err.message);
    process.exit(1);
  }
}

// Verify volume before initializing database
verifyVolume();

// Initialize database
const db = initDatabase(DB_PATH);
const queries = createJobQueries(db);

// Create queue worker
const worker = new JobQueueWorker(db, queries, OUTPUT_DIR);

const app = express();

// CORS configuration
app.use(cors({
  origin: [
    'https://video-refresher.pages.dev',
    'http://localhost:8000'
  ],
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Store db and queries on app.locals for route access
app.locals.db = db;
app.locals.queries = queries;

// Create jobs router
const jobsRouter = createJobsRouter(db, queries);

// Routes
app.use('/api/health', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api/jobs', jobsRouter);

// Error handler (must be last)
app.use(errorHandler);

function recoverInterruptedJobs(db, queries) {
  const stuckJobs = queries.getProcessingJobs.all();
  for (const job of stuckJobs) {
    console.log(`Recovery: marking interrupted job ${job.id} as failed`);
    queries.updateJobError.run('Server restarted during processing', job.id);
    const files = queries.getJobFiles.all(job.id);
    for (const file of files) {
      if (file.status === 'processing') {
        queries.updateFileError.run('Server restarted during processing', file.id);
      }
    }
  }

  // Kill orphaned FFmpeg processes -- uses SIGKILL (not SIGTERM) because these
  // are orphaned from a previous server run with no parent managing them
  const filesWithPid = queries.getFilesWithPid.all();
  for (const file of filesWithPid) {
    try {
      process.kill(file.ffmpeg_pid, 0);
      console.log(`Recovery: killing orphaned FFmpeg process ${file.ffmpeg_pid}`);
      process.kill(file.ffmpeg_pid, 'SIGKILL');
    } catch (err) {
      if (err.code !== 'ESRCH') {
        console.error(`Recovery: error checking pid ${file.ffmpeg_pid}:`, err.message);
      }
    }
    queries.clearFilePid.run(file.id);
  }

  if (stuckJobs.length > 0 || filesWithPid.length > 0) {
    console.log(`Recovery: processed ${stuckJobs.length} stuck jobs, ${filesWithPid.length} orphaned processes`);
  }
}

async function gracefulShutdown(signal) {
  console.log(`${signal} received, shutting down gracefully...`);
  worker.stop();

  const filesWithPid = queries.getFilesWithPid.all();
  for (const file of filesWithPid) {
    try {
      process.kill(file.ffmpeg_pid, 'SIGTERM');
      console.log(`Shutdown: sent SIGTERM to FFmpeg pid ${file.ffmpeg_pid}`);
    } catch (err) {
      if (err.code !== 'ESRCH') {
        console.error(`Shutdown: error killing pid ${file.ffmpeg_pid}:`, err.message);
      }
    }
    queries.clearFilePid.run(file.id);
  }

  const currentJobId = worker.getCurrentJobId();
  if (currentJobId) {
    try {
      queries.updateJobError.run(`Server shutdown (${signal})`, currentJobId);
      const files = queries.getJobFiles.all(currentJobId);
      for (const file of files) {
        if (file.status === 'processing') {
          queries.updateFileError.run(`Server shutdown (${signal})`, file.id);
        }
      }
    } catch (err) {
      console.error('Shutdown: error marking job failed:', err.message);
    }
  }

  await new Promise(r => setTimeout(r, 2000));
  const remainingPids = queries.getFilesWithPid.all();
  for (const file of remainingPids) {
    try { process.kill(file.ffmpeg_pid, 'SIGKILL'); } catch (err) { /* ignore */ }
  }

  db.close();
  console.log('Shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`Data directory: ${DATA_DIR}`);
  console.log(`Database: ${DB_PATH}`);
  recoverInterruptedJobs(db, queries);
  worker.start();
});
