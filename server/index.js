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

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`Data directory: ${DATA_DIR}`);
  console.log(`Database: ${DB_PATH}`);
});
