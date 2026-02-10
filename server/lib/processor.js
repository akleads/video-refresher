import fs from 'node:fs';
import path from 'node:path';
import { spawnFFmpeg, getVideoDuration } from './ffmpeg.js';
import { generateUniqueEffects, buildFilterString } from './effects.js';
import { generateId } from './id.js';
import { registerProcess, unregisterProcess } from './cancel.js';

/**
 * Process a single file: probe duration, generate variations, spawn FFmpeg for each.
 * @param {Object} file - job_files row
 * @param {Object} job - jobs row
 * @param {number} variationsPerVideo - Number of variations to generate
 * @param {Object} db - Database instance
 * @param {Object} queries - Prepared statements
 * @param {string} outputDir - Base output directory
 */
async function processFile(file, job, variationsPerVideo, db, queries, outputDir) {
  // 1. Update file status to 'processing'
  queries.updateFileStatus.run('processing', file.id);

  // 2. Get video duration
  const duration = await getVideoDuration(file.upload_path);

  // 3. Store duration
  queries.updateFileDuration.run(duration, file.id);

  // 4. Generate unique effects
  const effects = generateUniqueEffects(variationsPerVideo);

  // 5. Create job-specific output directory
  const jobOutputDir = path.join(outputDir, job.id);
  fs.mkdirSync(jobOutputDir, { recursive: true });

  // 6. Progress tracking
  let lastWrittenProgress = -1;

  // 7. Process each variation
  for (let i = 0; i < variationsPerVideo; i++) {
    // Check for cancellation before starting next variation
    const isCancelled = queries.isJobCancelled.get(job.id);
    if (isCancelled) {
      console.log(`Job ${job.id} cancelled, stopping file ${file.id} at variation ${i}/${variationsPerVideo}`);
      break;
    }

    // a. Build filter string from effects[i]
    const filterString = buildFilterString(effects[i]);

    // b. Generate output filename
    const baseName = path.basename(file.original_name, '.mp4');
    const outputFilename = `${baseName}_var${i + 1}_${generateId()}.mp4`;

    // c. Build output path
    const outputPath = path.join(jobOutputDir, outputFilename);

    // d. onProgress callback
    const onProgress = (percent) => {
      const overall = Math.round((i * 100 + percent) / variationsPerVideo);
      if (Math.abs(overall - lastWrittenProgress) >= 2) {
        queries.updateFileProgress.run(overall, file.id);
        lastWrittenProgress = overall;
      }
    };

    // e. Call spawnFFmpeg
    const ffmpegResult = spawnFFmpeg(file.upload_path, outputPath, filterString, onProgress, duration);

    // f. Store pid and register process
    queries.updateFilePid.run(ffmpegResult.process.pid, file.id);
    registerProcess(file.id, ffmpegResult.process);

    try {
      // g. Await ffmpegResult.promise
      await ffmpegResult.promise;

      // h. Clear pid and unregister process
      queries.updateFilePid.run(null, file.id);
      unregisterProcess(file.id);

      // i. Get output file size
      const stats = fs.statSync(outputPath);
      const fileSize = stats.size;

      // j. Insert output file record
      queries.insertOutputFile.run(generateId(), job.id, file.id, i, outputPath, fileSize);

      // k. Increment completed variations
      queries.incrementFileVariations.run(file.id);
    } catch (err) {
      // Clear pid and unregister on error
      queries.updateFilePid.run(null, file.id);
      unregisterProcess(file.id);

      // Check if error was due to cancellation
      const isCancelled = queries.isJobCancelled.get(job.id);
      if (isCancelled) {
        console.log(`Job ${job.id} cancelled during variation ${i + 1}, FFmpeg killed`);
        // Delete partial output file if it exists
        try {
          if (fs.existsSync(outputPath)) {
            fs.unlinkSync(outputPath);
          }
        } catch (cleanupErr) {
          console.error(`Failed to delete partial file ${outputPath}:`, cleanupErr.message);
        }
        break; // Exit variation loop
      } else {
        // Not cancellation, genuine error - re-throw
        throw err;
      }
    }
  }

  // 8. After all variations complete, set progress to 100 (if not cancelled)
  const isCancelled = queries.isJobCancelled.get(job.id);
  if (!isCancelled) {
    queries.updateFileProgress.run(100, file.id);
  }
}

