// Browser notification system for job completion alerts

const NOTIF_PROMPTED_KEY = 'video-refresher.notif-prompted';
const NOTIF_ENABLED_KEY = 'video-refresher.notif-enabled';

/**
 * Check if notification API is supported
 * @returns {boolean}
 */
export function isNotificationSupported() {
  return 'Notification' in window;
}

/**
 * Request notification permission if not yet prompted
 * @returns {Promise<string>} - Permission state ('granted', 'denied', 'default')
 */
export async function requestPermissionIfNeeded() {
  if (!isNotificationSupported()) {
    return 'denied';
  }

  // Check if already prompted
  const hasPrompted = localStorage.getItem(NOTIF_PROMPTED_KEY);

  if (!hasPrompted) {
    // First time - request permission
    const permission = await Notification.requestPermission();

    // Mark as prompted
    localStorage.setItem(NOTIF_PROMPTED_KEY, 'true');

    // If granted, enable notifications by default
    if (permission === 'granted') {
      localStorage.setItem(NOTIF_ENABLED_KEY, 'true');
    }

    return permission;
  }

  // Already prompted - return current permission state
  return Notification.permission;
}

/**
 * Check if notifications are enabled
 * @returns {boolean}
 */
export function isNotificationsEnabled() {
  if (!isNotificationSupported()) {
    return false;
  }

  const enabled = localStorage.getItem(NOTIF_ENABLED_KEY) === 'true';
  const granted = Notification.permission === 'granted';

  return enabled && granted;
}

/**
 * Enable or disable notifications
 * @param {boolean} enabled - Whether to enable notifications
 * @returns {Promise<void>}
 */
export async function setNotificationsEnabled(enabled) {
  if (!isNotificationSupported()) {
    return;
  }

  if (enabled) {
    // Enabling - check if permission granted, request if not
    if (Notification.permission !== 'granted') {
      await Notification.requestPermission();
    }

    // Only set enabled if permission is granted
    if (Notification.permission === 'granted') {
      localStorage.setItem(NOTIF_ENABLED_KEY, 'true');
    }
  } else {
    // Disabling
    localStorage.setItem(NOTIF_ENABLED_KEY, 'false');
  }
}

/**
 * Fire a job completion notification
 * @param {string} jobId - Job ID
 */
export function fireJobCompleteNotification(jobId) {
  // Check if notifications enabled
  if (!isNotificationsEnabled()) {
    return;
  }

  // Don't notify if tab is visible (foreground)
  if (document.visibilityState === 'visible') {
    return;
  }

  // Create notification
  const notification = new Notification('Video Refresher: Your videos are ready to download', {
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    requireInteraction: false
  });

  // Click handler - focus window and close notification
  notification.addEventListener('click', () => {
    window.focus();
    notification.close();
  });

  // Auto-dismiss after 10 seconds
  setTimeout(() => {
    notification.close();
  }, 10000);
}
