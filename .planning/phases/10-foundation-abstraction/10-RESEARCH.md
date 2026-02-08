# Phase 10: Foundation & Abstraction - Research

**Researched:** 2026-02-07
**Domain:** Cross-origin isolation, isomorphic JavaScript, CORS/CORP headers
**Confidence:** HIGH

## Summary

Phase 10 restores browser-based FFmpeg.wasm support by re-enabling COOP/COEP headers on Cloudflare Pages, ensuring backend API compatibility with COEP via Cross-Origin-Resource-Policy headers, creating shared effect generation modules that work identically in browser and Node.js, and implementing browser capability detection for graceful fallback.

The technical foundation combines three domains: (1) Cross-origin isolation headers required for SharedArrayBuffer access, (2) Backend CORS configuration to work under strict COEP policies, and (3) Isomorphic JavaScript patterns to share deterministic effect generation logic across environments.

The standard approach is well-established: use Cloudflare Pages `_headers` file for COOP/COEP, add `Cross-Origin-Resource-Policy: cross-origin` to API responses via Express middleware, write pure ES modules for shared logic with seeded PRNGs for determinism, and check `window.crossOriginIsolated` for capability detection.

**Primary recommendation:** Use Cloudflare Pages `_headers` file for COOP/COEP (reverting v1.0 configuration), add Helmet or custom middleware to Express for CORP header, extract effects.js to a pure ES module using seedrandom for deterministic generation, and implement feature detection with `window.crossOriginIsolated` before FFmpeg.wasm initialization.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| N/A (Cloudflare Pages) | - | COOP/COEP headers | Built-in platform feature via `_headers` file |
| helmet | ^8.x | Express security headers | Industry standard for Express security headers, 18M+ weekly downloads |
| seedrandom | ^3.0.5 | Seeded PRNG | Most popular deterministic random for JavaScript, works in browser and Node.js |
| N/A (Browser API) | - | Cross-origin isolation detection | Standard web platform API: `window.crossOriginIsolated` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| cors | ^2.8.5 | Express CORS middleware | Already in use for API cross-origin access |
| @ffmpeg/ffmpeg | ^0.12.15 | Browser video processing | Client-side processing mode (requires SharedArrayBuffer) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| seedrandom | Custom PRNG (Mulberry32) | Hand-rolled PRNGs lack testing/validation; seedrandom is proven |
| Helmet | Manual header middleware | Helmet provides comprehensive defaults; manual approach more fragile |
| `_headers` file | Cloudflare Workers | Workers add complexity; `_headers` is simpler for static header rules |

**Installation:**
```bash
# Server dependencies (add to server/package.json)
npm install helmet
npm install seedrandom

# No browser installation needed - CDN for FFmpeg.wasm, inline seedrandom
```

## Architecture Patterns

### Recommended Project Structure
```
/
├── _headers                    # Cloudflare Pages COOP/COEP headers
├── lib/
│   ├── effects-shared.js       # Pure ES module: effect generation (isomorphic)
│   └── ...                     # Other frontend libs
├── server/
│   ├── lib/
│   │   ├── effects.js          # Server wrapper importing effects-shared.js
│   │   └── ...
│   ├── middleware/
│   │   ├── security.js         # Helmet config with CORP header
│   │   └── ...
│   └── index.js                # Express app
└── ...
```

