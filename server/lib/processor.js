import fs from 'node:fs';
import path from 'node:path';
import { spawnFFmpeg, getVideoDuration } from './ffmpeg.js';
import { generateUniqueEffects, buildFilterString } from './effects.js';
import { generateId } from './id.js';

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

    // f. Store pid
    queries.updateFilePid.run(ffmpegResult.process.pid, file.id);

    // g. Await ffmpegResult.promise
    await ffmpegResult.promise;

    // h. Clear pid
    queries.updateFilePid.run(null, file.id);

    // i. Get output file size
    const stats = fs.statSync(outputPath);
    const fileSize = stats.size;

    // j. Insert output file record
    queries.insertOutputFile.run(generateId(), job.id, file.id, i, outputPath, fileSize);

    // k. Increment completed variations
    queries.incrementFileVariations.run(file.id);
  }

  // 8. After all variations complete, set progress to 100
  queries.updateFileProgress.run(100, file.id);
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

  // 4. Process each file
  for (const file of files) {
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

  // 5. Mark job as completed or failed
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
