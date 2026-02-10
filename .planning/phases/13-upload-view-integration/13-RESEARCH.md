# Phase 13: Upload View Integration - Research

**Researched:** 2026-02-09
**Domain:** Upload UI enhancement with mode selection, localStorage persistence, and routing integration
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Toggle presentation:**
- Radio buttons (not segmented control or switch)
- Two options: "Process on device" and "Send to server"
- Labels only — no descriptive subtext underneath
- Placed above the file drop zone (user decides mode first, then selects files)
- Minimal styling — just the radio buttons inline, no container/border/section header

**Capability messaging:**
- When SharedArrayBuffer is unavailable, device radio is grayed out (disabled) with simple text: "Not supported in this browser" or similar
- No technical jargon — keep the message simple
- No guidance about which mode is better for certain situations — user just picks
- No trade-off hints or recommendations

**Mode switching behavior:**
- User can freely switch mode after selecting files — files stay selected
- Radio buttons lock (disabled) once processing starts — no switching mid-batch
- After processing completes, navigate to results view (same as current server flow)
- Device mode results use the same results page as server results — unified view

**Default & persistence:**
- Server is the default for first-time users
- Preference saved to localStorage on radio button selection (not on submit)
- Returning users see their last choice pre-selected silently — no "(last used)" indicator
- If saved preference is device but SharedArrayBuffer unavailable: silent fallback to server (no notification)
- Preference persists across auth sessions (survives logout/re-login)

### Claude's Discretion

- localStorage key naming
- Exact radio button styling to match existing upload page aesthetic
- How device results are represented in the unified results page
- Loading/transition states between mode selection and processing start

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.

</user_constraints>

## Summary

Phase 13 integrates device processing (Phase 11) and server processing into a unified upload workflow with a simple mode toggle. The codebase already has device processing (`views/device-progress.js`, Phase 11), server processing (`views/upload.js` with server API), and capability detection (`lib/capability-detection.js`, Phase 10). This phase adds radio button mode selection, localStorage persistence, and smart routing to the appropriate processing path.

Key findings:
- Radio button groups are native HTML with built-in mutual exclusivity via the `name` attribute
- The `change` event is preferred over `click` for radio state detection (fires only on actual changes)
- localStorage best practice: use namespaced keys (e.g., `app-name.preference-name`) to avoid conflicts
- Device processing already uses `setDeviceProcessingData()` + `#device-progress` navigation (Phase 11)
- Server processing uses FormData upload + `#job/{jobId}` navigation (current implementation)
- The `disabled` HTML attribute provides complete interaction blocking + native styling
- Hash-based routing (already implemented) handles navigation with `window.location.hash`

**Primary recommendation:** Add radio button group before the drop zone in `views/upload.js`, save preference to localStorage on `change` event using namespaced key, load preference on view render with fallback to server if device unavailable, and route to `#device-progress` or server API based on selected mode.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Vanilla JS | ES6+ | Radio button management, localStorage | No library needed—native APIs sufficient |
| localStorage | Browser API | Preference persistence | Built-in, simple key-value storage, persists across sessions |
| HTMLInputElement | Browser API | Radio button semantics | Native mutual exclusivity, accessibility, form integration |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| existing `capability-detection.js` | Current | Check SharedArrayBuffer support | Already implemented in Phase 10 |
| existing `router.js` | Current | Hash-based navigation | Already implemented in Phase 9 |
| existing `device-progress.js` | Current | Device processing view | Already implemented in Phase 11 |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Radio buttons | Segmented control/toggle | User specified radio buttons—locked decision |
| localStorage | sessionStorage | sessionStorage clears on tab close; requirement specifies cross-session persistence |
| localStorage | Cookies | Cookies sent with every request (overhead); localStorage is client-only |
| Native disabled | aria-disabled | aria-disabled requires custom JS + CSS; native disabled simpler for this use case |

**Installation:**
No new dependencies—uses existing codebase modules and browser APIs.

## Architecture Patterns

### Recommended Project Structure
```
views/
├── upload.js              # Modified: add mode toggle, routing logic
├── device-progress.js     # Existing: device processing view (Phase 11)
└── job-detail.js          # Existing: server job results view

lib/
├── capability-detection.js  # Existing: supportsClientProcessing() (Phase 10)
└── router.js                # Existing: hash routing (Phase 9)
```

