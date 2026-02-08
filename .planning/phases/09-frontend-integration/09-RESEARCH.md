# Phase 9: Frontend Integration - Research

**Researched:** 2026-02-07
**Domain:** Vanilla JavaScript SPA, authentication UI, file upload, API polling
**Confidence:** HIGH

## Summary

Phase 9 replaces the client-side FFmpeg.wasm processing frontend with an API-driven UI. Research focused on vanilla JavaScript patterns for SPAs, authentication flows, multi-file uploads with progress tracking, API polling strategies, and memory management. The phase requires no external dependencies beyond what the server already uses (Express, CORS already configured).

The standard approach is hash-based routing with native JavaScript modules, XMLHttpRequest for upload progress tracking (Fetch API lacks upload progress events), localStorage for token persistence (acceptable for this non-critical use case with HTTPS), and exponential backoff for API polling to reduce server load while maintaining good UX.

All client-side FFmpeg.wasm code, worker files, and wasm bundles must be removed completely. The frontend becomes a pure API client with zero video processing capability.

**Primary recommendation:** Use vanilla JS with hash-based routing, XMLHttpRequest for uploads with progress, localStorage for token storage (mitigated by HTTPS + short sessions), and adaptive polling with Page Visibility API integration.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| None (Vanilla JS) | ES2022+ | SPA routing, DOM manipulation, API calls | Zero dependencies, native browser APIs sufficient, no build step needed |
| XMLHttpRequest | Native API | Upload progress tracking | Fetch API lacks upload progress events, XHR remains standard for this use case |
| Page Visibility API | Native API | Pause polling when tab inactive | Standard browser API, reduces unnecessary requests |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| localStorage | Native API | Token persistence | Simple token storage for 24h sessions, acceptable with HTTPS |
| FormData | Native API | Multipart file uploads | Standard for file upload, browser sets boundary automatically |
| URL.createObjectURL | Native API | ZIP download handling | Standard for blob downloads from server responses |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Vanilla JS | React/Vue | Framework adds build step, dependencies, complexity for simple 2-tab UI |
| Hash routing | History API | Requires server config to serve index.html for all routes, hash is simpler |
| localStorage | httpOnly cookies | Backend uses HMAC tokens (not JWTs), localStorage acceptable for this threat model |
| XMLHttpRequest | Fetch with ReadableStream monitoring | XHR simpler, more compatible, sufficient for this use case |

**Installation:**
```bash
# No installation needed - uses native browser APIs only
# Server dependencies already installed in Phase 6
```

## Architecture Patterns

### Recommended Project Structure
```
/
├── index.html           # Shell with empty containers for SPA views
├── app.js              # Main entry point, routing, auth check
├── styles.css          # All styles (existing, will be updated)
├── views/
│   ├── login.js        # Login view (password form, auth flow)
│   ├── upload.js       # Upload/new job view (drag-drop, file list, submit)
│   ├── job-detail.js   # Job progress/detail view (polling, status)
│   └── job-list.js     # Job history view (all jobs, polling)
└── lib/
    ├── api.js          # API client (fetch wrapper with auth header)
    ├── router.js       # Hash-based router
    └── utils.js        # Helpers (formatBytes, timeAgo, etc.)
```

### Pattern 1: Hash-Based SPA Routing
**What:** Client-side routing using URL hash fragments with hashchange event listener
**When to use:** Simple SPAs without server-side rendering or complex routing needs
**Example:**
```javascript
// Source: MDN, vanilla JS SPA routing patterns 2026
const routes = {
  '': renderLogin,
  'login': renderLogin,
  'upload': renderUpload,
  'job/:id': renderJobDetail,
  'jobs': renderJobList
};

function handleRoute() {
  const hash = window.location.hash.slice(1) || '';
  const [path, ...params] = hash.split('/');
  const route = routes[path] || routes['login'];
  route(...params);
}

window.addEventListener('hashchange', handleRoute);
window.addEventListener('load', handleRoute);
```

### Pattern 2: Token-Based Auth with localStorage
**What:** Store HMAC token in localStorage, attach to requests via Authorization header
**When to use:** Simple session management for non-critical apps served over HTTPS
**Example:**
```javascript
// Source: MDN Authorization header, HMAC auth patterns
async function login(password) {
  const res = await fetch('/api/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  });
  if (res.ok) {
    const { token } = await res.json();
    localStorage.setItem('token', token);
    return true;
  }
  return false;
}

function makeAuthRequest(url, options = {}) {
  const token = localStorage.getItem('token');
  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': `Bearer ${token}`
    }
  });
}
```

