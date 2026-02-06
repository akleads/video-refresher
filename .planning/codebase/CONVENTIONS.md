# Coding Conventions

**Analysis Date:** 2026-02-06

## Naming Patterns

**Files:**
- Kebab-case for utility/config files: `server.py`, `styles.css`
- Descriptive names without prefixes or suffixes

**Functions:**
- camelCase for all function declarations
- Examples: `generateUniqueID()`, `loadFFmpeg()`, `updateProgress()`, `handleFile()`, `processQueue()`
- Function names are action-oriented and descriptive

**Variables:**
- `const` for all immutable bindings (preferred)
- `let` for variables that must be reassigned
- camelCase naming throughout
- Global module-level state variables: `let ffmpeg = null`, `let ffmpegLoaded = false`, `let processingQueue = []`
- Local scope variables: `const statusText = document.getElementById(...)`, `const files = Array.from(...)`
- Abbreviations avoided except for standard contexts: `MB` for megabytes, `ID` for identifier, `URL` for uniform resource locator

**Types/Constants:**
- No TypeScript types used (vanilla JavaScript)
- Magic numbers are often documented inline with comments when critical

## Code Style

**Formatting:**
- No linter configuration detected (no `.eslintrc`, `.prettierrc`, or similar)
- No formatter configuration detected
- Indentation: 4 spaces (observed consistently in `app.js`)
- Line length: No strict limit observed, lines typically < 100 characters
- Single quotes not enforced (template literals used where appropriate)

**Linting:**
- No linting framework detected
- No style enforcement tool in use

## Import Organization

**Order:**
1. External CDN imports first: `import { createFFmpeg, fetchFile } from 'https://esm.sh/@ffmpeg/ffmpeg@0.11.6'`
2. No local imports detected (monolithic single-file structure)

**Path Aliases:**
- Not used; project is small with single main script file

**Module Pattern:**
- ES module syntax used: `import` statements at top
- `type="module"` attribute on script tag in HTML: `<script type="module" src="app.js"></script>`
- No barrel files or re-exports

## Error Handling

**Patterns:**
- Try-catch blocks used for async operations and critical code paths
- Examples:
  - `loadFFmpeg()` wraps FFmpeg initialization in try-catch (lines 29-56)
  - `processQueue()` wraps `handleFile()` call in try-catch (lines 183-195)
  - `processVideo()` has nested try-catch blocks for file writing and FFmpeg processing
- Error objects passed through with original message: `throw error` (line 55)
- Custom Error messages with context: `throw new Error('FFmpeg instance not initialized')` (line 326)
- Errors logged with `console.error()` for debugging: `console.error('Error loading FFmpeg:', error)`
- Error details logged separately: `console.error('Error details:', error.message, error.stack)` (line 51)
- User-facing error messages constructed with helpful guidance:
  - Out of memory errors suggest file size reduction
  - Abort errors suggest file corruption or browser limitations

## Logging

**Framework:** `console` object only

**Patterns:**
- `console.log()` for informational messages and progress tracking
- `console.error()` for error conditions with context
- `console.warn()` for non-fatal issues: `console.warn('Invalid file type:', file.name)` (line 254)
- Logging used heavily during processing pipeline to track state transitions
- Progress logging includes file names and status: `console.log('Processing file:', file.name, ${fileSizeMB} MB)`
- No structured logging or log levels framework

## Comments

**When to Comment:**
- Algorithm explanation: Comments explain FFmpeg encoding settings based on file size (lines 363-398)
- Technical context: Comments explain why certain approaches are used, e.g., "Optimized for speed while maintaining good quality for files up to 100MB" (line 364)
- Workarounds documented: Comments explain browser CORS issues and older API version choice (lines 1-2)
- DOM element purposes documented: Comments identify null-check purposes (lines 239-250)

**JSDoc/TSDoc:**
- Not used (no TypeScript, minimal function documentation)
- Docstring on `server.py`: Python module docstring explaining CORS header requirements (lines 2-5)

## Function Design

**Size:**
- Functions range from short helpers (15-20 lines) to longer async handlers (50-70 lines)
- `loadFFmpeg()`: 28 lines (initialization with error handling)
- `processVideo()`: 161 lines (main business logic)
- Average function size: 25-40 lines

**Parameters:**
- Single parameter functions most common: `function updateProgress(percent, text)` (2 params)
- File handling functions accept file objects: `async function handleFile(file)`
- No destructuring observed
- No default parameters used

**Return Values:**
- `async` functions return Promises
- Non-async functions mostly perform side effects and return nothing (implicit `undefined`)
- `Array.from()` used to return new arrays from array-like objects
- Early returns used for validation: `if (validFiles.length === 0) { alert(...); return; }` (lines 150-152)

## Module Design

**Exports:**
- Single global function exposed to window for external HTML callbacks: `window.downloadProcessedVideo = function(index)` (line 512)
- No named exports (single-file ES module structure)
- Global state variables at module level: `ffmpeg`, `ffmpegLoaded`, `processingQueue`, `isProcessing`, `processedVideos`

**Barrel Files:**
- Not applicable (single-file architecture)

## DOM Patterns

**Element Selection:**
- `document.getElementById()` exclusively used (no querySelector observed)
- All selections include null checks: `if (!uploadArea || !videoInput) { console.error(...); return; }` (lines 85-88)

**Event Handling:**
- `addEventListener()` used for all event binding
- Arrow functions in event handlers for scope preservation (lines 91, 100, 106, etc.)
- Event delegation not used (direct element binding)
- `e.preventDefault()` and `e.stopPropagation()` used consistently in drag-drop handlers

**Style Manipulation:**
- Direct `style.display` manipulation for showing/hiding elements
- CSS class manipulation via `classList.add()` and `classList.remove()` for state changes (dragover state)
- No style framework or CSS-in-JS library used

## Data Structures

**Arrays:**
- `Array.from()` used to convert array-like objects: `const files = Array.from(e.dataTransfer.files)` (line 127)
- Array methods: `.filter()`, `.forEach()`, `.slice()` used for transformations
- Queue implemented as simple array: `processingQueue.push(file)` and `processingQueue.shift()`

**Objects:**
- Plain object literals for configuration and data: `{ originalName: file.name, processedName: outputFileName, ... }` (lines 449-455)
- No class instances used

## Async/Await

**Pattern:**
- `async` keyword on all functions performing async operations
- `await` used for sequential async operations
- Promise chaining avoided (favor async-await)
- Error handling via try-catch in async contexts

**Examples:**
```javascript
async function loadFFmpeg() {
    try {
        await ffmpeg.load();
        ffmpegLoaded = true;
    } catch (error) {
        console.error('Error loading FFmpeg:', error);
        throw error;
    }
}
```

---

*Convention analysis: 2026-02-06*