### Pattern 1: Radio Button Group with Native Mutual Exclusivity
**What:** Group radio inputs with shared `name` attribute for single-selection behavior
**When to use:** Mode toggle in upload view
**Example:**
```javascript
// Source: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/radio
const radioGroup = document.createElement('div');
radioGroup.className = 'mode-selection';

// Server radio (default)
const serverRadio = document.createElement('input');
serverRadio.type = 'radio';
serverRadio.name = 'processing-mode';  // Same name = mutual exclusivity
serverRadio.value = 'server';
serverRadio.id = 'mode-server';
serverRadio.checked = true;  // Default

const serverLabel = document.createElement('label');
serverLabel.htmlFor = 'mode-server';
serverLabel.textContent = 'Send to server';

// Device radio
const deviceRadio = document.createElement('input');
deviceRadio.type = 'radio';
deviceRadio.name = 'processing-mode';  // Same name = mutual exclusivity
deviceRadio.value = 'device';
deviceRadio.id = 'mode-device';

const deviceLabel = document.createElement('label');
deviceLabel.htmlFor = 'mode-device';
deviceLabel.textContent = 'Process on device';

radioGroup.appendChild(serverRadio);
radioGroup.appendChild(serverLabel);
radioGroup.appendChild(deviceRadio);
radioGroup.appendChild(deviceLabel);

// Shared name ensures only one can be checked at a time
```

### Pattern 2: localStorage Preference Persistence with Namespacing
**What:** Save user preference to localStorage with namespaced key to avoid conflicts
**When to use:** Persisting mode selection across sessions
**Example:**
```javascript
// Source: https://medium.com/@emadalam/namespace-localstorage-e2d1d2e68b20
// Namespace pattern: PROJECT_NAME.setting_name
const STORAGE_KEY = 'video-refresher.processing-mode';

// Save preference on change (not on submit)
function saveProcessingMode(mode) {
  localStorage.setItem(STORAGE_KEY, mode);
}

// Load preference on view render
function loadProcessingMode() {
  return localStorage.getItem(STORAGE_KEY) || 'server';  // Default to server
}

// Usage in radio change handler
deviceRadio.addEventListener('change', () => {
  if (deviceRadio.checked) {
    saveProcessingMode('device');
  }
});

serverRadio.addEventListener('change', () => {
  if (serverRadio.checked) {
    saveProcessingMode('server');
  }
});
```

### Pattern 3: Conditional Disable with Fallback
**What:** Disable device option when capability unavailable, with silent fallback
**When to use:** Handling browsers without SharedArrayBuffer support
**Example:**
```javascript
// Source: existing lib/capability-detection.js (Phase 10)
import { supportsClientProcessing } from '../lib/capability-detection.js';

function setupModeToggle() {
  const savedMode = loadProcessingMode();
  const canProcessOnDevice = supportsClientProcessing();

  // If saved mode is device but capability unavailable, fallback silently
  let effectiveMode = savedMode;
  if (savedMode === 'device' && !canProcessOnDevice) {
    effectiveMode = 'server';  // Silent fallback (no notification)
  }

  // Set initial state
  if (effectiveMode === 'device') {
    deviceRadio.checked = true;
  } else {
    serverRadio.checked = true;
  }

  // Disable device option if unavailable
  if (!canProcessOnDevice) {
    deviceRadio.disabled = true;
    deviceLabel.style.color = '#999';

    // Add simple message
    const disabledMsg = document.createElement('span');
    disabledMsg.textContent = ' (Not supported in this browser)';
    disabledMsg.style.cssText = 'font-size: 0.9em; color: #999;';
    deviceLabel.appendChild(disabledMsg);
  }
}
```