### Pattern 1: Cloudflare Pages `_headers` File
**What:** Plain text file defining HTTP headers per URL pattern
**When to use:** Setting static headers on Cloudflare Pages deployments
**Example:**
```
# _headers file syntax
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
```
**Source:** [Cloudflare Pages Headers Documentation](https://developers.cloudflare.com/pages/configuration/headers/)

**Rules:**
- First line is URL pattern (`/*` matches all paths)
- Subsequent lines are indented header rules
- 2,000 character limit per line
- Up to 100 header rules total
- `/*` must be used to apply to all paths including root document

### Pattern 2: Express Middleware for CORP Header
**What:** Add `Cross-Origin-Resource-Policy: cross-origin` to API responses
**When to use:** When frontend uses COEP and backend is cross-origin
**Example (using Helmet):**
```javascript
// server/middleware/security.js
import helmet from 'helmet';

export function securityHeaders(app) {
  app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }
  }));
}
```
**Alternative (manual):**
```javascript
app.use((req, res, next) => {
  res.header('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
});
```
**Source:** [Helmet.js Documentation](https://helmetjs.github.io/), [MDN CORP Guide](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cross-Origin_Resource_Policy)

**Why this matters:**
- When frontend sets `Cross-Origin-Embedder-Policy: require-corp`, ALL cross-origin resources must opt-in
- Without CORP header, API responses will be blocked by browser
- `cross-origin` value explicitly permits any origin to load the resource

### Pattern 3: Isomorphic ES Module (Shared Logic)
**What:** Pure JavaScript module using only portable APIs, no environment-specific globals
**When to use:** Logic that must behave identically in browser and Node.js
**Example:**
```javascript
// lib/effects-shared.js
import seedrandom from 'seedrandom';

/**
 * Generate deterministic effect parameters from seed
 * Works identically in browser and Node.js
 * @param {string} seed - Random seed
 * @param {number} count - Number of effects to generate
 * @returns {Array} Effect parameter objects
 */
export function generateEffects(seed, count) {
  const rng = seedrandom(seed);
  const effects = [];

  for (let i = 0; i < count; i++) {
    effects.push({
      rotation: parseFloat((rng() * 0.009 + 0.001).toFixed(4)),
      brightness: parseFloat((rng() * 0.1 - 0.05).toFixed(4)),
      contrast: parseFloat((rng() * 0.1 + 0.95).toFixed(4)),
      saturation: parseFloat((rng() * 0.1 + 0.95).toFixed(4))
    });
  }

  return effects;
}

/**
 * Build FFmpeg filter string from effect params
 * @param {Object} effects - Effect parameters
 * @returns {string} FFmpeg filter string
 */
export function buildFilterString(effects) {
  return `rotate=${effects.rotation}:fillcolor=black@0,eq=brightness=${effects.brightness}:contrast=${effects.contrast}:saturation=${effects.saturation}`;
}
```
**Source:** [MDN JavaScript Modules Guide](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules)

**Key principles:**
- No `window`, `document`, `process`, or filesystem access
- Use only standard JavaScript (Math, Array, Object, etc.)
- Import environment-agnostic libraries (like seedrandom)
- Pure functions - same input produces same output
- ES module syntax (`import`/`export`) works in both environments

### Pattern 4: Browser Capability Detection
**What:** Check `window.crossOriginIsolated` before using SharedArrayBuffer features
**When to use:** Before initializing FFmpeg.wasm or any SharedArrayBuffer-dependent code
**Example:**
```javascript
// lib/ffmpeg-init.js or similar
export function canUseFFmpegWasm() {
  // Check if cross-origin isolated
  if (!window.crossOriginIsolated) {
    return false;
  }

  // Double-check SharedArrayBuffer availability
  if (typeof SharedArrayBuffer === 'undefined') {
    return false;
  }

  return true;
}

// Usage in app
if (canUseFFmpegWasm()) {
  // Initialize FFmpeg.wasm - client-side processing
  await initFFmpeg();
} else {
  // Fall back to server-side processing
  console.warn('SharedArrayBuffer unavailable, using server mode');
}
```
**Source:** [MDN crossOriginIsolated API](https://developer.mozilla.org/en-US/docs/Web/API/Window/crossOriginIsolated), [web.dev COOP/COEP Guide](https://web.dev/articles/coop-coep)

**What `crossOriginIsolated` checks:**
- Returns `true` if both COOP and COEP headers are correctly set
- Returns `false` if headers are missing or incorrect
- Reliable indicator before attempting SharedArrayBuffer operations

### Anti-Patterns to Avoid

- **Setting COOP/COEP on API responses:** These headers belong on the HTML document, not JSON API responses. Put them in frontend `_headers` file only.

- **Using `same-origin` or `same-site` for CORP on cross-origin APIs:** When your frontend (Cloudflare Pages) and backend (Fly.io) are different origins, the backend MUST use `Cross-Origin-Resource-Policy: cross-origin` or requests will be blocked.

- **Relying on Math.random() for shared logic:** Math.random() is not seeded, so browser and server will generate different "random" values. Always use seeded PRNG (seedrandom) for deterministic cross-environment generation.

- **Checking only `typeof SharedArrayBuffer !== 'undefined'`:** This check can pass even when cross-origin isolation failed. Always check `window.crossOriginIsolated` first.

- **Hand-rolling seeded random generators:** Use proven libraries like seedrandom. Custom PRNGs are error-prone and lack statistical validation.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Seeded random number generation | Custom PRNG algorithm (LCG, Mulberry32) | `seedrandom` library | Statistical quality, edge case handling, proven cross-platform behavior |
| Cross-origin isolation detection | Custom header/feature checks | `window.crossOriginIsolated` API | Browser-provided, reliable, future-proof |
| Security headers in Express | Manual res.header() for each security header | `helmet` middleware | Comprehensive defaults, maintained for security updates, handles 15+ headers |
| Deterministic effect generation | Separate browser/server implementations | Shared ES module with seedrandom | Guarantees identical results, single source of truth |

**Key insight:** Cross-origin isolation and CORS/CORP are complex security boundaries with many edge cases. Use platform features (`_headers` file), standard libraries (helmet), and Web APIs (`crossOriginIsolated`) rather than custom solutions.

## Common Pitfalls

### Pitfall 1: CORP Header Missing on Cross-Origin API
**What goes wrong:** Frontend with COEP: require-corp makes API requests to backend, all requests fail with CORS-like errors
**Why it happens:** COEP requires ALL cross-origin resources to opt-in with either CORS or CORP headers. Backend doesn't send CORP header by default.
**How to avoid:**
- Add `Cross-Origin-Resource-Policy: cross-origin` to all API responses
- Use Helmet middleware with `crossOriginResourcePolicy: { policy: "cross-origin" }`
- Test with browser DevTools Network tab - look for "Cross-Origin-Resource-Policy" header
**Warning signs:**
- Fetch errors in console mentioning "blocked by Cross-Origin-Embedder-Policy"
- Network tab shows requests blocked before completion
- Same API works when accessed directly but fails from app

### Pitfall 2: Testing Locally Without HTTPS
**What goes wrong:** COOP/COEP headers work in production but SharedArrayBuffer still unavailable in local dev
**Why it happens:** Some browsers require HTTPS context for SharedArrayBuffer even with COOP/COEP headers
**How to avoid:**
- Use `python3 -m http.server` for local dev (browser exempts localhost)
- Verify `window.crossOriginIsolated` returns true in browser console
- Test on deployed preview URL early
**Warning signs:**
- Headers appear correct in DevTools but `crossOriginIsolated` is false
- Works in production but not locally (or vice versa)

### Pitfall 3: _headers File Not in Build Output
**What goes wrong:** `_headers` file exists in repo but headers not applied in production
**Why it happens:** Cloudflare Pages only reads `_headers` from the build output directory, not source directory
**How to avoid:**
- For static sites: Put `_headers` at repo root (build output is root)
- For framework builds: Ensure `_headers` is copied to build output (public/ or dist/)
- Verify headers in production with `curl -I https://your-site.pages.dev`
**Warning signs:**
- `_headers` file exists but `curl` shows no COOP/COEP headers
- Works locally but not in production
- Cloudflare Pages build logs don't mention `_headers`

### Pitfall 4: Different Random Sequences Browser vs Server
**What goes wrong:** Same seed generates different effect variations in browser vs server, users see inconsistent results
**Why it happens:** Using different PRNG implementations or initialization order in browser vs server
**How to avoid:**
- Use single shared ES module imported by both environments
- Use same seedrandom version and algorithm in both
- Initialize PRNG with seed before generating effects, not at module load time
- Write tests comparing browser and Node.js output for same seeds
**Warning signs:**
- Effect previews differ from server-generated results
- "Same" variation looks different when reprocessed
- Seed parameter not producing consistent results

### Pitfall 5: CDN Resources Lacking CORP Headers
**What goes wrong:** External CDN resources (fonts, scripts) blocked when COEP enabled
**Why it happens:** Not all CDNs send Cross-Origin-Resource-Policy or CORS headers
**How to avoid:**
- Verify CDN resources send CORP header: `curl -I https://cdn.example.com/library.js`
- For FFmpeg.wasm: jsDelivr and unpkg send proper headers
- Use `crossorigin="anonymous"` attribute for CORS-enabled resources
- Self-host resources if CDN doesn't support CORP/CORS
**Warning signs:**
- Some external scripts fail to load after enabling COEP
- Console errors about blocked resources
- Resources work without COEP but fail with it enabled

## Code Examples

Verified patterns from official sources:

### COOP/COEP Headers on Cloudflare Pages
```
# _headers file at repository root
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
```
**Source:** [Cloudflare Pages Headers Docs](https://developers.cloudflare.com/pages/configuration/headers/), [web.dev COOP/COEP](https://web.dev/articles/coop-coep)

**What this does:**
- `/*` applies headers to all paths
- COOP: same-origin isolates page from other origins in same browsing context
- COEP: require-corp requires all cross-origin resources to opt-in via CORP or CORS

### Express Middleware for CORP Header
```javascript
// server/middleware/security.js
import helmet from 'helmet';

export function configureSecurityHeaders(app) {
  // Configure Helmet with CORP header for COEP compatibility
  app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }
  }));
}

// server/index.js
import { configureSecurityHeaders } from './middleware/security.js';
const app = express();

// Apply security headers before routes
configureSecurityHeaders(app);

// Existing CORS config remains
app.use(cors({
  origin: ['https://video-refresher.pages.dev', 'http://localhost:8000'],
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
```
**Source:** [Helmet.js Docs](https://helmetjs.github.io/), [MDN CORP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cross-Origin_Resource_Policy)

**Why Helmet over manual:**
- Handles multiple security headers automatically
- Maintained for new security best practices
- Less error-prone than manual header setting

### Shared Effect Generation Module
```javascript
// lib/effects-shared.js
import seedrandom from 'seedrandom';

/**
 * Generate deterministic random value in range
 * @param {Function} rng - Seeded random function from seedrandom
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @returns {number}
 */
function randomInRange(rng, min, max) {
  return min + rng() * (max - min);
}

/**
 * Generate unique random effects with seed
 * Produces identical results in browser and Node.js given same seed
 * @param {string} seed - Random seed (e.g., job ID)
 * @param {number} count - Number of unique effects to generate
 * @returns {Array<{rotation: number, brightness: number, contrast: number, saturation: number}>}
 */
export function generateUniqueEffects(seed, count) {
  const rng = seedrandom(seed);
  const effects = [];
  const seen = new Set();
  const maxAttempts = count * 100;
  let attempts = 0;

  while (effects.length < count && attempts < maxAttempts) {
    attempts++;

    const effect = {
      rotation: parseFloat(randomInRange(rng, 0.001, 0.01).toFixed(4)),
      brightness: parseFloat(randomInRange(rng, -0.05, 0.05).toFixed(4)),
      contrast: parseFloat(randomInRange(rng, 0.95, 1.05).toFixed(4)),
      saturation: parseFloat(randomInRange(rng, 0.95, 1.05).toFixed(4))
    };

    const key = JSON.stringify(effect);
    if (!seen.has(key)) {
      seen.add(key);
      effects.push(effect);
    }
  }

  if (effects.length < count) {
    throw new Error(`Unable to generate ${count} unique effects after ${maxAttempts} attempts`);
  }

  return effects;
}

/**
 * Build FFmpeg filter string from effect object
 * @param {Object} effects - Effect object with rotation, brightness, contrast, saturation
 * @returns {string} FFmpeg filter string
 */
export function buildFilterString(effects) {
  return `rotate=${effects.rotation}:fillcolor=black@0,eq=brightness=${effects.brightness}:contrast=${effects.contrast}:saturation=${effects.saturation}`;
}
```

```javascript
// server/lib/effects.js (server wrapper)
import { generateUniqueEffects, buildFilterString } from '../../lib/effects-shared.js';

// Re-export for backward compatibility
export { generateUniqueEffects, buildFilterString };
```

```javascript
// lib/client-effects.js (browser usage)
import { generateUniqueEffects, buildFilterString } from './effects-shared.js';

// Browser can import and use directly
const effects = generateUniqueEffects('seed-123', 10);
```
**Source:** [MDN JavaScript Modules](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules), [seedrandom GitHub](https://github.com/davidbau/seedrandom)

**Key points:**
- Pure ES module - no Node.js or browser-specific APIs
- Same import path works in browser (relative) and Node.js (with package.json type: module)
- seedrandom works identically in both environments
- Server imports shared module, maintains backward compatibility

### Browser Capability Detection
```javascript
// lib/capability-detection.js
/**
 * Check if browser supports client-side FFmpeg.wasm processing
 * Requires both cross-origin isolation and SharedArrayBuffer
 * @returns {boolean} True if client-side processing available
 */
export function supportsClientProcessing() {
  // Check cross-origin isolation (COOP + COEP headers working)
  if (!window.crossOriginIsolated) {
    console.warn('Cross-origin isolation not enabled (COOP/COEP headers missing or incorrect)');
    return false;
  }

  // Double-check SharedArrayBuffer availability
  if (typeof SharedArrayBuffer === 'undefined') {
    console.warn('SharedArrayBuffer not available despite cross-origin isolation');
    return false;
  }

  return true;
}

/**
 * Get processing mode based on browser capabilities
 * @returns {'client'|'server'} Processing mode to use
 */
export function getProcessingMode() {
  return supportsClientProcessing() ? 'client' : 'server';
}
```

```javascript
// app.js or view initialization
import { supportsClientProcessing, getProcessingMode } from './lib/capability-detection.js';

document.addEventListener('DOMContentLoaded', () => {
  const mode = getProcessingMode();
  console.log(`Processing mode: ${mode}`);

  // Show mode indicator to user
  const modeIndicator = document.getElementById('processing-mode');
  if (modeIndicator) {
    modeIndicator.textContent = mode === 'client'
      ? 'Processing on your device'
      : 'Processing on server';
  }

  // Initialize appropriate processing path
  if (mode === 'client') {
    // Load FFmpeg.wasm dynamically only when supported
    import('./lib/ffmpeg-client.js').then(module => {
      module.initFFmpeg();
    });
  }
});
```
**Source:** [MDN crossOriginIsolated](https://developer.mozilla.org/en-US/docs/Web/API/Window/crossOriginIsolated), [web.dev Cross-Origin Isolation Guide](https://web.dev/articles/cross-origin-isolation-guide)

**Why both checks:**
- `crossOriginIsolated` is the canonical way to detect COOP+COEP success
- `SharedArrayBuffer` check catches edge cases or old browsers
- Informative console warnings help debugging
- Return string mode ('client'/'server') makes UI decisions cleaner

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| COEP: require-corp only | COEP: credentialless available | Chrome 96 (2021) | Easier to enable - no CORP needed for no-credentials requests |
| CDN not feasible for FFmpeg.wasm | jsDelivr/unpkg support CORP headers | ~2023 | Can use CDN instead of self-hosting |
| CommonJS modules for isomorphic code | ES modules native in Node.js | Node.js 13.2.0 (2019), stable 2021 | Simpler isomorphic patterns, no transpilation needed |
| Math.seedrandom global pollution | seedrandom v3.0+ scoped instances | seedrandom 3.0.0 (2018) | Cleaner imports, no global namespace pollution |

**Deprecated/outdated:**
- **COEP: require-corp as only option:** `COEP: credentialless` is now available as a less restrictive alternative (doesn't require CORP for resources loaded without credentials)
- **coi-serviceworker polyfill:** Service worker workaround for COOP/COEP no longer needed if hosting supports headers directly (Cloudflare Pages supports `_headers` file)
- **CommonJS modules for shared code:** ES modules are now standard in Node.js and browsers; no need for dual-format publishing for internal code

## Open Questions

Things that couldn't be fully resolved:

1. **Does Cloudflare Pages support COEP: credentialless?**
   - What we know: `_headers` file supports custom headers, COEP: credentialless is less restrictive than require-corp
   - What's unclear: Whether credentialless works with FFmpeg.wasm (may still need require-corp for SharedArrayBuffer)
   - Recommendation: Start with COEP: require-corp (proven to work), test credentialless as optimization in later phase if desired

2. **Should seedrandom be bundled or CDN-loaded in browser?**
   - What we know: npm version is 3.0.5, CDN available via jsDelivr/unpkg, library is small (~5KB)
   - What's unclear: Best practice for this specific project's build setup (no build step currently)
   - Recommendation: Load from jsDelivr CDN with SRI hash for browser, npm install for server (jsDelivr sends proper CORP headers)

3. **Performance impact of seeded PRNG vs Math.random()?**
   - What we know: seedrandom is "fast" per docs, generating 10 effect sets should be negligible
   - What's unclear: Exact performance difference in practice for this use case
   - Recommendation: Implement with seedrandom; if performance issues arise, can optimize later (unlikely given small scale)

## Sources

### Primary (HIGH confidence)
- [MDN: Cross-Origin-Embedder-Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Embedder-Policy) - COEP header specification
- [MDN: Cross-Origin-Resource-Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cross-Origin_Resource_Policy) - CORP header guide
- [MDN: Window.crossOriginIsolated](https://developer.mozilla.org/en-US/docs/Web/API/Window/crossOriginIsolated) - Browser API for detection
- [MDN: JavaScript Modules](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules) - Isomorphic module patterns
- [Cloudflare Pages: Headers Configuration](https://developers.cloudflare.com/pages/configuration/headers/) - `_headers` file syntax
- [web.dev: Making your website cross-origin isolated](https://web.dev/articles/coop-coep) - COOP/COEP setup guide
- [Helmet.js Documentation](https://helmetjs.github.io/) - Express security headers middleware
- [GitHub: seedrandom](https://github.com/davidbau/seedrandom) - Seeded PRNG library

### Secondary (MEDIUM confidence)
- [jsDelivr: @ffmpeg/ffmpeg CDN](https://www.jsdelivr.com/package/npm/@ffmpeg/ffmpeg) - FFmpeg.wasm CDN availability
- [npm: seedrandom](https://www.npmjs.com/package/seedrandom) - Package version and usage
- [FFmpeg.wasm: Installation Docs](https://ffmpegwasm.netlify.app/docs/getting-started/installation/) - FFmpeg.wasm setup
- [web.dev: Cross-Origin Isolation Guide](https://web.dev/articles/cross-origin-isolation-guide) - Browser capability patterns
- Community forums (Cloudflare Community, GitHub Issues) - Real-world COOP/COEP implementation examples

### Tertiary (LOW confidence)
- Various blog posts about FFmpeg.wasm and COOP/COEP setup - Useful for context but not authoritative

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All recommendations based on official documentation and established libraries
- Architecture: HIGH - Patterns verified against MDN, Cloudflare docs, and library documentation
- Pitfalls: MEDIUM-HIGH - Based on WebSearch findings cross-referenced with official docs; common issues well-documented

**Research date:** 2026-02-07
**Valid until:** 2026-04-07 (60 days - stable domain with mature specs)

**Notes:**
- COOP/COEP/CORP are stable W3C standards, low churn expected
- Cloudflare Pages `_headers` syntax is platform-specific but stable
- seedrandom library is mature (v3.0 since 2018), minimal API changes expected
- ES modules are now standard in all environments, syntax stable
