import { spawn } from 'node:child_process';
import readline from 'node:readline';

/**
 * Extract video duration using ffprobe.
 * @param {string} filePath - Path to video file
 * @returns {Promise<number>} Duration in seconds, or 0 if probe fails
 */
export async function getVideoDuration(filePath) {
  return new Promise((resolve) => {
    const ffprobe = spawn('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      filePath
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let output = '';

    const onData = (chunk) => { output += chunk; };
    ffprobe.stdout.on('data', onData);

    const cleanup = () => {
      ffprobe.stdout.off('data', onData);
    };

    ffprobe.on('close', (code) => {
      cleanup();
      if (code !== 0) {
        resolve(0); // Return 0 on failure, not throw
        return;
      }
      try {
        const data = JSON.parse(output);
        const duration = parseFloat(data.format.duration);
        resolve(isNaN(duration) ? 0 : duration);
      } catch (err) {
        resolve(0); // Return 0 on parse error
      }
    });

    ffprobe.on('error', () => {
      cleanup();
      resolve(0); // Return 0 on spawn error
    });
  });
}

/**
 * Spawn FFmpeg with progress parsing.
 * @param {string} inputPath - Input video path
 * @param {string} outputPath - Output video path
 * @param {string} filterString - FFmpeg filter string
 * @param {Function} onProgress - Progress callback (percent 0-100)
 * @param {number} durationSeconds - Video duration for progress calculation
 * @returns {Promise<{process: ChildProcess, promise: Promise<void>}>}
 */
export function spawnFFmpeg(inputPath, outputPath, filterString, onProgress, durationSeconds) {
  const args = [
    '-i', inputPath,
    '-vf', filterString,
    '-r', '29.97',
    '-b:v', '2000k',
    '-bufsize', '4000k',
    '-maxrate', '2500k',
    '-preset', 'ultrafast',
    '-crf', '23',
    '-threads', '4',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-map_metadata', '-1',
    '-y',
    outputPath
  ];

  const ffmpegChild = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });

  // Parse stderr for progress
  const rl = readline.createInterface({ input: ffmpegChild.stderr });
  const stderrLines = [];

  rl.on('line', (line) => {
    // Collect last 20 lines for error reporting
    stderrLines.push(line);
    if (stderrLines.length > 20) {
      stderrLines.shift();
    }

    // Parse progress if duration is known
    if (durationSeconds > 0) {
      const timeMatch = line.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
      if (timeMatch) {
        const [, h, m, s] = timeMatch;
        const currentSeconds = parseInt(h, 10) * 3600 + parseInt(m, 10) * 60 + parseFloat(s);
        const progressPercent = Math.max(0, Math.min(100, Math.round((currentSeconds / durationSeconds) * 100)));
        onProgress(progressPercent);
      }
    }
  });

  const encodingPromise = new Promise((resolve, reject) => {
    ffmpegChild.on('close', (code) => {
      rl.close(); // CRITICAL: prevent FD leak
      if (code === 0) {
        resolve();
      } else {
        const errorMsg = `FFmpeg exited with code ${code}\nLast stderr lines:\n${stderrLines.join('\n')}`;
        reject(new Error(errorMsg));
      }
    });

    ffmpegChild.on('error', (err) => {
      rl.close(); // CRITICAL: prevent FD leak
      reject(err);
    });
  });

  return { process: ffmpegChild, promise: encodingPromise };
}
