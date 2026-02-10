// Job list view with polling refresh

import { apiCall } from '../lib/api.js';
import { timeAgo } from '../lib/utils.js';

// Polling state (module-level)
let pollTimer = null;
const POLL_INTERVAL = 5000; // Fixed 5s interval
let isPolling = false;

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
    if (isPolling) {
      poll();
    }
  }
});

/**
 * Render job list view
 * @param {object} params - URL parameters (unused)
 */
export function renderJobList(params) {
  const container = document.getElementById('view-jobs');

  // Clear container
  container.textContent = '';

  // Build UI structure
  const heading = document.createElement('h2');
  heading.textContent = 'My Jobs';

  const jobListContainer = document.createElement('div');
  jobListContainer.id = 'job-list-container';
  jobListContainer.className = 'job-list';

  const emptyState = document.createElement('div');
  emptyState.id = 'empty-state';
  emptyState.className = 'empty-state';
  emptyState.style.display = 'none';
  emptyState.textContent = 'No jobs yet. Upload some videos to get started!';

  container.appendChild(heading);
  container.appendChild(jobListContainer);
  container.appendChild(emptyState);

  // Fetch and render immediately, start polling
  fetchAndRenderJobs();
}

/**
 * Fetch jobs and render list
 */
async function fetchAndRenderJobs() {
  try {
    const response = await apiCall('/api/jobs');
    const jobs = await response.json();

    // Sort by createdAt descending (newest first)
    jobs.sort((a, b) => {
      const dateA = new Date(a.createdAt.endsWith('Z') ? a.createdAt : a.createdAt + 'Z');
      const dateB = new Date(b.createdAt.endsWith('Z') ? b.createdAt : b.createdAt + 'Z');
      return dateB - dateA;
    });

    renderJobsList(jobs);

    // Start polling if not already
    if (!isPolling) {
      isPolling = true;
      scheduleNextPoll();
    }
  } catch (err) {
    console.error('Failed to fetch jobs:', err);
    const container = document.getElementById('job-list-container');
    container.textContent = `Error loading jobs: ${err.message}`;
  }
}

/**
 * Poll for job updates
 */
function poll() {
  if (!isPolling) return;
  fetchAndRenderJobs();
}

/**
 * Schedule next poll
 */
function scheduleNextPoll() {
  if (pollTimer) {
    clearTimeout(pollTimer);
  }

  pollTimer = setTimeout(() => {
    poll();
  }, POLL_INTERVAL);
}

/**
 * Render jobs list
 * @param {Array} jobs - Array of job objects
 */
