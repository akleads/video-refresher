// Main SPA entry point

import { Router } from './lib/router.js';
import { clearToken, isAuthenticated } from './lib/api.js';
import { renderLogin } from './views/login.js';
import { renderUpload } from './views/upload.js';
import { renderJobDetail } from './views/job-detail.js';
import { renderJobList } from './views/job-list.js';

const router = new Router();

/**
 * Show a view and update UI state
 * @param {string} viewName - View name (login, upload, jobs, job-detail)
 * @param {function} renderFn - Render function to call
 */
function showView(viewName, renderFn) {
  // Hide all views
  document.querySelectorAll('.view').forEach(view => {
    view.style.display = 'none';
  });

  // Show target view
  const targetView = document.getElementById(`view-${viewName}`);
  if (targetView) {
    targetView.style.display = 'block';
  }

  // Show/hide nav (hidden for login, visible for all others)
  const nav = document.getElementById('nav');
  if (viewName === 'login') {
    nav.style.display = 'none';
  } else {
    nav.style.display = 'flex';
  }

  // Update active nav tab
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.classList.remove('active');
    const route = tab.getAttribute('data-route');
    if ((viewName === 'upload' && route === 'upload') ||
        (viewName === 'jobs' && route === 'jobs') ||
        (viewName === 'job-detail' && route === 'jobs')) {
      tab.classList.add('active');
    }
  });

  // Call render function
  return renderFn;
}

// Register routes
router.add('', (params) => showView('login', renderLogin)(params));
router.add('login', (params) => showView('login', renderLogin)(params));
router.add('upload', (params) => showView('upload', renderUpload)(params));
router.add('jobs', (params) => showView('jobs', renderJobList)(params));
router.add('job/:id', (params) => showView('job-detail', () => renderJobDetail(params.id))(params));

// Wire up logout button
document.addEventListener('DOMContentLoaded', () => {
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      clearToken();
      window.location.hash = '#login';
    });
  }

  // Start router
  router.start();

  // If not authenticated and not on login page, redirect to login
  if (!isAuthenticated() && !window.location.hash.startsWith('#login')) {
    window.location.hash = '#login';
  }
});