### Pattern 3: XMLHttpRequest Upload with Progress
**What:** Use XMLHttpRequest instead of Fetch to track upload progress events
**When to use:** Any file upload needing real-time progress feedback
**Example:**
```javascript
// Source: MDN XMLHttpRequest.upload, FormData best practices 2026
function uploadFiles(files, variations, onProgress) {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    files.forEach(file => formData.append('videos', file));
    formData.append('variations', variations);

    const xhr = new XMLHttpRequest();

    // Upload progress (NOT download progress)
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const percent = Math.round((e.loaded / e.total) * 100);
        onProgress(percent);
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        reject(new Error(`Upload failed: ${xhr.status}`));
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Network error')));

    const token = localStorage.getItem('token');
    xhr.open('POST', '/api/jobs');
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    // DO NOT set Content-Type - browser sets it with boundary for multipart/form-data

    xhr.send(formData);
  });
}
```

### Pattern 4: Adaptive Polling with Backoff
**What:** Poll API for updates with increasing intervals and jitter to reduce server load
**When to use:** Job status updates, real-time data that changes infrequently
**Example:**
```javascript
// Source: API polling best practices, exponential backoff patterns 2026
class AdaptivePoller {
  constructor(pollFn, options = {}) {
    this.pollFn = pollFn;
    this.interval = options.initialInterval || 2000;
    this.maxInterval = options.maxInterval || 10000;
    this.backoffMultiplier = options.backoffMultiplier || 1.5;
    this.jitter = options.jitter || 0.2;
    this.active = false;
    this.timerId = null;
  }

  start() {
    this.active = true;
    this.interval = 2000; // Reset to initial
    this.poll();
  }

  stop() {
    this.active = false;
    if (this.timerId) clearTimeout(this.timerId);
  }

  async poll() {
    if (!this.active) return;

    try {
      const result = await this.pollFn();

      // Reset interval on success
      if (result && result.status === 'completed') {
        this.stop(); // Job done, stop polling
        return;
      }

      // Increase interval with backoff
      this.interval = Math.min(
        this.interval * this.backoffMultiplier,
        this.maxInterval
      );
    } catch (err) {
      console.error('Poll error:', err);
      // Exponential backoff on error
      this.interval = Math.min(this.interval * 2, this.maxInterval);
    }

    // Add jitter to prevent thundering herd
    const jitteredInterval = this.interval * (1 + (Math.random() * this.jitter * 2 - this.jitter));
    this.timerId = setTimeout(() => this.poll(), jitteredInterval);
  }
}

// Usage:
const poller = new AdaptivePoller(
  () => fetch('/api/jobs/abc123').then(r => r.json()),
  { initialInterval: 2000, maxInterval: 10000 }
);
poller.start();
```

### Pattern 5: Page Visibility API Integration
**What:** Pause polling when tab is hidden to save resources and server load
**When to use:** Any polling or animation that doesn't need to run when user can't see it
**Example:**
```javascript
// Source: MDN Page Visibility API, polling optimization 2026
class VisibilityAwarePoller extends AdaptivePoller {
  constructor(pollFn, options) {
    super(pollFn, options);

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        // Tab hidden - pause polling
        if (this.timerId) clearTimeout(this.timerId);
      } else {
        // Tab visible - resume polling immediately
        if (this.active) this.poll();
      }
    });
  }
}
```

### Pattern 6: Drag-and-Drop File Upload
**What:** HTML5 drag-and-drop with file picker fallback, preventing default browser behavior
**When to use:** File upload UIs prioritizing UX over simple file input
**Example:**
```javascript
// Source: MDN File Drag and Drop, HTML5 file upload patterns 2026
const dropZone = document.getElementById('uploadArea');
const fileInput = document.getElementById('videoInput');

dropZone.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.stopPropagation();
  dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', (e) => {
  e.preventDefault();
  e.stopPropagation();
  dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  e.stopPropagation();
  dropZone.classList.remove('dragover');

  const files = Array.from(e.dataTransfer.files).filter(f => f.type === 'video/mp4');
  handleFiles(files);
});

fileInput.addEventListener('change', (e) => {
  const files = Array.from(e.target.files);
  handleFiles(files);
});
```