### Pattern 4: Mode-Aware Routing
**What:** Route submission to device or server path based on selected mode
**When to use:** Upload submission handler
**Example:**
```javascript
// Source: existing views/upload.js + views/device-progress.js (Phase 11)
import { setDeviceProcessingData } from './device-progress.js';

submitBtn.addEventListener('click', async () => {
  const selectedMode = document.querySelector('input[name="processing-mode"]:checked').value;

  if (selectedMode === 'device') {
    // Device path (Phase 11)
    setDeviceProcessingData(selectedFiles, variations);
    window.location.hash = '#device-progress';
  } else {
    // Server path (existing)
    const formData = new FormData();
    selectedFiles.forEach(file => formData.append('videos', file));
    formData.append('variations', variations.toString());

    const data = await uploadFiles('/api/jobs', formData, onProgress);
    window.location.hash = `#job/${data.jobId}`;
  }
});
```

### Pattern 5: Disable Toggle During Processing
**What:** Lock radio buttons once processing starts to prevent mid-batch mode changes
**When to use:** When submit button is clicked and processing begins
**Example:**
```javascript
submitBtn.addEventListener('click', async () => {
  // Lock radio buttons
  serverRadio.disabled = true;
  deviceRadio.disabled = true;

  // Disable submit button
  submitBtn.disabled = true;

  // Process based on mode
  const selectedMode = document.querySelector('input[name="processing-mode"]:checked').value;

  if (selectedMode === 'device') {
    setDeviceProcessingData(selectedFiles, variations);
    window.location.hash = '#device-progress';
  } else {
    // Server processing...
  }

  // Note: Navigation away from page means cleanup isn't needed here
  // If processing fails, re-enable in error handler
});
```

### Anti-Patterns to Avoid

- **Using click instead of change:** The `click` event fires even when clicking an already-selected radio button. Use `change` which fires only when selection actually changes (source: [https://copyprogramming.com/howto/javascript-html-form-radio-button-select-only-one](https://copyprogramming.com/howto/javascript-html-form-radio-button-select-only-one))
- **Saving preference on submit instead of change:** User specified save on radio selection, not submission
- **Using aria-disabled instead of native disabled:** Native `disabled` provides interaction blocking, focus exclusion, and default styling automatically. `aria-disabled` requires custom JS and CSS (source: [https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Attributes/aria-disabled](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Attributes/aria-disabled))
- **Generic localStorage keys:** Use namespaced keys like `video-refresher.processing-mode` to avoid conflicts with other apps on same domain
- **Re-loading preference on every change event:** Load once on view render, save on change, don't read back immediately

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Radio button mutual exclusivity | Custom JS to deselect other radios | Native `name` attribute grouping | Built into HTML spec, works without JS, accessible by default |
| Form state persistence | Custom serialization/deserialization | localStorage with JSON.stringify/parse | Simple API, synchronous, 5-10MB storage, persists across sessions |
| Hash routing | Custom URL parsing | Existing `lib/router.js` (Phase 9) | Already implemented, tested, handles auth |
| Capability detection | Inline SharedArrayBuffer checks | Existing `lib/capability-detection.js` (Phase 10) | Already implemented, tested, includes cross-origin isolation check |

**Key insight:** This phase primarily wires together existing components (capability detection, device processing, server processing, routing). The only new primitives are radio buttons (native HTML) and localStorage (native API)—both have simple, well-documented patterns that don't benefit from libraries.

## Common Pitfalls

### Pitfall 1: Radio Button State Not Persisting Across Sessions
**What goes wrong:** User selects device mode, closes browser, returns to find server mode selected again
**Why it happens:** Preference saved to sessionStorage instead of localStorage, or not saved at all
**How to avoid:** Use `localStorage.setItem()` which persists across browser restarts, not `sessionStorage` (clears on tab close)
**Warning signs:** Test by selecting mode, closing tab, reopening—preference should persist

### Pitfall 2: Device Mode Available Despite Missing SharedArrayBuffer
**What goes wrong:** User selects device mode, clicks submit, processing fails with cryptic error
**Why it happens:** Forgot to check capability and disable device radio when SharedArrayBuffer unavailable
**How to avoid:** Call `supportsClientProcessing()` on view render and set `deviceRadio.disabled = true` if false
**Warning signs:** Test in non-cross-origin-isolated context (regular http:// or third-party iframe)—device option should be grayed out

### Pitfall 3: Files Lost When Switching Modes
**What goes wrong:** User selects files, switches from server to device mode, files disappear
**Why it happens:** Re-rendering file list or resetting `selectedFiles` array on radio change
**How to avoid:** Radio change handler should only update localStorage and radio state—don't touch file list
**Warning signs:** User complaint: "I selected files, changed my mind about processing mode, and had to re-select everything"

### Pitfall 4: Mode Toggle Still Active During Processing
**What goes wrong:** User clicks submit, then switches mode while upload/processing is in progress, causing undefined behavior
**Why it happens:** Forgot to disable radio buttons when processing starts
**How to avoid:** Set `serverRadio.disabled = true` and `deviceRadio.disabled = true` in submit handler before processing
**Warning signs:** Race conditions, partial uploads, FFmpeg errors from mixed state

### Pitfall 5: Saved Preference "device" Causes Silent Error
**What goes wrong:** User with device-capable browser saves "device" preference, later uses non-capable browser, sees device mode selected but fails on submit
**Why it happens:** Loading preference without validating capability
**How to avoid:** Load preference, check capability, silently fallback to server if `savedMode === 'device' && !supportsClientProcessing()`
**Warning signs:** Intermittent failures when user switches browsers or browsers update security policies

### Pitfall 6: localStorage Key Collision
**What goes wrong:** Another app on same domain uses key "mode" or "preference", overwriting this app's setting
**Why it happens:** Using generic localStorage keys without namespacing
**How to avoid:** Use namespaced key like `video-refresher.processing-mode` (source: [https://medium.com/@emadalam/namespace-localstorage-e2d1d2e68b20](https://medium.com/@emadalam/namespace-localstorage-e2d1d2e68b20))
**Warning signs:** Preference resets unexpectedly; conflict with other tools on same domain

### Pitfall 7: Navigation Happens Before Files Are Set
**What goes wrong:** Navigate to `#device-progress`, but `pendingFiles` is null/undefined, shows error state
**Why it happens:** Calling `window.location.hash = '#device-progress'` before `setDeviceProcessingData(files, variations)`
**How to avoid:** Always call `setDeviceProcessingData()` before navigation (order matters)
**Warning signs:** Device progress view shows "No files to process" despite files being selected

