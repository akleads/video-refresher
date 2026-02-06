# Architecture

**Analysis Date:** 2026-02-06

## Pattern Overview

**Overall:** Single-page application (SPA) with client-side video processing

**Key Characteristics:**
- Pure client-side architecture with no backend requirements
- Browser-native WebAssembly for video processing (FFmpeg.wasm)
- Stateful in-memory queue system for handling multiple file uploads
- Event-driven UI with progressive state management
- Module-based ES6 imports

## Layers

**Presentation (UI):**
- Purpose: Display upload interface, video previews, processing queue, and results
- Location: `index.html`, `styles.css`
- Contains: HTML structure for upload zone, video preview panels, progress indicators, queue display
- Depends on: JavaScript logic for state and event handling
- Used by: JavaScript controller for DOM manipulation and display updates

**Application Logic (Controller):**
- Purpose: Orchestrate video processing workflow, manage user interactions, and coordinate between UI and FFmpeg
- Location: `app.js` (primary application file)
- Contains: Event handlers, state management, queue processing, video transformations
- Depends on: FFmpeg.wasm SDK, browser File APIs
- Used by: HTML document through module import

**Processing Engine:**
- Purpose: Execute video transformations using FFmpeg compiled to WebAssembly
- Location: Loaded from CDN (`https://esm.sh/@ffmpeg/ffmpeg@0.11.6`, `https://unpkg.com/@ffmpeg/core@0.11.0`)
- Contains: FFmpeg binary, WebAssembly runtime, video codec implementations
- Depends on: Browser WebAssembly support, SharedArrayBuffer (requires specific HTTP headers)
- Used by: `app.js` through FFmpeg instance API

**Infrastructure (Development/Deployment):**
- Purpose: Serve application with required HTTP headers and manage build/deployment
- Location: `server.py` (development), `wrangler.toml` (Cloudflare Pages deployment)
- Contains: HTTP server configuration, Cloudflare Pages settings
- Depends on: Python 3 runtime (dev), Cloudflare Pages platform (production)
- Used by: Developers during development, CI/CD during deployment

## Data Flow

**User Upload → Queue Management:**

1. User clicks upload zone or drags files
2. File input handler captures files via `handleMultipleFiles()`
3. Files are filtered for MP4 validity
4. Valid files pushed to `processingQueue` array
5. UI updated via `updateQueueUI()` to show queued items
6. `processQueue()` begins processing first file asynchronously

**Video Processing Pipeline:**

1. `processQueue()` retrieves first file from queue
2. `handleFile()` validates file and displays original video preview
3. `processVideo()` is called to execute FFmpeg operations:
   - FFmpeg is loaded (cached after first load) via `loadFFmpeg()`
   - Video file read as ArrayBuffer via `file.arrayBuffer()`
   - File written to FFmpeg virtual filesystem via `ffmpeg.FS('writeFile')`
   - FFmpeg command executed with encoding parameters based on file size
   - Processed video read from FFmpeg filesystem via `ffmpeg.FS('readFile')`
   - Blob created and displayed in UI
4. Processed video info stored in `processedVideos` array
5. Processed videos list updated via `updateProcessedVideosList()`
6. Progress callbacks (`updateProgress()`) reflect completion percentage
7. FFmpeg filesystem cleaned up via `FS('unlink')` operations

**State Management:**

- `ffmpeg`: Singleton instance of FFmpeg (null before loading)
- `ffmpegLoaded`: Boolean flag to prevent duplicate FFmpeg initialization
- `processingQueue`: Array of File objects pending processing
- `isProcessing`: Boolean flag indicating if a file is currently being processed
- `processedVideos`: Array of processed video metadata objects containing original name, processed name, blob URL, file size, and timestamp

## Key Abstractions

**FFmpeg Instance (Singleton):**
- Purpose: Single global FFmpeg instance shared across all processing operations
- Examples: `app.js` lines 14-16, 32-45
- Pattern: Lazy initialization with caching flag (`ffmpegLoaded`). Loaded once, reused for all subsequent videos.

**Video Processing Queue:**
- Purpose: Serialize multiple file uploads into sequential processing to prevent memory overload
- Examples: `app.js` lines 73-74, 172-196
- Pattern: First-in-first-out queue with async processing loop. Files processed one at a time with 500ms delay between starts.

**Progress Reporting:**
- Purpose: Provide feedback during long-running FFmpeg operations
- Examples: `app.js` lines 59-70
- Pattern: Callback-based progress updates integrated into FFmpeg runtime configuration and manual progress bar updates.

**Virtual Filesystem Operations:**
- Purpose: Interface between browser File API and FFmpeg's in-memory filesystem
- Examples: `app.js` lines 344-355, 435, 465-470
- Pattern: FFmpeg.FS API for writeFile/readFile/unlink operations on virtual filesystem containing intermediate and output files.

## Entry Points

**Application Load:**
- Location: `index.html`, lines 83
- Triggers: Page load via `<script type="module" src="app.js"></script>`
- Responsibilities: Initializes module, executes top-level code (FFmpeg import), attaches DOMContentLoaded listener

**DOM Ready Handler:**
- Location: `app.js`, lines 199-204
- Triggers: When DOM is fully loaded (or immediately if already loaded)
- Responsibilities: Calls `initializeUploadHandlers()` to attach all event listeners

**Upload Handlers:**
- Location: `app.js`, lines 80-142
- Triggers: File upload via click, drag-and-drop, or input element change
- Responsibilities: Validates files, filters for MP4 format, delegates to `handleMultipleFiles()`

**Queue Processing:**
- Location: `app.js`, lines 172-196
- Triggers: New files added to queue via `handleMultipleFiles()` or completion of previous file
- Responsibilities: Manages async processing loop, coordinates file processing, handles inter-file delays

## Error Handling

**Strategy:** Defensive with helpful user-facing messaging

**Patterns:**

- **FFmpeg Loading Errors** (`app.js` lines 49-56): Caught in try-catch, logged to console, displayed to user with instruction to refresh
- **File Processing Errors** (`app.js` lines 287-304): Wrapped in try-catch, common errors (OOM, abort) detected and translated to user-friendly messages
- **FFmpeg Execution Errors** (`app.js` lines 417-429): Specific error patterns detected (OOM, abort, corruption) with tailored messaging
- **DOM Element Validation**: Null checks before accessing DOM elements (`app.js` lines 85-88, 248-251)
- **File Type Validation**: Extension and MIME type checking before processing (`app.js` lines 146-157, 253-256)
- **File Size Validation**: User confirmation dialog for files exceeding 100MB (`app.js` lines 258-272)

## Cross-Cutting Concerns

**Logging:** Browser console via `console.log()`, `console.warn()`, `console.error()` at key points:
- FFmpeg lifecycle events (load start, completion, errors)
- File processing milestones (read, write, execution, cleanup)
- Progress checkpoints
- Error details with stack traces

**Validation:** Multi-stage validation:
- File type checking (MIME type and extension)
- File size warnings with user confirmation
- DOM element existence checks before manipulation
- FFmpeg instance state verification before use

**UI State Management:** Centralized state arrays and flags updated through dedicated functions:
- `updateQueueUI()`: Reflects queue and processing status
- `updateProgress()`: Reflects processing percentage and message
- `updateProcessedVideosList()`: Reflects completed videos
- DOM visibility toggled based on state conditions

---

*Architecture analysis: 2026-02-06*
