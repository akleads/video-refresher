import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { upload, deviceUpload } from '../middleware/upload.js';
import { generateId } from '../lib/id.js';
import { cancelJobProcesses } from '../lib/cancel.js';
import { extractThumbnail } from '../lib/ffmpeg.js';
import archiver from 'archiver';
import fs from 'node:fs';
import path from 'node:path';

export function createJobsRouter(db, queries, outputDir) {
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

  // POST /device - Upload pre-processed device results
  router.post('/device', requireAuth, deviceUpload.array('results', 200), async (req, res) => {
    try {
      // Parse sourceFiles metadata
      let sourceFiles;
      try {
        sourceFiles = JSON.parse(req.body.sourceFiles);
      } catch {
        return res.status(400).json({ error: 'Invalid sourceFiles JSON' });
      }

      // Validate sourceFiles
      if (!Array.isArray(sourceFiles) || sourceFiles.length === 0) {
        return res.status(400).json({ error: 'sourceFiles must be a non-empty array' });
      }
      for (const sf of sourceFiles) {
        if (typeof sf.name !== 'string' || !sf.name) {
          return res.status(400).json({ error: 'Each sourceFile must have a name string' });
        }
        if (typeof sf.variationCount !== 'number' || sf.variationCount < 1) {
          return res.status(400).json({ error: 'Each sourceFile must have a positive variationCount number' });
        }
      }

      // Validate uploaded files
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'No result files uploaded' });
      }

      const jobId = generateId();
      const totalVideos = sourceFiles.length;
      const totalVariations = req.files.length;

      // Create job output directory
      const jobOutputDir = path.join(outputDir, jobId);
      fs.mkdirSync(jobOutputDir, { recursive: true });

      // Build map: sourceBaseName (without extension) -> job_file_id
      const fileIdMap = new Map();

      // Use a transaction for atomicity
      db.transaction(() => {
        // Create the job record
        queries.insertDeviceJob.run(jobId, totalVideos, totalVariations);

        // Create job_file records for each source file
        for (const sf of sourceFiles) {
          const fileId = generateId();
          queries.insertDeviceJobFile.run(fileId, jobId, sf.name, '', 0, 'completed', sf.variationCount);
          // Map basename without extension to fileId
          const baseName = sf.name.replace(/\.[^.]+$/, '');
          fileIdMap.set(baseName, fileId);
        }

        // Move each uploaded file and create output_file records
        for (const file of req.files) {
          // originalname format: {sourceBaseName}/{sourceBaseName}_var{N}_{uuid}.mp4
          // or just {sourceBaseName}_var{N}_{uuid}.mp4
          const originalName = file.originalname;
          const parts = originalName.split('/');
          const filename = parts.length > 1 ? parts[parts.length - 1] : parts[0];
          const sourceBaseName = parts.length > 1 ? parts[0] : filename.split('_var')[0];

          // Move file from upload tmp to output dir
          const destPath = path.join(jobOutputDir, filename);
          fs.renameSync(file.path, destPath);

          // Parse variation index from filename: _var{N}_
          const varMatch = filename.match(/_var(\d+)_/);
          const variationIndex = varMatch ? parseInt(varMatch[1], 10) : 0;

          // Find matching job_file_id
          const matchingFileId = fileIdMap.get(sourceBaseName);

          if (matchingFileId) {
            const outputId = generateId();
            queries.insertOutputFile.run(outputId, jobId, matchingFileId, variationIndex, destPath, file.size);
          }
        }
      })();

      // Generate thumbnail from first result file
      try {
        const firstResultFile = req.files[0];
        const firstResultPath = path.join(jobOutputDir, firstResultFile.filename || path.basename(firstResultFile.path));
        const thumbnailPath = path.join(jobOutputDir, 'thumb.webp');
        const success = await extractThumbnail(firstResultPath, thumbnailPath);
        if (success) {
          queries.updateJobThumbnail.run(thumbnailPath, jobId);
        }
      } catch (thumbErr) {
        console.warn(`Device upload thumbnail generation failed for job ${jobId}:`, thumbErr.message);
        // Don't fail the upload - thumbnail is non-critical
      }

      res.status(201).json({
        jobId,
        status: 'completed',
        totalVideos,
        totalVariations,
        source: 'device'
      });
    } catch (err) {
      console.error('Device upload error:', err);
      res.status(500).json({ error: 'Failed to process device upload' });
    }
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
      source: job.source || 'server',
      totalVideos: job.total_videos,
      totalVariations: job.total_variations,
      overallProgress,
      thumbnailUrl: job.thumbnail_path ? `/api/jobs/${job.id}/thumbnail` : null,
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
      cancelledAt: job.cancelled_at || null,
      error: job.error
    });
  });

  // GET / - List jobs (with source filenames)
  router.get('/', requireAuth, (req, res) => {
    const jobs = queries.listJobsWithFiles.all();
    res.json(jobs.map(job => ({
      id: job.id,
      status: job.status,
      totalVideos: job.total_videos,
      totalVariations: job.total_variations,
      source: job.source || 'server',
      thumbnailUrl: job.thumbnail_path ? `/api/jobs/${job.id}/thumbnail` : null,
      fileNames: job.file_names ? job.file_names.split(',') : [],
      createdAt: job.created_at
    })));
  });

  // POST /:id/cancel - Cancel a job
  router.post('/:id/cancel', requireAuth, async (req, res) => {
    const job = queries.getJob.get(req.params.id);

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // Only cancellable if queued or processing
    if (!['queued', 'processing'].includes(job.status)) {
      return res.status(409).json({
        error: 'Job cannot be cancelled',
        status: job.status,
        message: job.status === 'completed' ? 'Job already completed' :
                 job.status === 'failed' ? 'Job already failed' :
                 'Job already cancelled'
      });
    }

    // Mark job as cancelled in database
    queries.cancelJob.run(job.id);

    // Kill active FFmpeg processes for this job
    const jobFiles = queries.getJobFiles.all(job.id);
    try {
      await cancelJobProcesses(jobFiles, queries);
    } catch (err) {
      console.error(`Error killing FFmpeg processes for job ${job.id}:`, err.message);
    }

    // Get final job status (may have completed during kill)
    const finalJob = queries.getJob.get(job.id);

    // Calculate completed variations
    const files = queries.getJobFiles.all(job.id);
    const completedVariations = files.reduce((sum, f) => sum + (f.completed_variations || 0), 0);

    res.json({
      jobId: finalJob.id,
      status: finalJob.status,
      completedVariations,
      totalVariations: finalJob.total_variations,
      cancelledAt: finalJob.cancelled_at
    });
  });

  // GET /:id/thumbnail - Serve thumbnail image
  router.get('/:id/thumbnail', requireAuth, (req, res) => {
    const job = queries.getJob.get(req.params.id);

    // Check job exists and has a thumbnail
    if (!job || !job.thumbnail_path) {
      return res.status(404).json({ error: 'Thumbnail not found' });
    }

    // Check file exists on disk
    if (!fs.existsSync(job.thumbnail_path)) {
      return res.status(404).json({ error: 'Thumbnail file missing' });
    }

    // Set content type and stream the file
    res.setHeader('Content-Type', 'image/webp');
    fs.createReadStream(job.thumbnail_path).pipe(res);
  });

  // GET /:id/download - Download job outputs as ZIP
  router.get('/:id/download', requireAuth, (req, res) => {
    const job = queries.getJob.get(req.params.id);

    // Check job exists and is completed or cancelled (with outputs)
    if (!job || !['completed', 'cancelled'].includes(job.status)) {
      return res.status(404).json({ error: 'Job not found or not completed' });
    }

    // Check expiry
    const expiresAt = new Date(job.expires_at + 'Z'); // Append Z for UTC
    if (expiresAt < new Date()) {
      return res.status(410).json({ error: 'Job expired' });
    }

    // Get output files and job files
    const outputFiles = queries.getOutputFiles.all(job.id);
    if (outputFiles.length === 0) {
      return res.status(404).json({ error: 'No output files available' });
    }

    const jobFiles = queries.getJobFiles.all(job.id);

    // Build map from job_file_id to folder name
    const folderMap = new Map();
    for (const jf of jobFiles) {
      const folderName = jf.original_name.replace(/\.(mp4|mov)$/i, '');
      folderMap.set(jf.id, folderName);
    }

    // Set response headers
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="video-refresher-${job.id}.zip"`);

    // Create archive with STORE compression (no re-compression)
    const archive = archiver('zip', { store: true });

    // Error handler
    archive.on('error', (err) => {
      console.error('Archive error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to create archive' });
      } else {
        res.destroy();
      }
    });

    // Warning handler for missing files
    archive.on('warning', (err) => {
      if (err.code === 'ENOENT') {
        console.warn('Archive warning (missing file):', err);
      } else {
        throw err;
      }
    });

    // Pipe archive to response
    archive.pipe(res);

    // Add output files to archive
    for (const out of outputFiles) {
      const folderName = folderMap.get(out.job_file_id) || 'unknown';
      const filename = path.basename(out.output_path);
      archive.file(out.output_path, { name: `${folderName}/${filename}` });
    }

    // Finalize archive (critical - without this the stream never ends)
    archive.finalize();
  });

  return router;
}