## Code Examples

Verified patterns from codebase and standard sources:

### Radio Button Group Creation
```javascript
// Minimal inline styling matching existing upload page aesthetic
// Source: Existing views/upload.js structure

const modeSection = document.createElement('div');
modeSection.style.cssText = 'margin-bottom: 1.5rem; display: flex; align-items: center; gap: 1.5rem;';

// Server radio (default)
const serverRadio = document.createElement('input');
serverRadio.type = 'radio';
serverRadio.name = 'processing-mode';
serverRadio.value = 'server';
serverRadio.id = 'mode-server';
serverRadio.checked = true;

const serverLabel = document.createElement('label');
serverLabel.htmlFor = 'mode-server';
serverLabel.textContent = 'Send to server';
serverLabel.style.cssText = 'cursor: pointer; display: flex; align-items: center; gap: 0.5rem;';

const serverWrapper = document.createElement('div');
serverWrapper.style.cssText = 'display: flex; align-items: center; gap: 0.5rem;';
serverWrapper.appendChild(serverRadio);
serverWrapper.appendChild(serverLabel);

// Device radio
const deviceRadio = document.createElement('input');
deviceRadio.type = 'radio';
deviceRadio.name = 'processing-mode';
deviceRadio.value = 'device';
deviceRadio.id = 'mode-device';

const deviceLabel = document.createElement('label');
deviceLabel.htmlFor = 'mode-device';
deviceLabel.textContent = 'Process on device';
deviceLabel.style.cssText = 'cursor: pointer; display: flex; align-items: center; gap: 0.5rem;';

const deviceWrapper = document.createElement('div');
deviceWrapper.style.cssText = 'display: flex; align-items: center; gap: 0.5rem;';
deviceWrapper.appendChild(deviceRadio);
deviceWrapper.appendChild(deviceLabel);

modeSection.appendChild(serverWrapper);
modeSection.appendChild(deviceWrapper);

// Insert before drop zone
wrapper.insertBefore(modeSection, dropZone);
```

### localStorage Preference Management
```javascript
// Source: Existing lib/api.js pattern + https://www.theanshuman.dev/articles/the-right-way-to-use-localstorage-in-javascript-41a0

const STORAGE_KEY = 'video-refresher.processing-mode';

function saveProcessingMode(mode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch (e) {
    console.warn('Failed to save processing mode preference:', e);
    // Graceful degradation—continue without persistence
  }
}

function loadProcessingMode() {
  try {
    return localStorage.getItem(STORAGE_KEY) || 'server';
  } catch (e) {
    console.warn('Failed to load processing mode preference:', e);
    return 'server';  // Fallback to default
  }
}

// Attach change listeners
serverRadio.addEventListener('change', () => {
  if (serverRadio.checked) {
    saveProcessingMode('server');
  }
});

deviceRadio.addEventListener('change', () => {
  if (deviceRadio.checked) {
    saveProcessingMode('device');
  }
});
```