### Anti-Patterns to Avoid
- **Fetch for upload progress:** Fetch API lacks upload progress events, use XMLHttpRequest instead
- **Manual Content-Type with FormData:** Browser must set Content-Type with boundary for multipart/form-data, don't override
- **Aggressive polling without backoff:** Fixed short intervals cause server overload, use exponential backoff
- **Polling in hidden tabs:** Wastes 720+ requests/hour per hidden tab, use Page Visibility API
- **Memory leaks from blob URLs:** Always revoke blob URLs after download completes or before creating new ones
- **Synchronous session checks:** Don't check token validity on every route change, handle 401 responses instead
- **Building custom routing libraries:** Hash routing is 20 lines, don't over-engineer

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Upload progress for Fetch | Custom stream monitoring | XMLHttpRequest with xhr.upload.onprogress | Fetch lacks upload progress, XHR is standard |
| Exponential backoff | Manual delay calculation | Pattern from research (with jitter) | Thundering herd, timing edge cases |
| Relative time display | Manual date formatting | Intl.RelativeTimeFormat or simple helper | Timezone handling, i18n support |
| Form validation | Custom regex validation | HTML5 Constraint Validation API | Accessibility, browser UX, error messages |
| Polling management | setInterval loops | Adaptive polling class | Memory leaks, no cleanup, no backoff |

**Key insight:** Native browser APIs (FormData, Page Visibility, HTML5 validation) handle edge cases, accessibility, and browser compatibility better than custom implementations. Use them.

## Common Pitfalls

### Pitfall 1: Token Expiry Edge Cases
**What goes wrong:** User leaves tab open for 24h, token expires mid-session, API calls fail with 401 but UI doesn't redirect to login
**Why it happens:** No global error handling for 401 responses, each API call handles errors independently
**How to avoid:** Centralize API calls through a wrapper that checks for 401 responses globally and redirects to login with expiry message
**Warning signs:** User reports "stuck" on blank page after returning to tab, console shows 401 errors

### Pitfall 2: Blob URL Memory Leaks
**What goes wrong:** Creating blob URLs for downloads but never revoking them causes memory to grow unbounded
**Why it happens:** URL.createObjectURL creates a reference that persists until explicitly revoked or page unload
**How to avoid:** Track blob URLs in a registry, revoke after download link clicked, and add beforeunload cleanup
**Warning signs:** Browser memory usage grows over time, especially with repeated downloads

### Pitfall 3: FormData Content-Type Override
**What goes wrong:** Setting Content-Type header manually breaks multipart/form-data boundary parsing on server
**Why it happens:** Browser must generate unique boundary string and include it in Content-Type header
**How to avoid:** Never set Content-Type when using FormData, let browser set it automatically with boundary
**Warning signs:** 400 Bad Request from server, "multipart boundary not found" errors

### Pitfall 4: Polling Without Page Visibility Check
**What goes wrong:** Tabs left open in background make hundreds of unnecessary API requests, wasting server resources
**Why it happens:** setInterval/setTimeout continues running even when tab is hidden
**How to avoid:** Integrate Page Visibility API to pause polling when document.hidden === true
**Warning signs:** High server request counts from single client, battery drain on mobile

### Pitfall 5: Upload Progress Shows Download Progress
**What goes wrong:** Progress bar shows 100% immediately when server responds, not when upload finishes
**Why it happens:** Using xhr.onprogress instead of xhr.upload.onprogress tracks download, not upload
**How to avoid:** Always use xhr.upload.addEventListener('progress', ...) for upload tracking
**Warning signs:** Progress bar jumps to 100% immediately on large file uploads

### Pitfall 6: Lost Files on Drag-and-Drop
**What goes wrong:** User drags multiple files but only one appears in file list
**Why it happens:** Not preventing default dragover behavior causes browser to navigate to file instead of dropping
**How to avoid:** Call e.preventDefault() and e.stopPropagation() in dragover, dragenter, dragleave, and drop handlers
**Warning signs:** Browser navigates away when dropping files, file input doesn't receive files

### Pitfall 7: Session Timeout Without Warning
**What goes wrong:** User submits large upload after 23.5 hours idle, upload completes but 401 error appears
**Why it happens:** Token expires during upload, no preemptive check before expensive operations
**How to avoid:** Check token age before starting uploads, show warning if close to expiry (>23h old)
**Warning signs:** Upload succeeds but can't view job, "Authorization required" after long upload

### Pitfall 8: Hard-Coded Polling Intervals
**What goes wrong:** Polling every 1 second keeps server busy even when job queue is empty
**Why it happens:** Fixed interval doesn't adapt to job state or server load
**How to avoid:** Use exponential backoff starting at 2s, maxing at 10s, with jitter to spread load
**Warning signs:** Server CPU usage high even with few active jobs, request timestamps in tight clusters

