// Hash-based SPA router with parameterized routes

import { isAuthenticated } from './api.js';

export class Router {
  constructor() {
    this.routes = new Map();
  }

  /**
   * Register a route pattern with a handler
   * @param {string} pattern - Route pattern (e.g., 'upload' or 'job/:id')
   * @param {function} handler - Handler function
   */
  add(pattern, handler) {
    this.routes.set(pattern, handler);
  }

  /**
   * Start the router (attach hashchange listener)
   */
  start() {
    window.addEventListener('hashchange', () => this.handleRoute());
    this.handleRoute(); // Handle initial route
  }

  /**
   * Navigate to a hash
   * @param {string} hash - Hash to navigate to (e.g., '#upload')
   */
  navigate(hash) {
    window.location.hash = hash;
  }

  /**
   * Handle the current route
   */
  handleRoute() {
    const hash = window.location.hash.slice(1); // Remove leading #
    const [path, queryString] = hash.split('?');
    const segments = path.split('/').filter(Boolean);

    // Parse query string
    const query = {};
    if (queryString) {
      queryString.split('&').forEach(pair => {
        const [key, value] = pair.split('=');
        query[decodeURIComponent(key)] = decodeURIComponent(value || '');
      });
    }

    // Find matching route
    for (const [pattern, handler] of this.routes) {
      const patternSegments = pattern.split('/').filter(Boolean);

      // Empty pattern matches empty hash
      if (pattern === '' && path === '') {
        handler({ query });
        return;
      }

      // Check if segments match
      if (patternSegments.length !== segments.length) {
        continue;
      }

      const params = { query };
      let match = true;

      for (let i = 0; i < patternSegments.length; i++) {
        if (patternSegments[i].startsWith(':')) {
          // Parameter segment
          const paramName = patternSegments[i].slice(1);
          params[paramName] = segments[i];
        } else if (patternSegments[i] !== segments[i]) {
          // Literal segment doesn't match
          match = false;
          break;
        }
      }

      if (match) {
        // Check if route requires authentication
        const requiresAuth = pattern !== '' && pattern !== 'login';

        if (requiresAuth && !isAuthenticated()) {
          window.location.hash = '#login';
          return;
        }

        handler(params);
        return;
      }
    }

    // No matching route - default to login
    window.location.hash = '#login';
  }
}
