// Centralized API client with auth and 401 handling

// Determine API base URL
export const API_BASE = window.location.hostname === 'localhost'
  ? 'http://localhost:8080'
  : 'https://video-refresher-api.fly.dev';

/**
 * Make an authenticated API call
 * @param {string} url - API endpoint (e.g., '/api/jobs')
 * @param {object} options - fetch options
 * @returns {Promise<Response>} - Response object (caller decides if .json() or .blob())
 */
export async function apiCall(url, options = {}) {
  const token = localStorage.getItem('token');

  const headers = {
    ...options.headers
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(API_BASE + url, {
    ...options,
    headers
  });

  if (response.status === 401) {
    localStorage.removeItem('token');
    window.location.hash = '#login?expired=1';
    throw new Error('Session expired');
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HTTP ${response.status}: ${body}`);
  }

  return response;
}

/**
 * Upload files with progress tracking
 * @param {string} url - API endpoint
 * @param {FormData} formData - Form data with files
 * @param {function} onProgress - Callback for upload progress (0-100)
 * @returns {Promise<object>} - Parsed JSON response
 */
export function uploadFiles(url, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const token = localStorage.getItem('token');

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) {
        const percentComplete = (e.loaded / e.total) * 100;
        onProgress(percentComplete);
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          resolve(data);
        } catch (err) {
          reject(new Error('Failed to parse response'));
        }
      } else if (xhr.status === 401) {
        localStorage.removeItem('token');
        window.location.hash = '#login?expired=1';
        reject(new Error('Session expired'));
      } else {
        reject(new Error(`HTTP ${xhr.status}: ${xhr.responseText}`));
      }
    });

    xhr.addEventListener('error', () => {
      reject(new Error('Network error'));
    });

    xhr.open('POST', API_BASE + url);

    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }

    xhr.send(formData);
  });
}

/**
 * Upload device processing results with progress tracking
 * @param {FormData} formData - Form data with result blobs and sourceFiles metadata
 * @param {function} onProgress - Callback for upload progress (0-100)
 * @returns {Promise<object>} - Parsed JSON response {jobId, status, totalVideos, totalVariations, source}
 */
export function uploadDeviceResults(formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const token = localStorage.getItem('token');

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) {
        const percentComplete = (e.loaded / e.total) * 100;
        onProgress(percentComplete);
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch (err) {
          reject(new Error('Failed to parse response'));
        }
      } else if (xhr.status === 401) {
        localStorage.removeItem('token');
        window.location.hash = '#login?expired=1';
        reject(new Error('Session expired'));
      } else {
        reject(new Error(`Upload failed: HTTP ${xhr.status}`));
      }
    });

    xhr.addEventListener('error', () => {
      reject(new Error('Network error during upload'));
    });

    xhr.open('POST', API_BASE + '/api/jobs/device');
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }
    xhr.send(formData);
  });
}

/**
 * Get authentication token from localStorage
 * @returns {string|null}
 */
export function getToken() {
  return localStorage.getItem('token');
}

/**
 * Save authentication token to localStorage
 * @param {string} token
 */
export function setToken(token) {
  localStorage.setItem('token', token);
}

/**
 * Remove authentication token from localStorage
 */
export function clearToken() {
  localStorage.removeItem('token');
}

/**
 * Check if user is authenticated
 * @returns {boolean}
 */
export function isAuthenticated() {
  return !!localStorage.getItem('token');
}