function renderJobsList(jobs) {
  const container = document.getElementById('job-list-container');
  const emptyState = document.getElementById('empty-state');

  // Clear container
  container.textContent = '';

  if (jobs.length === 0) {
    emptyState.style.display = 'block';
    return;
  }

  emptyState.style.display = 'none';

  // Render each job
  jobs.forEach(job => {
    const jobCard = document.createElement('div');
    jobCard.className = 'job-card';

    // Check if expired (24h from createdAt)
    const createdAt = new Date(job.createdAt.endsWith('Z') ? job.createdAt : job.createdAt + 'Z');
    const expiryDate = new Date(createdAt.getTime() + 24 * 60 * 60 * 1000);
    const now = new Date();
    const isExpired = now >= expiryDate;

    if (isExpired) {
      jobCard.classList.add('job-card-expired');
    }

    // Header with ID and status
    const header = document.createElement('div');
    header.className = 'job-card-header';

    const jobId = document.createElement('span');
    jobId.className = 'job-card-id';
    jobId.textContent = `Job ${job.id}`;

    const statusBadge = document.createElement('span');
    statusBadge.className = 'badge';

    if (isExpired) {
      statusBadge.classList.add('badge-gray');
      statusBadge.textContent = 'Expired';
    } else {
      if (job.status === 'queued') {
        statusBadge.classList.add('badge-gray');
        statusBadge.textContent = 'Queued';
      } else if (job.status === 'processing') {
        statusBadge.classList.add('badge-blue');
        statusBadge.textContent = 'Processing';
      } else if (job.status === 'completed') {
        statusBadge.classList.add('badge-green');
        statusBadge.textContent = 'Completed';
      } else if (job.status === 'failed') {
        statusBadge.classList.add('badge-red');
        statusBadge.textContent = 'Failed';
      } else if (job.status === 'cancelled') {
        statusBadge.classList.add('badge-gray');
        statusBadge.textContent = 'Cancelled';
      }
    }

    header.appendChild(jobId);
    header.appendChild(statusBadge);

    // Details
    const details = document.createElement('div');
    details.className = 'job-card-details';

    const videoCount = job.files ? job.files.length : 0;
    const variationCount = job.variationsPerFile || 0;

    const summary = document.createElement('p');
    summary.textContent = `${videoCount} video${videoCount !== 1 ? 's' : ''} × ${variationCount} variation${variationCount !== 1 ? 's' : ''}`;

    const timestamp = document.createElement('p');
    timestamp.className = 'job-card-timestamp';
    timestamp.textContent = timeAgo(job.createdAt);

    details.appendChild(summary);
    details.appendChild(timestamp);

    // Actions
    const actions = document.createElement('div');
    actions.className = 'job-card-actions';

    if (!isExpired) {
      // Add cancel button for processing/queued jobs
      if (job.status === 'processing' || job.status === 'queued') {
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'btn btn-danger btn-sm';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          handleJobCancel(job.id, cancelBtn);
        });
        actions.appendChild(cancelBtn);
      }

      const actionLink = document.createElement('a');
      actionLink.href = `#job/${job.id}`;

      if (job.status === 'completed') {
        actionLink.textContent = 'Download';
        actionLink.className = 'btn btn-primary btn-sm';
      } else if (job.status === 'processing') {
        actionLink.textContent = 'View Progress';
        actionLink.className = 'btn btn-secondary btn-sm';
      } else if (job.status === 'failed') {
        actionLink.textContent = 'View Details';
        actionLink.className = 'btn btn-secondary btn-sm';
      } else if (job.status === 'queued') {
        actionLink.textContent = 'View Details';
        actionLink.className = 'btn btn-secondary btn-sm';
      } else if (job.status === 'cancelled') {
        actionLink.textContent = 'View Details';
        actionLink.className = 'btn btn-secondary btn-sm';
      }

      actions.appendChild(actionLink);
    } else {
      const expiredText = document.createElement('span');
      expiredText.className = 'expired-text';
      expiredText.textContent = 'Files removed';
      actions.appendChild(expiredText);
    }

    // Assemble card
    jobCard.appendChild(header);
    jobCard.appendChild(details);
    jobCard.appendChild(actions);

    container.appendChild(jobCard);
  });
}

/**
 * Handle inline cancel button click
 * @param {string} jobId - Job ID to cancel
 * @param {HTMLButtonElement} button - Cancel button element
 */
async function handleJobCancel(jobId, button) {
  // Confirmation dialog
  const confirmed = confirm('Are you sure you want to cancel this job?');
  if (!confirmed) {
    return;
  }

  const originalText = button.textContent;

  try {
    // Update button to "Cancelling..." and disable
    button.textContent = 'Cancelling...';
    button.disabled = true;
    button.classList.add('btn-disabled');

    // Send cancel request
    await apiCall(`/api/jobs/${jobId}/cancel`, {
      method: 'POST'
    });

    // Refresh job list immediately
    fetchAndRenderJobs();
  } catch (err) {
    console.error('Cancel failed:', err);
    alert(`Failed to cancel job: ${err.message}`);

    // Re-enable button on error for retry
    button.textContent = originalText;
    button.disabled = false;
    button.classList.remove('btn-disabled');
  }
}

/**
 * Cleanup job list view
 */
export function cleanupJobList() {
  isPolling = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}
