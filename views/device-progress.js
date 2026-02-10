/**
 * Device Processing Progress View
 * Displays real-time progress for on-device video processing using FFmpeg.wasm
 */

import { WorkerPool } from '../lib/device-processing/worker-pool.js';
import { generateZip, triggerDownload } from '../lib/device-processing/zip-generator.js';
import { generateUniqueEffects } from '../lib/effects-shared.js';

// Module state
let workerPool = null;
let processing = false;
let beforeUnloadHandler = null;
let pendingFiles = null;
let pendingVariationCount = null;
let allResults = [];

/**
 * Set processing data for the view to consume
 * @param {Array<File>} files - Video files to process
 * @param {number} variationCount - Number of variations per file
 */
export function setDeviceProcessingData(files, variationCount) {
  pendingFiles = files;
  pendingVariationCount = variationCount;
}

/**
 * Main render function for device processing progress view
 */
export async function renderDeviceProgress() {
  // Read from module state
  const files = pendingFiles;
  const variationCount = pendingVariationCount;

  const container = document.getElementById('view-device-progress');
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }

  // Check if we have files
  if (!files || files.length === 0) {
    const errorWrapper = document.createElement('div');
    errorWrapper.style.cssText = 'max-width: 600px; margin: 2rem auto; padding: 2rem; text-align: center;';

    const errorTitle = document.createElement('h2');
    errorTitle.textContent = 'No files to process';
    errorTitle.style.color = '#c33';
    errorWrapper.appendChild(errorTitle);

    const errorText = document.createElement('p');
    errorText.textContent = 'No files to process. Go back to upload.';
    errorText.style.cssText = 'margin: 1rem 0; color: #666;';
    errorWrapper.appendChild(errorText);

    const backLink = document.createElement('a');
    backLink.href = '#upload';
    backLink.textContent = 'Back to Upload';
    backLink.className = 'btn btn-primary';
    backLink.style.cssText = 'display: inline-block; margin-top: 1rem;';
    errorWrapper.appendChild(backLink);

    container.appendChild(errorWrapper);
    return;
  }

  // Main wrapper
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'max-width: 800px; margin: 2rem auto; padding: 1rem;';

  // Title section
  const title = document.createElement('h1');
  title.textContent = 'Processing on Device';
  wrapper.appendChild(title);

  // Device badge
  const deviceBadge = document.createElement('div');
  deviceBadge.className = 'device-badge';
  deviceBadge.textContent = 'ON DEVICE';
  deviceBadge.style.cssText = 'display: inline-block; background: #28a745; color: white; padding: 4px 12px; border-radius: 12px; font-size: 0.75rem; font-weight: 600; margin-bottom: 0.5rem;';
  wrapper.appendChild(deviceBadge);

  // Subtitle
  const subtitle = document.createElement('p');
  subtitle.textContent = 'Processing locally in your browser -- no data sent to server';
  subtitle.style.cssText = 'color: #666; margin-bottom: 2rem;';
  wrapper.appendChild(subtitle);

  // Device progress section
  const progressSection = document.createElement('div');
  progressSection.className = 'device-progress-section';
  progressSection.style.cssText = 'background: #f8f9fa; padding: 2rem; border-radius: 8px; margin-bottom: 2rem;';

  // Status text
  const statusText = document.createElement('div');
  statusText.textContent = 'Initializing FFmpeg...';
  statusText.style.cssText = 'font-weight: 500; margin-bottom: 1rem; color: #333;';
  progressSection.appendChild(statusText);

  // Overall progress label
  const overallLabel = document.createElement('div');
  overallLabel.textContent = 'Overall Progress';
  overallLabel.style.cssText = 'font-weight: 600; margin-bottom: 0.5rem; color: #555;';
  progressSection.appendChild(overallLabel);

  // Overall progress bar
  const overallBarTrack = document.createElement('div');
  overallBarTrack.className = 'progress-bar-track';
  overallBarTrack.style.cssText = 'width: 100%; height: 24px; background: #e0e0e0; border-radius: 12px; overflow: hidden; margin-bottom: 0.5rem;';

  const overallBarFill = document.createElement('div');
  overallBarFill.className = 'progress-bar-fill';
  overallBarFill.style.cssText = 'height: 100%; background: linear-gradient(90deg, #667eea 0%, #764ba2 100%); width: 0%; transition: width 0.3s;';
  overallBarTrack.appendChild(overallBarFill);

  progressSection.appendChild(overallBarTrack);

  // Overall progress text
  const overallText = document.createElement('div');
  overallText.textContent = '0 of 0 variations complete';
  overallText.style.cssText = 'color: #666; font-size: 0.9rem; margin-bottom: 2rem;';
  progressSection.appendChild(overallText);

  // Current variation section
  const variationSection = document.createElement('div');
  variationSection.className = 'variation-status';
  variationSection.style.cssText = 'margin-top: 1.5rem;';

  const variationLabel = document.createElement('div');
  variationLabel.textContent = 'Current Variation';
  variationLabel.style.cssText = 'font-weight: 600; margin-bottom: 0.5rem; color: #555;';
  variationSection.appendChild(variationLabel);

  const variationText = document.createElement('div');
  variationText.textContent = 'Waiting to start...';
  variationText.style.cssText = 'color: #666; margin-bottom: 0.5rem;';
  variationSection.appendChild(variationText);

  // Current variation progress bar
  const variationBarTrack = document.createElement('div');
  variationBarTrack.className = 'progress-bar-track';
  variationBarTrack.style.cssText = 'width: 100%; height: 16px; background: #e0e0e0; border-radius: 8px; overflow: hidden;';

  const variationBarFill = document.createElement('div');
  variationBarFill.className = 'progress-bar-fill';
  variationBarFill.style.cssText = 'height: 100%; background: #28a745; width: 0%; transition: width 0.3s;';
  variationBarTrack.appendChild(variationBarFill);

  variationSection.appendChild(variationBarTrack);
  progressSection.appendChild(variationSection);

  wrapper.appendChild(progressSection);

  // Action buttons section
  const buttonSection = document.createElement('div');
  buttonSection.style.cssText = 'display: flex; gap: 1rem; margin-bottom: 2rem;';

  // Cancel button
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel Processing';
  cancelBtn.className = 'btn btn-danger';
  cancelBtn.style.display = 'inline-block';
  buttonSection.appendChild(cancelBtn);

  // Download button (initially hidden)
  const downloadBtn = document.createElement('button');
  downloadBtn.textContent = 'Download ZIP';
  downloadBtn.className = 'btn btn-primary';
  downloadBtn.style.display = 'none';
  buttonSection.appendChild(downloadBtn);

  wrapper.appendChild(buttonSection);

  // Results summary section (initially hidden)
  const resultsSection = document.createElement('div');
  resultsSection.className = 'results-summary';
  resultsSection.style.cssText = 'background: #e7f3ff; padding: 1.5rem; border-radius: 8px; margin-bottom: 1rem; display: none;';

  const resultsTitle = document.createElement('h3');
  resultsTitle.textContent = 'Processing Results';
  resultsTitle.style.marginBottom = '1rem';
  resultsSection.appendChild(resultsTitle);

  const resultsText = document.createElement('div');
  resultsText.style.cssText = 'color: #333; font-size: 1rem;';
  resultsSection.appendChild(resultsText);

  wrapper.appendChild(resultsSection);

  // Start new batch link (initially hidden)
  const newBatchLink = document.createElement('a');
  newBatchLink.href = '#upload';
  newBatchLink.textContent = 'Start New Batch';
  newBatchLink.className = 'btn btn-secondary';
  newBatchLink.style.cssText = 'display: none; margin-top: 1rem;';
  wrapper.appendChild(newBatchLink);

  container.appendChild(wrapper);

  // Start processing
  await startProcessing(
    files,
    variationCount,
    statusText,
    overallBarFill,
    overallText,
    variationText,
    variationBarFill,
    cancelBtn,
    downloadBtn,
    resultsSection,
    resultsText,
    newBatchLink
  );
}

