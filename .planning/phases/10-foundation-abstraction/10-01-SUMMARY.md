---
phase: 10-foundation-abstraction
plan: 01
subsystem: backend-api
tags: [security, cors, corp, effects, isomorphic, prng, seedrandom]
requires:
  - 09-v2-cleanup
provides:
  - CORP headers on all API responses
  - Shared isomorphic effects module
  - Deterministic effect generation
affects:
  - 10-02 # Frontend will consume shared effects module
  - 11-* # SharedArrayBuffer support enabled by CORP header
tech-stack:
  added:
    - seedrandom@3.0.5
  patterns:
    - Cross-Origin-Resource-Policy headers for COEP compatibility
    - Isomorphic ES modules (browser + Node.js)
    - Seeded PRNG for deterministic generation
key-files:
  created:
    - server/middleware/security.js
    - lib/effects-shared.js
  modified:
    - server/index.js
    - server/lib/effects.js
    - server/package.json
    - package.json
decisions:
  - id: CORP-header-simple
    what: Use simple middleware instead of helmet for CORP header
    why: Single header requirement, no need for full security suite
    impact: Lightweight, explicit, no dependency on helmet updates
  - id: effects-rng-parameter
    what: Shared effects module takes RNG function as parameter
    why: Isomorphic - browser uses Math.random, server uses seedrandom
    impact: Single source of truth, no environment-specific code
metrics:
  duration: 9 minutes
  completed: 2026-02-08
---

# Phase 10 Plan 01: CORP Headers & Shared Effects Summary

**One-liner:** Added Cross-Origin-Resource-Policy header middleware and extracted effect generation into isomorphic shared module with seedrandom for deterministic variation generation.

## What Was Built

### 1. CORP Header Middleware
- Created `server/middleware/security.js` with simple header-setting middleware
- Applied before CORS middleware in `server/index.js`
- All API responses now include `Cross-Origin-Resource-Policy: cross-origin`
- **Purpose:** Required before frontend COEP can be enabled (Phase 11)

### 2. Shared Effects Module
- Created `lib/effects-shared.js` as pure ES module (isomorphic)
- Takes RNG function as parameter (environment-agnostic)
- Exports `generateUniqueEffects(rng, count)` and `buildFilterString(effects)`
- No browser or Node-specific code - runs anywhere

### 3. Server Effects Wrapper
- Rewrote `server/lib/effects.js` to delegate to shared module
- Installed seedrandom for deterministic PRNG
- **Backward compatible:** `generateUniqueEffects(count)` still works (random seed)
- **New capability:** `generateUniqueEffects(count, seed)` for deterministic output

## Implementation Notes

### CORP Header Approach
Initially attempted to use helmet package for security headers, but discovered it was unnecessary overhead for a single header requirement. Switched to simple custom middleware:

```javascript
export function securityHeaders() {
  return function(req, res, next) {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
  };
}
```

This is:
- Explicit and clear
- No external dependencies beyond Express
- Easy to extend if more headers needed later

### Shared Module Pattern
The shared module achieves isomorphism by accepting an RNG function:

```javascript
// Server (with seed)
import seedrandom from 'seedrandom';
const rng = seedrandom('seed-123');
const effects = generateUniqueEffects(rng, 5);

// Browser (random)
const effects = generateUniqueEffects(Math.random, 5);
```

This pattern:
- No conditional imports (if browser/if Node)
- Single source of truth for effect generation
- Testable with controlled RNG

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added ES module type to root package.json**
- **Found during:** Task 2 verification
- **Issue:** Node.js emitted warning about module type detection for `lib/effects-shared.js`
- **Fix:** Added `"type": "module"` to root `package.json`
- **Files modified:** `package.json`
- **Commit:** 59d3d1b
- **Rationale:** Without this, Node would reparse the module causing performance overhead and warnings. Required for clean ES module loading.

## Verification Results

All verification criteria passed:

1. ✓ CORP header present on all API responses (`cross-origin`)
2. ✓ Server starts without import errors
3. ✓ Deterministic: same seed = same effects (verified with 'seed-abc')
4. ✓ Filter strings valid FFmpeg syntax
5. ✓ Backward compatible: existing server code works unchanged

## Performance

- **Plan execution:** 9 minutes
- **Commits:** 3 (2 tasks + 1 deviation fix)
- **Files created:** 2
- **Files modified:** 4

## Decisions Made

### Decision: Simple Middleware Over Helmet
**Context:** Need CORP header on all responses for COEP compatibility.

**Options:**
1. Use helmet package (full security suite)
2. Custom middleware (single header)

**Chosen:** Option 2 - Custom middleware

**Rationale:**
- Only need one header, not a full security suite
- Reduces dependency surface
- More explicit and easier to understand
- No risk of helmet updates changing behavior

**Impact:** Lightweight solution, easy to extend if more headers needed later.

### Decision: RNG Function Parameter Pattern
**Context:** Need effect generation to work in browser and Node.js with same code.

**Options:**
1. Conditional imports (if browser/if Node)
2. Accept RNG function as parameter
3. Separate browser/server modules

**Chosen:** Option 2 - RNG parameter

**Rationale:**
- No environment detection needed
- Single source of truth
- Testable with controlled RNG
- Clean functional approach

**Impact:** Shared module is truly isomorphic, no duplication.

## Next Phase Readiness

**Ready for Phase 10 Plan 02:** Yes

**Dependencies satisfied:**
- ✓ CORP header enables COEP in frontend
- ✓ Shared effects module ready for browser import
- ✓ Server effects generation deterministic (testable)

**Blockers:** None

**Concerns:** None

## Key Artifacts

### server/middleware/security.js
```javascript
export function securityHeaders() {
  return function(req, res, next) {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
  };
}
```

### lib/effects-shared.js
Exports:
- `generateUniqueEffects(rng, count)` - Generate N unique effect parameter sets
- `buildFilterString(effects)` - Convert effect object to FFmpeg filter string

### server/lib/effects.js
Wrapper that:
- Imports seedrandom for server-side deterministic generation
- Re-exports shared module with backward-compatible API
- Adds optional `seed` parameter to `generateUniqueEffects(count, seed)`

## Testing Notes

**Manual testing performed:**
1. Server startup with CORP middleware - no errors
2. HTTP requests show CORP header in response
3. Effects generation with/without seed
4. Determinism verification (same seed = same output)
5. Backward compatibility (no seed still works)
6. Filter string syntax validation

**No automated tests added** - plan scope was implementation only.

## Links & References

- Research: `.planning/phases/10-foundation-abstraction/10-RESEARCH.md`
- COEP requirements: https://web.dev/coop-coep/
- SharedArrayBuffer: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer

## Commits

1. `44b6273` - feat(10-01): add CORP header middleware to Express
2. `94f4320` - feat(10-01): extract shared effects module with seedrandom
3. `59d3d1b` - fix(10-01): add ES module type to root package.json
