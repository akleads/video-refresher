// Job detail view with adaptive polling and download

import { apiCall } from '../lib/api.js';
import { timeUntil } from '../lib/utils.js';

// Polling state (module-level)
let pollTimer = null;
let pollInterval = 2000; // Start at 2s
const MAX_POLL_INTERVAL = 10000; // Cap at 10s
const BACKOFF_MULTIPLIER = 1.5;
let isPolling = false;
let currentJobId = null;

// Page Visibility API - pause polling when tab hidden
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // Tab hidden - clear timer
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  } else {
    // Tab visible - resume if polling
    if (isPolling && currentJobId) {
      poll();
    }
  }
});

/**
 * Render job detail view
 * @param {string} jobId - Job ID to display
 */
export function renderJobDetail(jobId) {
  currentJobId = jobId;
  const container = document.getElementById('view-job-detail');

  // Clear container
  container.textContent = '';

  // Build UI structure
  const backLink = document.createElement('a');
  backLink.href = '#jobs';
  backLink.className = 'back-link';
  backLink.textContent = '← Back to Jobs';

  const header = document.createElement('div');
  header.className = 'job-header';

  const jobIdEl = document.createElement('h2');
  jobIdEl.textContent = `Job ${jobId}`;

  const statusBadge = document.createElement('span');
  statusBadge.className = 'badge';
  statusBadge.id = 'status-badge';
  statusBadge.textContent = 'Loading...';

  header.appendChild(jobIdEl);
  header.appendChild(statusBadge);

  const progressSection = document.createElement('div');
  progressSection.id = 'progress-section';
  // TODO: migrate to CSS class
  progressSection.style.display = 'none';

  const progressLabel = document.createElement('div');
  progressLabel.className = 'progress-label';
  progressLabel.textContent = 'Overall Progress';

  const progressBar = document.createElement('div');
  progressBar.className = 'progress-bar';

  const progressFill = document.createElement('div');
  progressFill.className = 'progress-fill';
  progressFill.id = 'progress-fill';
  progressFill.style.width = '0%';

  progressBar.appendChild(progressFill);
  progressSection.appendChild(progressLabel);
  progressSection.appendChild(progressBar);

  const summarySection = document.createElement('div');
  summarySection.id = 'summary-section';
  summarySection.className = 'job-summary';

  const downloadSection = document.createElement('div');
  downloadSection.id = 'download-section';
  // TODO: migrate to CSS class
  downloadSection.style.display = 'none';

  const cancelSection = document.createElement('div');
  cancelSection.id = 'cancel-section';
  // TODO: migrate to CSS class
  cancelSection.style.display = 'none';

  const errorSection = document.createElement('div');
  errorSection.id = 'error-section';
  // TODO: migrate to CSS class
  errorSection.style.display = 'none';
  errorSection.className = 'error-box';

  container.appendChild(backLink);
  container.appendChild(header);
  container.appendChild(progressSection);
  container.appendChild(summarySection);
  container.appendChild(downloadSection);
  container.appendChild(cancelSection);
  container.appendChild(errorSection);

  // Fetch immediately and start polling
  fetchAndUpdateJob();
}

/**
 * Fetch job data and update UI
 */
async function fetchAndUpdateJob() {
  try {
    const response = await apiCall(`/api/jobs/${currentJobId}`);
    const data = await response.json();
    updateJobDetailUI(data);

    // Decide if we should keep polling
    if (data.status === 'completed' || data.status === 'failed' || data.status === 'cancelled') {
      stopPolling();
    } else {
      // Job still active, schedule next poll with backoff
      isPolling = true;
      scheduleNextPoll();
    }
  } catch (err) {
    console.error('Failed to fetch job:', err);
    const errorSection = document.getElementById('error-section');
    errorSection.textContent = `Error loading job: ${err.message}`;
    errorSection.style.display = 'block';
    stopPolling();
  }
}

/**
 * Poll for job updates
 */
function poll() {
  if (!isPolling || !currentJobId) return;
  fetchAndUpdateJob();
}

/**
 * Schedule next poll with backoff and jitter
 */
function scheduleNextPoll() {
  if (pollTimer) {
    clearTimeout(pollTimer);
  }

  // Add jitter (±20%)
  const jitter = 0.8 + Math.random() * 0.4;
  const delay = Math.min(pollInterval * jitter, MAX_POLL_INTERVAL);

  pollTimer = setTimeout(() => {
    poll();
  }, delay);

  // Increase interval for next time (with cap)
  pollInterval = Math.min(pollInterval * BACKOFF_MULTIPLIER, MAX_POLL_INTERVAL);
}

/**
 * Stop polling
 */
