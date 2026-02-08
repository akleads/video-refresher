// Shared utility functions

/**
 * Format bytes as human-readable string
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 10) / 10 + ' ' + sizes[i];
}

/**
 * Get time until ISO date (countdown string)
 * @param {string} isoDate - ISO date string
 * @returns {string} - 'expired', 'Xh', 'Xm', '<1m'
 */
export function timeUntil(isoDate) {
  // Append Z for UTC parsing if not present
  const dateStr = isoDate.endsWith('Z') ? isoDate : isoDate + 'Z';
  const target = new Date(dateStr);
  const now = new Date();
  const diff = target - now;

  if (diff <= 0) return 'expired';

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return '<1m';
}

/**
 * Get time ago from ISO date
 * @param {string} isoDate - ISO date string
 * @returns {string} - 'just now', 'Xm ago', 'Xh ago', 'Xd ago'
 */
export function timeAgo(isoDate) {
  const dateStr = isoDate.endsWith('Z') ? isoDate : isoDate + 'Z';
  const past = new Date(dateStr);
  const now = new Date();
  const diff = now - past;

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

/**
 * Shorthand for document.querySelector
 * @param {string} selector
 * @returns {Element|null}
 */
export function $(selector) {
  return document.querySelector(selector);
}

/**
 * Shorthand for document.querySelectorAll
 * @param {string} selector
 * @returns {NodeList}
 */
export function $$(selector) {
  return document.querySelectorAll(selector);
}