### Capability Check with UI Feedback
```javascript
// Source: Existing lib/capability-detection.js (Phase 10)
import { supportsClientProcessing } from '../lib/capability-detection.js';

function setupModeToggle() {
  const canProcessOnDevice = supportsClientProcessing();
  const savedMode = loadProcessingMode();

  // Silent fallback if saved preference unavailable
  let effectiveMode = savedMode;
  if (savedMode === 'device' && !canProcessOnDevice) {
    effectiveMode = 'server';
  }

  // Set initial checked state
  if (effectiveMode === 'device') {
    deviceRadio.checked = true;
  } else {
    serverRadio.checked = true;
  }

  // Disable device option if not supported
  if (!canProcessOnDevice) {
    deviceRadio.disabled = true;
    deviceLabel.style.color = '#999';
    deviceLabel.style.cursor = 'not-allowed';

    const unsupportedMsg = document.createElement('span');
    unsupportedMsg.textContent = ' (Not supported in this browser)';
    unsupportedMsg.style.cssText = 'font-size: 0.85em; color: #999; font-weight: normal;';
    deviceLabel.appendChild(unsupportedMsg);
  }
}
```

### Mode-Aware Submit Handler
```javascript
// Source: Existing views/upload.js submit handler + views/device-progress.js (Phase 11)
import { setDeviceProcessingData } from './device-progress.js';
import { uploadFiles } from '../lib/api.js';

submitBtn.addEventListener('click', async () => {
  if (selectedFiles.length === 0) return;

  const variations = parseInt(variationInput.value, 10);
  const selectedMode = document.querySelector('input[name="processing-mode"]:checked').value;

  // Lock mode toggle during processing
  serverRadio.disabled = true;
  deviceRadio.disabled = true;

  // Disable submit button
  submitBtn.disabled = true;
  submitBtn.style.background = '#ccc';
  submitBtn.style.cursor = 'not-allowed';
  submitBtn.textContent = 'Processing...';

  if (selectedMode === 'device') {
    // Device processing path (Phase 11)
    setDeviceProcessingData(selectedFiles, variations);
    window.location.hash = '#device-progress';

  } else {
    // Server processing path (existing)
    progressSection.style.display = 'block';
    progressBar.style.width = '0%';
    progressText.textContent = '0%';

    const formData = new FormData();
    selectedFiles.forEach(file => formData.append('videos', file));
    formData.append('variations', variations.toString());

    try {
      const data = await uploadFiles('/api/jobs', formData, (percentComplete) => {
        progressBar.style.width = `${percentComplete}%`;
        progressText.textContent = `${Math.round(percentComplete)}%`;
      });

      window.location.hash = `#job/${data.jobId}`;

    } catch (err) {
      // Re-enable controls on error
      serverRadio.disabled = false;
      deviceRadio.disabled = false;
      submitBtn.disabled = false;
      submitBtn.style.background = '#0066cc';
      submitBtn.style.cursor = 'pointer';
      submitBtn.textContent = 'Upload and Process';

      warningDiv.style.display = 'block';
      warningDiv.style.background = '#fee';
      warningDiv.style.color = '#c33';
      warningDiv.textContent = `Upload failed: ${err.message}`;
      progressSection.style.display = 'none';
    }
  }
});
```

### Getting Selected Radio Value
```javascript
// Source: https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/radio

// Get currently selected mode
const selectedMode = document.querySelector('input[name="processing-mode"]:checked')?.value || 'server';

// Alternative: using radio references directly
const getSelectedMode = () => {
  if (deviceRadio.checked) return 'device';
  if (serverRadio.checked) return 'server';
  return 'server';  // Fallback
};
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| jQuery for radio button handling | Native querySelectorAll + change event | 2015-2018 | Lighter, no dependencies, better performance |
| click events for radio detection | change event for radio detection | 2020+ | Avoids redundant events when clicking already-selected radio |
| Global localStorage keys | Namespaced keys (app.setting) | 2018+ | Avoids conflicts on shared domains |
| aria-disabled for custom controls | Native disabled attribute | Ongoing | Simpler implementation, built-in accessibility |
| Custom routing libraries | Native hash navigation with hashchange | 2015+ (for simple SPAs) | Zero dependencies, sufficient for hash-based SPAs |