function stopPolling() {
  isPolling = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

/**
 * Update job detail UI with data
 * @param {object} data - Job data from API
 */
function updateJobDetailUI(data) {
  // Update status badge
  const statusBadge = document.getElementById('status-badge');
  statusBadge.className = 'badge';

  if (data.status === 'queued') {
    statusBadge.classList.add('badge-gray');
    statusBadge.textContent = 'Queued';
  } else if (data.status === 'processing') {
    statusBadge.classList.add('badge-blue');
    statusBadge.textContent = 'Processing';
  } else if (data.status === 'completed') {
    statusBadge.classList.add('badge-green');
    statusBadge.textContent = 'Completed';
  } else if (data.status === 'failed') {
    statusBadge.classList.add('badge-red');
    statusBadge.textContent = 'Failed';
  } else if (data.status === 'cancelled') {
    statusBadge.classList.add('badge-gray');
    // Show completion count for cancelled jobs
    if (data.files && data.variationsPerFile) {
      const completedCount = data.files.reduce((sum, file) => {
        if (file.output && file.output.length > 0) {
          return sum + file.output.length;
        }
        return sum;
      }, 0);
      const totalCount = data.files.length * data.variationsPerFile;
      statusBadge.textContent = `Cancelled (${completedCount}/${totalCount})`;
    } else {
      statusBadge.textContent = 'Cancelled';
    }
  }

  // Update progress bar (only for processing)
  const progressSection = document.getElementById('progress-section');
  if (data.status === 'processing') {
    progressSection.style.display = 'block';
    const progressFill = document.getElementById('progress-fill');
    const progress = data.overallProgress || 0;
    progressFill.style.width = `${progress}%`;
    progressFill.textContent = `${Math.round(progress)}%`;
  } else {
    progressSection.style.display = 'none';
  }

  // Update summary
  const summarySection = document.getElementById('summary-section');
  summarySection.textContent = '';

  const videoCount = data.files ? data.files.length : 0;
  const variationCount = data.variationsPerFile || 0;

  const summaryText = document.createElement('p');
  summaryText.textContent = `${videoCount} video${videoCount !== 1 ? 's' : ''}, ${variationCount} variation${variationCount !== 1 ? 's' : ''} per video`;
  summarySection.appendChild(summaryText);

  // Check for partial failures
  if (data.status === 'completed' && data.files) {
    const failedFiles = data.files.filter(f => f.status === 'failed');
    if (failedFiles.length > 0) {
      const partialWarning = document.createElement('p');
      partialWarning.className = 'warning-text';
      partialWarning.textContent = `${failedFiles.length} file${failedFiles.length !== 1 ? 's' : ''} failed to process`;
      summarySection.appendChild(partialWarning);
    }
  }

  // Update download section (for completed or cancelled with completed variations)
  const downloadSection = document.getElementById('download-section');
  const hasCompletedVariations = data.files && data.files.some(f => f.output && f.output.length > 0);

  if (data.status === 'completed' || (data.status === 'cancelled' && hasCompletedVariations)) {
    downloadSection.textContent = '';
    downloadSection.style.display = 'block';

    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'btn btn-primary';
    downloadBtn.textContent = 'Download ZIP';
    downloadBtn.addEventListener('click', () => handleDownload());

    const expiryInfo = document.createElement('p');
    expiryInfo.className = 'expiry-info';

    // Calculate expiry (24h from createdAt)
    const createdAt = new Date(data.createdAt.endsWith('Z') ? data.createdAt : data.createdAt + 'Z');
    const expiryDate = new Date(createdAt.getTime() + 24 * 60 * 60 * 1000);
    const timeLeft = timeUntil(expiryDate.toISOString());

    if (timeLeft === 'expired') {
      expiryInfo.textContent = 'Expired - files have been removed';
      downloadBtn.disabled = true;
    } else {
      expiryInfo.textContent = `Expires in ${timeLeft}`;
    }

    if (data.status === 'cancelled') {
      const partialNote = document.createElement('p');
      partialNote.className = 'cancelled-info';
      partialNote.textContent = 'Partial results available';
      downloadSection.appendChild(partialNote);
    }

    downloadSection.appendChild(downloadBtn);
    downloadSection.appendChild(expiryInfo);
  } else {
    downloadSection.style.display = 'none';
  }

  // Update cancel section (show for processing or queued)
  const cancelSection = document.getElementById('cancel-section');
  if (data.status === 'processing' || data.status === 'queued') {
    cancelSection.textContent = '';
    cancelSection.style.display = 'block';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-danger';
    cancelBtn.textContent = 'Cancel Job';
    cancelBtn.id = 'cancel-btn';
    cancelBtn.addEventListener('click', () => handleCancel());

    cancelSection.appendChild(cancelBtn);
  } else {
    cancelSection.style.display = 'none';
  }

  // Update error section (only for failed)
  const errorSection = document.getElementById('error-section');
  if (data.status === 'failed' && data.error) {
    errorSection.textContent = `Error: ${data.error}`;
    errorSection.style.display = 'block';
  } else {
    errorSection.style.display = 'none';
  }
}

/**
 * Handle cancel button click
 */
async function handleCancel() {
  // Confirmation dialog
  const confirmed = confirm('Are you sure you want to cancel this job? Any in-progress variations will be stopped.');
  if (!confirmed) {
    return;
  }

  const cancelBtn = document.getElementById('cancel-btn');
  const originalText = cancelBtn.textContent;

  try {
    // Update button to "Cancelling..." and disable
    cancelBtn.textContent = 'Cancelling...';
    cancelBtn.disabled = true;
    cancelBtn.classList.add('btn-disabled');

    // Send cancel request
    await apiCall(`/api/jobs/${currentJobId}/cancel`, {
      method: 'POST'
    });

    // Fetch updated job status immediately
    fetchAndUpdateJob();
  } catch (err) {
    console.error('Cancel failed:', err);
    alert(`Failed to cancel job: ${err.message}`);

    // Re-enable button on error for retry
    cancelBtn.textContent = originalText;
    cancelBtn.disabled = false;
    cancelBtn.classList.remove('btn-disabled');
  }
}

/**
 * Handle download button click
 */
async function handleDownload() {
  try {
    const response = await apiCall(`/api/jobs/${currentJobId}/download`);
    const blob = await response.blob();

    // Create blob URL and trigger download
    const blobUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = blobUrl;
    anchor.download = `job-${currentJobId}.zip`;
    anchor.click();

    // Revoke blob URL after short delay
    setTimeout(() => {
      URL.revokeObjectURL(blobUrl);
    }, 1000);
  } catch (err) {
    console.error('Download failed:', err);
    alert(`Download failed: ${err.message}`);
  }
}

/**
 * Cleanup job detail view
 */
export function cleanupJobDetail() {
  stopPolling();
  currentJobId = null;
  pollInterval = 2000; // Reset interval
}
