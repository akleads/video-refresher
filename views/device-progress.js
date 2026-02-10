/**
 * Device Processing Progress View
 * Displays real-time progress for on-device video processing using FFmpeg.wasm
 */

import { WorkerPool } from '../lib/device-processing/worker-pool.js';
import { generateZip, triggerDownload } from '../lib/device-processing/zip-generator.js';
import { generateUniqueEffects } from '../lib/effects-shared.js';
import { uploadDeviceResults } from '../lib/api.js';

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
    // TODO: migrate to CSS class
    errorWrapper.style.cssText = 'max-width: 600px; margin: var(--spacing-xl) auto; padding: var(--spacing-xl); text-align: center;';

    const errorTitle = document.createElement('h2');
    errorTitle.textContent = 'No files to process';
    errorTitle.style.color = 'var(--color-error-text)';
    errorWrapper.appendChild(errorTitle);

    const errorText = document.createElement('p');
    errorText.textContent = 'No files to process. Go back to upload.';
    // TODO: migrate to CSS class
    errorText.style.cssText = 'margin: var(--spacing-base) 0; color: var(--color-text-secondary);';
    errorWrapper.appendChild(errorText);

    const backLink = document.createElement('a');
    backLink.href = '#upload';
    backLink.textContent = 'Back to Upload';
    backLink.className = 'btn btn-primary';
    // TODO: migrate to CSS class
    backLink.style.cssText = 'display: inline-block; margin-top: var(--spacing-base);';
    errorWrapper.appendChild(backLink);

    container.appendChild(errorWrapper);
    return;
  }

  // Main wrapper
  const wrapper = document.createElement('div');
  // TODO: migrate to CSS class
  wrapper.style.cssText = 'max-width: 800px; margin: var(--spacing-xl) auto; padding: var(--spacing-base);';

  // Title section
  const title = document.createElement('h1');
  title.textContent = 'Processing on Device';
  wrapper.appendChild(title);

  // Device badge
  const deviceBadge = document.createElement('div');
  deviceBadge.className = 'device-badge';
  deviceBadge.textContent = 'ON DEVICE';
  // TODO: migrate to CSS class
  deviceBadge.style.cssText = 'display: inline-block; background: var(--color-green-600); color: var(--color-gray-50); padding: var(--spacing-xs) var(--spacing-md); border-radius: var(--radius-xl); font-size: var(--font-size-xs); font-weight: var(--font-weight-semibold); margin-bottom: var(--spacing-sm);';
  wrapper.appendChild(deviceBadge);

  // Subtitle
  const subtitle = document.createElement('p');
  subtitle.textContent = 'Processing locally in your browser -- no data sent to server';
  // TODO: migrate to CSS class
  subtitle.style.cssText = 'color: var(--color-text-secondary); margin-bottom: var(--spacing-xl);';
  wrapper.appendChild(subtitle);

  // Device progress section
  const progressSection = document.createElement('div');
  progressSection.className = 'device-progress-section';
  // TODO: migrate to CSS class
  progressSection.style.cssText = 'background: var(--color-bg-card); padding: var(--spacing-xl); border-radius: var(--radius-lg); margin-bottom: var(--spacing-xl);';

  // Status text
  const statusText = document.createElement('div');
  statusText.textContent = 'Initializing FFmpeg...';
  // TODO: migrate to CSS class
  statusText.style.cssText = 'font-weight: var(--font-weight-medium); margin-bottom: var(--spacing-base); color: var(--color-text-primary);';
  progressSection.appendChild(statusText);

  // Overall progress label
  const overallLabel = document.createElement('div');
  overallLabel.textContent = 'Overall Progress';
  // TODO: migrate to CSS class
  overallLabel.style.cssText = 'font-weight: var(--font-weight-semibold); margin-bottom: var(--spacing-sm); color: var(--color-text-secondary);';
  progressSection.appendChild(overallLabel);

  // Overall progress bar
  const overallBarTrack = document.createElement('div');
  overallBarTrack.className = 'progress-bar-track';
  // TODO: migrate to CSS class
  overallBarTrack.style.cssText = 'width: 100%; height: 24px; background: var(--color-gray-700); border-radius: var(--radius-xl); overflow: hidden; margin-bottom: var(--spacing-sm);';

  const overallBarFill = document.createElement('div');
  overallBarFill.className = 'progress-bar-fill';
  // TODO: migrate to CSS class
  overallBarFill.style.cssText = 'height: 100%; background: var(--color-accent); width: 0%; transition: width 0.3s;';
  overallBarTrack.appendChild(overallBarFill);

  progressSection.appendChild(overallBarTrack);

  // Overall progress text
  const overallText = document.createElement('div');
  overallText.textContent = '0 of 0 variations complete';
  // TODO: migrate to CSS class
  overallText.style.cssText = 'color: var(--color-text-secondary); font-size: var(--font-size-sm); margin-bottom: var(--spacing-xl);';
  progressSection.appendChild(overallText);

  wrapper.appendChild(progressSection);

  // Action buttons section
  const buttonSection = document.createElement('div');
  // TODO: migrate to CSS class
  buttonSection.style.cssText = 'display: flex; gap: var(--spacing-base); margin-bottom: var(--spacing-xl);';

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
  // TODO: migrate to CSS class
  resultsSection.style.cssText = 'background: var(--color-info-bg); padding: var(--spacing-lg); border-radius: var(--radius-lg); margin-bottom: var(--spacing-base); display: none;';

  const resultsTitle = document.createElement('h3');
  resultsTitle.textContent = 'Processing Results';
  resultsTitle.style.marginBottom = 'var(--spacing-base)';
  resultsSection.appendChild(resultsTitle);

  const resultsText = document.createElement('div');
  // TODO: migrate to CSS class
  resultsText.style.cssText = 'color: var(--color-text-primary); font-size: var(--font-size-base);';
  resultsSection.appendChild(resultsText);

  wrapper.appendChild(resultsSection);

  // Upload progress section (initially hidden)
  const uploadSection = document.createElement('div');
  uploadSection.className = 'upload-progress-section';
  // TODO: migrate to CSS class
  uploadSection.style.cssText = 'background: var(--color-bg-card); padding: var(--spacing-xl); border-radius: var(--radius-lg); margin-bottom: var(--spacing-xl); display: none;';

  const uploadLabel = document.createElement('div');
  uploadLabel.textContent = 'Uploading to server...';
  // TODO: migrate to CSS class
  uploadLabel.style.cssText = 'font-weight: var(--font-weight-semibold); margin-bottom: var(--spacing-sm); color: var(--color-text-secondary);';
  uploadSection.appendChild(uploadLabel);

  const uploadBarTrack = document.createElement('div');
  // TODO: migrate to CSS class
  uploadBarTrack.style.cssText = 'width: 100%; height: 24px; background: var(--color-gray-700); border-radius: var(--radius-xl); overflow: hidden; margin-bottom: var(--spacing-sm);';

  const uploadBarFill = document.createElement('div');
  // TODO: migrate to CSS class
  uploadBarFill.style.cssText = 'height: 100%; background: var(--color-accent); width: 0%; transition: width 0.3s;';
  uploadBarTrack.appendChild(uploadBarFill);
  uploadSection.appendChild(uploadBarTrack);

  const uploadText = document.createElement('div');
  uploadText.textContent = '0%';
  // TODO: migrate to CSS class
  uploadText.style.cssText = 'color: var(--color-text-secondary); font-size: var(--font-size-sm); margin-bottom: var(--spacing-sm);';
  uploadSection.appendChild(uploadText);

  const uploadStatus = document.createElement('div');
  uploadStatus.textContent = '';
  // TODO: migrate to CSS class
  uploadStatus.style.cssText = 'font-weight: var(--font-weight-medium); color: var(--color-text-primary);';
  uploadSection.appendChild(uploadStatus);

  wrapper.appendChild(uploadSection);

  // Retry upload button (initially hidden, added to button section)
  const retryBtn = document.createElement('button');
  retryBtn.textContent = 'Retry Upload';
  retryBtn.className = 'btn btn-secondary';
  retryBtn.style.display = 'none';
  buttonSection.appendChild(retryBtn);

  // View in History link (initially hidden, added to button section)
  const viewHistoryLink = document.createElement('a');
  viewHistoryLink.textContent = 'View in History';
  viewHistoryLink.className = 'btn btn-primary';
  viewHistoryLink.style.display = 'none';
  buttonSection.appendChild(viewHistoryLink);

  // Start new batch link (initially hidden)
  const newBatchLink = document.createElement('a');
  newBatchLink.href = '#upload';
  newBatchLink.textContent = 'Start New Batch';
  newBatchLink.className = 'btn btn-secondary';
  // TODO: migrate to CSS class
  newBatchLink.style.cssText = 'display: none; margin-top: var(--spacing-base);';
  wrapper.appendChild(newBatchLink);

  container.appendChild(wrapper);

  // Start processing
  const uploadElements = {
    uploadSection,
    uploadBarFill,
    uploadText,
    uploadStatus,
    retryBtn,
    viewHistoryLink,
    newBatchLink,
    statusText
  };

  await startProcessing(
    files,
    variationCount,
    statusText,
    overallBarFill,
    overallText,
    cancelBtn,
    downloadBtn,
    resultsSection,
    resultsText,
    newBatchLink,
    uploadElements
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
  cancelBtn,
  downloadBtn,
  resultsSection,
  resultsText,
  newBatchLink,
  uploadElements
) {
  allResults = [];
  let cancelled = false;

  // Set processing flag early (for navigation guard during init)
  processing = true;
  beforeUnloadHandler = (event) => {
    if (processing) {
      event.preventDefault();
      return '';
    }
  };
  window.addEventListener('beforeunload', beforeUnloadHandler);

  // Set cancel handler early so it works during processing
  cancelBtn.onclick = async () => {
    if (!workerPool) return;
    cancelled = true;
    workerPool.cancel();
    cancelBtn.disabled = true;
    cancelBtn.style.opacity = '0.5';
    statusText.textContent = 'Cancelling...';
  };

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
    processing = false;
    window.removeEventListener('beforeunload', beforeUnloadHandler);

    statusText.textContent = 'FFmpeg.wasm failed to load';
    statusText.style.color = 'var(--color-error-text)';

    const errorMsg = document.createElement('p');
    errorMsg.textContent = 'FFmpeg.wasm failed to load. Try server processing instead.';
    // TODO: migrate to CSS class
    errorMsg.style.cssText = 'color: var(--color-error-text); margin-top: var(--spacing-base);';
    statusText.parentElement.appendChild(errorMsg);

    const backLink = document.createElement('a');
    backLink.href = '#upload';
    backLink.textContent = 'Back to Upload';
    backLink.className = 'btn btn-primary';
    // TODO: migrate to CSS class
    backLink.style.cssText = 'display: inline-block; margin-top: var(--spacing-base);';
    statusText.parentElement.appendChild(backLink);

    cancelBtn.style.display = 'none';
    return;
  }

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
    const onProgress = () => {
      overallBarFill.style.width = `${Math.round((completedCount / totalVariations) * 100)}%`;
      overallText.textContent = `${completedCount} of ${totalVariations} variations complete`;
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
    statusText.style.color = 'var(--color-red-600)';

    resultsSection.style.display = 'block';
    resultsSection.style.background = 'var(--color-warning-bg)';
    resultsText.innerHTML = `<strong>Partial Results:</strong><br>${completedCount} of ${totalVariations} variations completed before cancellation`;

    if (allResults.length > 0) {
      downloadBtn.textContent = 'Download ZIP (partial)';
      downloadBtn.style.display = 'inline-block';
    }
  } else {
    if (failedCount > 0) {
      statusText.textContent = 'Processing complete with errors';
      statusText.style.color = 'var(--color-yellow-500)';

      resultsSection.style.display = 'block';
      resultsSection.style.background = 'var(--color-warning-bg)';
      resultsText.innerHTML = `<strong>Completed:</strong> ${completedCount} of ${totalVariations} variations<br><strong>Failed:</strong> ${failedCount} variations`;
    } else {
      statusText.textContent = 'Processing complete!';
      statusText.style.color = 'var(--color-success-text)';

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

  // Download button handler
  downloadBtn.onclick = async () => {
    try {
      downloadBtn.disabled = true;
      downloadBtn.textContent = 'Generating ZIP...';

      const zipBlob = await generateZip(allResults);
      triggerDownload(zipBlob, `video-refresher-${crypto.randomUUID().slice(0, 8)}.zip`);

      downloadBtn.disabled = false;
      downloadBtn.textContent = 'Download ZIP';
    } catch (error) {
      console.error('Download failed:', error);
      downloadBtn.disabled = false;
      downloadBtn.textContent = 'Download Failed - Retry';
    }
  };

  // Upload results to server if we have any
  if (allResults.length > 0) {
    uploadElements.uploadSection.style.display = 'block';
    uploadElements.uploadStatus.textContent = 'Uploading results to server...';

    // Wire retry button
    uploadElements.retryBtn.onclick = () => {
      uploadElements.retryBtn.style.display = 'none';
      uploadElements.uploadBarFill.style.width = '0%';
      uploadElements.uploadText.textContent = '0%';
      uploadElements.uploadStatus.textContent = 'Uploading results to server...';
      uploadElements.uploadStatus.style.color = 'var(--color-text-primary)';
      uploadResultsToServer(allResults, files, variationCount, uploadElements);
    };

    uploadResultsToServer(allResults, files, variationCount, uploadElements);
  }
}

/**
 * Upload device processing results to the server
 * @param {Array} results - Array of {name, blob} objects
 * @param {Array<File>} files - Original source files
 * @param {number} variationCount - Number of variations per file
 * @param {object} uploadElements - UI element references
 */
async function uploadResultsToServer(results, files, variationCount, uploadElements) {
  const { uploadBarFill, uploadText, uploadStatus, retryBtn, viewHistoryLink, statusText } = uploadElements;

  try {
    // Build FormData
    const formData = new FormData();

    // sourceFiles metadata
    const sourceFilesArray = Array.from(files).map(file => ({
      name: file.name,
      variationCount: variationCount
    }));
    formData.append('sourceFiles', JSON.stringify(sourceFilesArray));

    // Append each result blob
    for (const result of results) {
      formData.append('results', result.blob, result.name);
    }

    // Upload with progress tracking
    const response = await uploadDeviceResults(formData, (percentComplete) => {
      uploadBarFill.style.width = `${percentComplete}%`;
      uploadText.textContent = `${Math.round(percentComplete)}%`;
    });

    // Success
    uploadStatus.textContent = 'Uploaded successfully!';
    uploadStatus.style.color = 'var(--color-success-text)';
    statusText.textContent = 'Processing complete! Results saved to server.';
    statusText.style.color = 'var(--color-success-text)';
    retryBtn.style.display = 'none';

    // Show "View in History" link
    viewHistoryLink.href = `#job/${response.jobId}`;
    viewHistoryLink.style.display = 'inline-block';

  } catch (error) {
    console.error('Upload to server failed:', error);

    uploadStatus.textContent = `Upload failed: ${error.message}`;
    uploadStatus.style.color = 'var(--color-error-text)';
    retryBtn.style.display = 'inline-block';
    statusText.textContent = 'Processing complete! Upload to server failed.';
  }
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