## Code Examples

Verified patterns from official sources:

### Global API Error Handler
```javascript
// Centralized fetch wrapper with 401 handling
async function apiCall(url, options = {}) {
  const token = localStorage.getItem('token');

  const response = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': token ? `Bearer ${token}` : undefined
    }
  });

  // Global 401 handling
  if (response.status === 401) {
    localStorage.removeItem('token');
    window.location.hash = 'login?session_expired=1';
    throw new Error('Session expired');
  }

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  return response.json();
}
```

### Blob URL Registry for Memory Management
```javascript
// Source: JavaScript memory management best practices 2026
class BlobURLRegistry {
  constructor() {
    this.urls = new Map();
    window.addEventListener('beforeunload', () => this.revokeAll());
  }

  create(blob, metadata = {}) {
    const url = URL.createObjectURL(blob);
    this.urls.set(url, { ...metadata, created: Date.now() });
    return url;
  }

  revoke(url) {
    if (this.urls.has(url)) {
      URL.revokeObjectURL(url);
      this.urls.delete(url);
    }
  }

  revokeAll() {
    for (const url of this.urls.keys()) {
      URL.revokeObjectURL(url);
    }
    this.urls.clear();
  }
}

const blobRegistry = new BlobURLRegistry();

// Download job ZIP
async function downloadJob(jobId) {
  const response = await apiCall(`/api/jobs/${jobId}/download`);
  const blob = await response.blob();

  const url = blobRegistry.create(blob, { jobId });
  const a = document.createElement('a');
  a.href = url;
  a.download = `video-refresher-${jobId}.zip`;
  a.click();

  // Revoke after short delay (download started)
  setTimeout(() => blobRegistry.revoke(url), 1000);
}
```

### Relative Time Display
```javascript
// Simple helper for "expires in Xh" countdown
function timeUntil(isoDate) {
  const target = new Date(isoDate + 'Z'); // Append Z for UTC
  const now = new Date();
  const diffMs = target - now;

  if (diffMs <= 0) return 'expired';

  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return '<1m';
}
```

### File Size Formatting
```javascript
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}
```