**Deprecated/outdated:**
- **sessionStorage for cross-session preferences:** Use localStorage for preferences that should survive browser restarts
- **display:none for hiding radio inputs:** Use `width: 0; height: 0; opacity: 0` to maintain keyboard accessibility (source: [https://www.sliderrevolution.com/resources/styling-radio-buttons/](https://www.sliderrevolution.com/resources/styling-radio-buttons/))
- **Custom beforeunload for SPAs:** Modern SPAs handle navigation internally; existing Phase 11 implementation uses beforeunload for device processing only (source: [https://dev.to/chromiumdev/sure-you-want-to-leavebrowser-beforeunload-event-4eg5](https://dev.to/chromiumdev/sure-you-want-to-leavebrowser-beforeunload-event-4eg5))

## Open Questions

1. **Unified results view for device processing**
   - What we know: User specified "Device mode results use the same results page as server results — unified view" (CONTEXT.md)
   - What's unclear: Current implementation has separate views (`device-progress.js` vs `job-detail.js`). Should we create a new unified view, or adapt `job-detail.js` to display device results, or is "unified" just referring to both ending at a results page?
   - Recommendation: Defer to planning phase. Most likely interpretation: keep separate views but ensure consistent visual treatment (badges, download buttons, etc.). Creating a truly unified view would require significant refactoring of both views and may exceed phase scope.

2. **Loading/transition states between mode selection and processing start**
   - What we know: Marked as "Claude's Discretion" in CONTEXT.md
   - What's unclear: Should there be intermediate states (e.g., "Preparing device processing..." before navigating to device-progress)?
   - Recommendation: Keep simple—immediate navigation to appropriate view. Device-progress view already shows "Initializing FFmpeg..." state (Phase 11), server upload shows progress bar. No intermediate state needed.

3. **Error handling when localStorage is disabled**
   - What we know: localStorage might be disabled (private browsing modes, browser settings, storage quotas)
   - What's unclear: Should we notify user if preference can't be saved?
   - Recommendation: Graceful degradation—wrap localStorage calls in try-catch, log warnings to console, continue with default behavior. No user notification needed (silent failure).

## Sources

### Primary (HIGH confidence)
- [MDN: input type="radio"](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/radio) - Radio button semantics and usage
- [MDN: aria-disabled attribute](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Attributes/aria-disabled) - Disabled vs aria-disabled comparison
- [MDN: Window beforeunload event](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event) - Navigation warning patterns
- Existing codebase: `lib/capability-detection.js` (Phase 10) - SharedArrayBuffer detection
- Existing codebase: `views/device-progress.js` (Phase 11) - Device processing implementation
- Existing codebase: `views/upload.js` - Current server upload flow
- Existing codebase: `lib/router.js` (Phase 9) - Hash-based routing
- Existing codebase: `lib/api.js` - localStorage pattern for auth tokens

### Secondary (MEDIUM confidence)
- [Medium: Namespace localStorage](https://medium.com/@emadalam/namespace-localstorage-e2d1d2e68b20) - localStorage key naming conventions
- [The Right Way to Use LocalStorage](https://www.theanshuman.dev/articles/the-right-way-to-use-localstorage-in-javascript-41a0) - Best practices and error handling
- [CopyProgramming: JavaScript Radio Button](https://copyprogramming.com/howto/javascript-html-form-radio-button-select-only-one) - Change event vs click event for radio buttons
- [Slider Revolution: Styling Radio Buttons](https://www.sliderrevolution.com/resources/styling-radio-buttons/) - CSS patterns and accessibility
- [Modern CSS: Pure CSS Radio Buttons](https://moderncss.dev/pure-css-custom-styled-radio-buttons/) - Minimal styling approaches
- [DEV: Sure You Want to Leave?](https://dev.to/chromiumdev/sure-you-want-to-leavebrowser-beforeunload-event-4eg5) - beforeunload event patterns
- [Innolitics: Preventing Data Loss in Web Forms](https://innolitics.com/articles/web-form-warn-on-nav/) - Form state preservation in SPAs

### Tertiary (LOW confidence)
- [GitHub: mozilla/pdf.js localStorage naming](https://github.com/mozilla/pdf.js/issues/7760) - Community discussion on key naming
- [DEV: Single Page Application Routing](https://dev.to/thedevdrawer/single-page-application-routing-using-hash-or-url-9jh) - Hash routing patterns

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Native APIs with extensive documentation, existing codebase patterns established
- Architecture: HIGH - Clear integration points with existing Phase 10/11 implementations
- Pitfalls: HIGH - Common localStorage and radio button issues well-documented, existing codebase provides context

**Research date:** 2026-02-09
**Valid until:** 2026-03-09 (30 days - stable domain with mature browser APIs)