/**
 * Start processing videos
 */
async function startProcessing(
  files,
  variationCount,
  statusText,
  overallBarFill,
  overallText,
  variationText,
  variationBarFill,
  cancelBtn,
  downloadBtn,
  resultsSection,
  resultsText,
  newBatchLink
) {
  allResults = [];
  let cancelled = false;

  // Create worker pool
  workerPool = new WorkerPool(2);

  // Update status
  statusText.textContent = 'Loading FFmpeg.wasm...';

  // Initialize FFmpeg
  try {
    const initResult = await workerPool.init();

    if (!initResult.success) {
      throw new Error('FFmpeg initialization failed');
    }

    // Update status with mode
    const modeText = initResult.mode === 'multi-threaded'
      ? 'FFmpeg loaded (multi-threaded)'
      : 'FFmpeg loaded (single-threaded)';
    statusText.textContent = modeText;

  } catch (error) {
    statusText.textContent = 'FFmpeg.wasm failed to load';
    statusText.style.color = '#c33';

    const errorMsg = document.createElement('p');
    errorMsg.textContent = 'FFmpeg.wasm failed to load. Try server processing instead.';
    errorMsg.style.cssText = 'color: #c33; margin-top: 1rem;';
    statusText.parentElement.appendChild(errorMsg);

    const backLink = document.createElement('a');
    backLink.href = '#upload';
    backLink.textContent = 'Back to Upload';
    backLink.className = 'btn btn-primary';
    backLink.style.cssText = 'display: inline-block; margin-top: 1rem;';
    statusText.parentElement.appendChild(backLink);

    cancelBtn.style.display = 'none';
    return;
  }

  // Set processing flag and attach beforeunload handler
  processing = true;
  beforeUnloadHandler = (event) => {
    if (processing) {
      event.preventDefault();
      return '';
    }
  };
  window.addEventListener('beforeunload', beforeUnloadHandler);

  // Calculate total variations
  const totalVariations = files.length * variationCount;
  let completedCount = 0;
  let failedCount = 0;

  // Process each file sequentially
  for (let fileIdx = 0; fileIdx < files.length; fileIdx++) {
    if (cancelled) break;

    const file = files[fileIdx];
    statusText.textContent = `Processing file ${fileIdx + 1} of ${files.length}: ${file.name}`;

    // Generate unique effects for this file
    const effects = generateUniqueEffects(Math.random, variationCount);

    // Progress update callback
    const onProgress = (progressState) => {
      // Update overall progress
      const overallProgress = (completedCount + (progressState.completed / totalVariations)) / (totalVariations / files.length);
      overallBarFill.style.width = `${Math.round(overallProgress * 100)}%`;
      overallText.textContent = `${completedCount} of ${totalVariations} variations complete`;

      // Update current variation
      if (progressState.currentVariation > 0) {
        variationText.textContent = `Processing variation ${progressState.currentVariation} of ${variationCount}...`;
        variationBarFill.style.width = `${Math.round(progressState.variationProgress * 100)}%`;
      }
    };

    // Variation complete callback
    const onVariationComplete = (variationIndex, success) => {
      if (success) {
        completedCount++;
      } else {
        failedCount++;
      }
    };

    // Process video with worker pool
    try {
      const result = await workerPool.processVideo(file, effects, onProgress, onVariationComplete);

      // Collect results (filter out nulls from failures)
      const validResults = result.results.filter(r => r !== null);
      allResults = allResults.concat(validResults);

      if (result.cancelled) {
        cancelled = true;
        break;
      }

    } catch (error) {
      console.error('Error processing file:', file.name, error);
      // Continue with next file
    }
  }

  // Processing complete or cancelled
  processing = false;
  window.removeEventListener('beforeunload', beforeUnloadHandler);

  // Update UI
  if (cancelled) {
    statusText.textContent = 'Processing cancelled';
    statusText.style.color = '#dc3545';

    resultsSection.style.display = 'block';
    resultsSection.style.background = '#fff3cd';
    resultsText.innerHTML = `<strong>Partial Results:</strong><br>${completedCount} of ${totalVariations} variations completed before cancellation`;

    if (allResults.length > 0) {
      downloadBtn.textContent = 'Download ZIP (partial)';
      downloadBtn.style.display = 'inline-block';
    }
  } else {
    if (failedCount > 0) {
      statusText.textContent = 'Processing complete with errors';
      statusText.style.color = '#ffc107';

      resultsSection.style.display = 'block';
      resultsSection.style.background = '#fff3cd';
      resultsText.innerHTML = `<strong>Completed:</strong> ${completedCount} of ${totalVariations} variations<br><strong>Failed:</strong> ${failedCount} variations`;
    } else {
      statusText.textContent = 'Processing complete!';
      statusText.style.color = '#28a745';

      resultsSection.style.display = 'block';
      resultsText.innerHTML = `<strong>Success!</strong> ${completedCount} of ${totalVariations} variations completed successfully`;
    }

    if (allResults.length > 0) {
      downloadBtn.style.display = 'inline-block';
    }
  }

  // Update final progress
  overallBarFill.style.width = `${Math.round((completedCount / totalVariations) * 100)}%`;
  overallText.textContent = `${completedCount} of ${totalVariations} variations complete`;

  // Hide cancel button, show new batch link
  cancelBtn.style.display = 'none';
  newBatchLink.style.display = 'inline-block';

  // Cancel button handler
  cancelBtn.onclick = async () => {
    if (!workerPool) return;

    cancelled = true;
    const partialResults = workerPool.cancel();

    cancelBtn.disabled = true;
    cancelBtn.style.opacity = '0.5';
    statusText.textContent = 'Cancelling...';
  };

  // Download button handler
  downloadBtn.onclick = async () => {
    try {
      downloadBtn.disabled = true;
      downloadBtn.textContent = 'Generating ZIP...';

      const zipBlob = await generateZip(allResults);
      triggerDownload(zipBlob, 'processed-videos.zip');

      downloadBtn.disabled = false;
      downloadBtn.textContent = 'Download ZIP';
    } catch (error) {
      console.error('Download failed:', error);
      downloadBtn.disabled = false;
      downloadBtn.textContent = 'Download Failed - Retry';
    }
  };
}

/**
 * Check if device processing is currently active
 * @returns {boolean}
 */
export function isDeviceProcessing() {
  return processing;
}

/**
 * Cleanup function for navigation away
 */
export function cleanupDeviceProgress() {
  if (workerPool && processing) {
    workerPool.terminate();
  }

  if (beforeUnloadHandler) {
    window.removeEventListener('beforeunload', beforeUnloadHandler);
  }

  // Reset module state
  workerPool = null;
  processing = false;
  beforeUnloadHandler = null;
  allResults = [];
}