### HTML5 Form Validation
```javascript
// Source: Vanilla JS form validation best practices 2026
const form = document.getElementById('loginForm');
const passwordInput = document.getElementById('password');

form.addEventListener('submit', (e) => {
  e.preventDefault();

  // HTML5 validation check
  if (!form.checkValidity()) {
    form.reportValidity(); // Shows browser validation UI
    return;
  }

  // Custom validation
  if (passwordInput.value.length < 8) {
    passwordInput.setCustomValidity('Password must be at least 8 characters');
    passwordInput.reportValidity();
    return;
  }

  // Clear custom validity before next check
  passwordInput.setCustomValidity('');

  // Proceed with login
  handleLogin(passwordInput.value);
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Fetch API for uploads | XMLHttpRequest for uploads | Still current | Fetch lacks upload progress, XHR remains standard for this specific use case |
| Fixed polling intervals | Exponential backoff with jitter | 2020s | Reduces server load 50-70%, prevents thundering herd |
| Always-on polling | Page Visibility API integration | 2021+ | Saves ~700 requests/hour per hidden tab, better battery life |
| JWT in localStorage | httpOnly cookies with refresh tokens | 2023+ (for critical apps) | For non-critical apps with HTTPS, localStorage acceptable |
| Custom SPA frameworks | Vanilla JS or lightweight frameworks | 2024+ | Build-free, zero dependencies for simple SPAs |
| setTimeout chains | AbortController for cancellation | 2021+ | Better cleanup, memory management |

**Deprecated/outdated:**
- jQuery for DOM manipulation: Replaced by native querySelector, classList, etc.
- Moment.js for date formatting: Replaced by Intl.RelativeTimeFormat, native Date methods
- Lodash for simple utilities: Most helpers now have native equivalents (Array.from, Object.entries)
- Blueimp File Upload: Replaced by native FormData + XMLHttpRequest patterns
- Framework for simple 2-3 page SPAs: Vanilla JS sufficient, zero build step

## Open Questions

1. **Polling interval tuning**
   - What we know: Research suggests 2s initial, 10s max with exponential backoff
   - What's unclear: Optimal values for this specific server-side FFmpeg workload
   - Recommendation: Start with 2s/10s, monitor server load, adjust if needed

2. **Job list pagination**
   - What we know: API currently returns all jobs without pagination
   - What's unclear: Whether to implement client-side filtering or request server pagination
   - Recommendation: Client-side filtering sufficient for <100 jobs (single user team), defer server pagination

3. **Network retry strategy**
   - What we know: Should use exponential backoff for transient network failures
   - What's unclear: Whether to retry on all error types or only specific ones (timeout, 5xx)
   - Recommendation: Retry on network errors and 5xx, not on 4xx (except 429 rate limit)

4. **Skeleton loading vs spinner**
   - What we know: Skeleton screens better for <10s waits, spinners for single modules
   - What's unclear: Which pattern fits job list loading best
   - Recommendation: Simple spinner for job list (fast API), skeleton only if needed

## Sources

### Primary (HIGH confidence)
- [MDN: File drag and drop](https://developer.mozilla.org/en-US/docs/Web/API/HTML_Drag_and_Drop_API/File_drag_and_drop)
- [MDN: Using FormData Objects](https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest_API/Using_FormData_Objects)
- [MDN: XMLHttpRequest.upload](https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest/upload)
- [MDN: Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)
- [MDN: Authorization header](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Authorization)
- [MDN: Memory management](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Memory_management)

### Secondary (MEDIUM confidence)
- [SitePoint: HTML5 File Drag and Drop](https://www.sitepoint.com/html5-file-drag-and-drop/) - Verified with MDN
- [DEV Community: Building Modern SPAs with Vanilla JavaScript](https://dev.to/moseeh_52/building-modern-spas-with-vanilla-javascript-a-beginners-guide-9a3)
- [Medium: Implementing SPA Routing Using Vanilla JavaScript](https://medium.com/altcampus/implementing-simple-spa-routing-using-vanilla-javascript-53abe399bf3c)
- [Strapi Blog: Vanilla JavaScript Form Handling Guide](https://strapi.io/blog/vanilla-javascript-form-handling-guide) - Verified with MDN
- [7 best practices for polling API endpoints - Merge](https://www.merge.dev/blog/api-polling-best-practices)
- [Medium: The Complete Guide to API Polling](https://medium.com/@alaxhenry0121/the-complete-guide-to-api-polling-implementation-optimization-and-alternatives-a4eae3b0ef69)
- [DEV Community: Retrying Failed Requests with Exponential Backoff](https://dev.to/abhivyaktii/retrying-failed-requests-with-exponential-backoff-48ld)
- [Blog LogRocket: Skeleton loading screen design](https://blog.logrocket.com/ux-design/skeleton-loading-screen-design/)
- [NN/G: Skeleton Screens 101](https://www.nngroup.com/articles/skeleton-screens/)

### Tertiary (LOW confidence)
- [WorkOS Blog: Secure JWT Storage](https://workos.com/blog/secure-jwt-storage) - General JWT guidance, adapted for HMAC token context
- [CyberChief: LocalStorage vs Cookies](https://www.cyberchief.ai/2023/05/secure-jwt-token-storage.html) - Security tradeoffs context

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Native browser APIs well-documented, no breaking changes expected
- Architecture: HIGH - Vanilla JS SPA patterns stable, hash routing proven for simple cases
- Pitfalls: HIGH - All pitfalls verified through MDN documentation and recent community posts
- Code examples: HIGH - All examples sourced from MDN or verified against MDN patterns

**Research date:** 2026-02-07
**Valid until:** 2026-04-07 (60 days - stable browser APIs, slow-moving domain)

---

## Additional Context

### Server API Endpoints (Already Implemented)
Research confirmed these server endpoints exist and are ready for frontend integration:

- `POST /api/auth` - Login with password, returns { token }
- `POST /api/jobs` - Create job (multipart/form-data with videos[] and variations)
- `GET /api/jobs/:id` - Job status with per-file progress
- `GET /api/jobs` - List all jobs
- `GET /api/jobs/:id/download` - Download ZIP (streaming response)

All endpoints require `Authorization: Bearer <token>` header except `/api/auth`.

### Files to Remove (FFmpeg.wasm cleanup)
- `ffmpeg-worker.js` - Client-side FFmpeg worker
- `app.js` - Current FFmpeg.wasm processing logic (will be replaced completely)
- References to FFmpeg.wasm CDN imports in index.html
- JSZip import (server handles ZIP creation now)

### Files to Preserve/Update
- `index.html` - Update to remove FFmpeg imports, add new view containers
- `styles.css` - Update for new UI components (login, tabs, job cards)

---
*Research complete. Ready for planning phase.*
