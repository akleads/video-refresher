/**
 * Job cancellation with graceful 3-stage FFmpeg termination.
 *
 * Tracks active FFmpeg processes and provides cancellation with escalation:
 * Stage 1: stdin 'q' (FFmpeg-specific graceful exit)
 * Stage 2: SIGTERM after 2s (standard termination signal)
 * Stage 3: SIGKILL after 4s (force kill as last resort)
 */

// Registry: jobFileId -> ChildProcess
const processRegistry = new Map();

/**
 * Register an FFmpeg process for cancellation tracking.
 * @param {string} jobFileId - job_files.id
 * @param {ChildProcess} childProcess - FFmpeg process
 */
export function registerProcess(jobFileId, childProcess) {
  processRegistry.set(jobFileId, childProcess);
}

/**
 * Unregister an FFmpeg process after natural completion.
 * @param {string} jobFileId - job_files.id
 */
export function unregisterProcess(jobFileId) {
  processRegistry.delete(jobFileId);
}

/**
 * Check if a process is still alive.
 * @param {number} pid - Process ID
 * @returns {boolean}
 */
function isProcessAlive(pid) {
  try {
    // Signal 0 doesn't kill, just checks if process exists
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (err.code === 'ESRCH') {
      // No such process
      return false;
    } else if (err.code === 'EPERM') {
      // Process exists but no permission (still alive)
      return true;
    }
    throw err; // Unexpected error
  }
}

/**
 * Gracefully kill an FFmpeg process with 3-stage escalation.
 * @param {ChildProcess} childProcess - FFmpeg child process
 * @param {number} timeoutMs - Timeout between escalation stages (default: 2000ms)
 * @returns {Promise<void>}
 */
async function gracefulKillFFmpeg(childProcess, timeoutMs = 2000) {
  if (!childProcess || childProcess.killed) {
    return; // Already dead
  }

  return new Promise((resolve) => {
    let terminated = false;

    const cleanup = () => {
      if (!terminated) {
        terminated = true;
        clearTimeout(sigtermTimer);
        clearTimeout(sigkillTimer);
        childProcess.removeListener('exit', cleanup);
        resolve();
      }
    };

    childProcess.once('exit', cleanup);

    // Stage 1: Try stdin 'q' (FFmpeg-specific cleanup)
    try {
      childProcess.stdin.write('q\n');
    } catch (err) {
      // stdin may be closed, continue to SIGTERM
    }

    // Stage 2: SIGTERM after timeout
    const sigtermTimer = setTimeout(() => {
      if (!terminated && !childProcess.killed) {
        childProcess.kill('SIGTERM');
      }
    }, timeoutMs);

    // Stage 3: SIGKILL as last resort
    const sigkillTimer = setTimeout(() => {
      if (!terminated && !childProcess.killed) {
        childProcess.kill('SIGKILL');
      }
      cleanup(); // Force cleanup after SIGKILL
    }, timeoutMs * 2);
  });
}

/**
 * Cancel all FFmpeg processes associated with a job's files.
 * @param {Array} jobFiles - Array of job_files rows
 * @param {Object} queries - Database prepared statements
 * @returns {Promise<void>}
 */
export async function cancelJobProcesses(jobFiles, queries) {
  const killPromises = [];

  for (const file of jobFiles) {
    // Check if process is registered and still alive
    const childProcess = processRegistry.get(file.id);

    if (childProcess) {
      // Process is currently running
      killPromises.push(
        gracefulKillFFmpeg(childProcess).then(() => {
          processRegistry.delete(file.id);
          queries.clearFilePid.run(file.id);
        })
      );
    } else if (file.ffmpeg_pid && isProcessAlive(file.ffmpeg_pid)) {
      // Process exists in DB but not in registry (edge case: registry miss)
      // Use direct kill since we don't have ChildProcess reference
      try {
        process.kill(file.ffmpeg_pid, 'SIGTERM');
        queries.clearFilePid.run(file.id);
      } catch (err) {
        if (err.code !== 'ESRCH') {
          console.error(`Failed to kill orphaned FFmpeg PID ${file.ffmpeg_pid}:`, err);
        }
      }
    } else if (file.ffmpeg_pid) {
      // PID in DB but process is dead
      queries.clearFilePid.run(file.id);
    }
  }

  // Wait for all kill operations to complete
  await Promise.all(killPromises);
}