/**
 * Clean up partial output files after cancellation.
 * @param {string} jobId - Job ID
 * @param {Object} queries - Database prepared statements
 * @param {string} outputDir - Base output directory
 */
function cleanupPartialFiles(jobId, queries, outputDir) {
  const jobOutputDir = path.join(outputDir, jobId);

  if (!fs.existsSync(jobOutputDir)) {
    return; // No output directory, nothing to clean
  }

  // Get all completed output files from database
  const completedOutputs = queries.getOutputFiles.all(jobId);
  const completedPaths = new Set(completedOutputs.map(o => o.output_path));

  // Scan job output directory
  try {
    const allFiles = fs.readdirSync(jobOutputDir);

    for (const filename of allFiles) {
      const fullPath = path.join(jobOutputDir, filename);

      // If file is not in database, it's a partial file - delete it
      if (!completedPaths.has(fullPath)) {
        try {
          fs.unlinkSync(fullPath);
          console.log(`Cleaned up partial file: ${filename}`);
        } catch (err) {
          console.error(`Failed to delete partial file ${fullPath}:`, err.message);
        }
      }
    }
  } catch (err) {
    console.error(`Failed to scan directory ${jobOutputDir}:`, err.message);
  }
}

/**
 * Process all files in a job, generating variations for each.
 * @param {Object} job - jobs row
 * @param {Object} db - Database instance
 * @param {Object} queries - Prepared statements
 * @param {string} outputDir - Base output directory
 */
export async function processJob(job, db, queries, outputDir) {
  // 1. Update job status to 'processing'
  queries.updateJobStatus.run('processing', job.id);

  // 2. Get all files for this job
  const files = queries.getJobFiles.all(job.id);

  // 3. Determine variations per video
  const variationsPerVideo = Math.round(job.total_variations / job.total_videos);

  let allSucceeded = true;
  let cancelled = false;

  // 4. Process each file
  for (const file of files) {
    // Check for cancellation before processing next file
    const isCancelled = queries.isJobCancelled.get(job.id);
    if (isCancelled) {
      cancelled = true;
      console.log(`Job ${job.id} cancelled, skipping remaining files`);
      break;
    }

    try {
      await processFile(file, job, variationsPerVideo, db, queries, outputDir);
      queries.updateFileStatus.run('completed', file.id);
    } catch (err) {
      allSucceeded = false;
      queries.updateFileError.run(err.message, file.id);
      console.error(`File ${file.id} (${file.original_name}) failed:`, err.message);
      // Continue to next file -- don't block batch
    }
  }

  // 5. Clean up partial files if cancelled
  if (cancelled) {
    cleanupPartialFiles(job.id, queries, outputDir);
  }

  // 6. Mark job as completed or failed (only if not already cancelled)
  const currentJob = queries.getJob.get(job.id);
  if (currentJob.status !== 'cancelled') {
    if (allSucceeded) {
      queries.updateJobStatus.run('completed', job.id);
    } else {
      const updatedFiles = queries.getJobFiles.all(job.id);
      const allFailed = updatedFiles.every(f => f.status === 'failed');

      if (allFailed) {
        queries.updateJobError.run('All videos failed to process', job.id);
      } else {
        queries.updateJobStatus.run('completed', job.id);
        // Job is "completed" even if some files failed -- partial success
      }
    }
  }

  // 7. Clean up upload source files (best-effort)
  for (const file of files) {
    try {
      fs.unlinkSync(file.upload_path);
    } catch (err) {
      // Log but don't fail -- upload deletion is best-effort
      console.error(`Failed to delete upload ${file.upload_path}:`, err.message);
    }
  }
}
