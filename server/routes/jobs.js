import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';
import { generateId } from '../lib/id.js';

export function createJobsRouter(db, queries) {
  const router = Router();

  // POST / - Create job with uploads
  router.post('/', requireAuth, upload.array('videos', 10), async (req, res) => {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No video files uploaded' });
    }

    // Parse and clamp variationsPerVideo
    const variationsPerVideo = Math.max(1, Math.min(20, parseInt(req.body.variations) || 5));
    const jobId = generateId();

    // Insert job
    queries.insertJob.run(jobId, req.files.length, req.files.length * variationsPerVideo);

    // Insert file records
    const files = req.files.map(f => {
      const fileId = generateId();
      queries.insertJobFile.run(fileId, jobId, f.originalname, f.path, f.size);
      return { id: fileId, name: f.originalname, size: f.size };
    });

    res.status(202).json({
      jobId,
      status: 'queued',
      files,
      variationsPerVideo,
      totalVariations: req.files.length * variationsPerVideo,
      statusUrl: `/api/jobs/${jobId}`
    });
  });

  // GET /:id - Job status
  router.get('/:id', requireAuth, (req, res) => {
    const job = queries.getJob.get(req.params.id);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const files = queries.getJobFiles.all(req.params.id);
    const outputFiles = queries.getOutputFiles.all(req.params.id);

    const outputsByFile = {};
    for (const out of outputFiles) {
      if (!outputsByFile[out.job_file_id]) outputsByFile[out.job_file_id] = [];
      outputsByFile[out.job_file_id].push({
        id: out.id,
        variationIndex: out.variation_index,
        outputPath: out.output_path,
        fileSize: out.file_size
      });
    }

    let overallProgress = 0;
    if (files.length > 0) {
      const sum = files.reduce((acc, f) => acc + (f.progress_percent || 0), 0);
      overallProgress = Math.round(sum / files.length);
    }
    if (job.status === 'completed') overallProgress = 100;

    res.json({
      jobId: job.id,
      status: job.status,
      totalVideos: job.total_videos,
      totalVariations: job.total_variations,
      overallProgress,
      files: files.map(f => ({
        id: f.id,
        name: f.original_name,
        size: f.file_size,
        status: f.status,
        progress: f.progress_percent || 0,
        completedVariations: f.completed_variations || 0,
        error: f.error || null,
        outputs: outputsByFile[f.id] || []
      })),
      createdAt: job.created_at,
      expiresAt: job.expires_at,
      error: job.error
    });
  });

  // GET / - List jobs
  router.get('/', requireAuth, (req, res) => {
    const jobs = queries.listJobs.all();
    res.json(jobs.map(job => ({
      id: job.id,
      status: job.status,
      totalVideos: job.total_videos,
      totalVariations: job.total_variations,
      createdAt: job.created_at
    })));
  });

  return router;
}
