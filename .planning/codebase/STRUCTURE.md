# Codebase Structure

**Analysis Date:** 2026-02-06

## Directory Layout

```
video-refresher/
├── index.html              # HTML entry point (UI structure)
├── app.js                  # Application logic and FFmpeg integration
├── styles.css              # Styling for all UI components
├── server.py               # Development HTTP server with CORS headers
├── package.json            # Project metadata and npm scripts
├── wrangler.toml           # Cloudflare Pages deployment config
├── _headers                # Cloudflare Pages HTTP headers config
├── _redirects              # Cloudflare Pages routing config
├── README.md               # User-facing documentation
├── DEPLOYMENT.md           # Deployment guide for Cloudflare Pages
├── DEPLOYMENT_COSTS.md     # Cost analysis for deployment
└── .planning/codebase/     # GSD codebase documentation (generated)
```

## Directory Purposes

**Root Level:**
- Purpose: Hosts all application files and configuration
- Contains: HTML, CSS, JavaScript, Python server, deployment configs
- Key files: `index.html`, `app.js`, `styles.css`

**.planning/codebase/**
- Purpose: Stores GSD codebase analysis documents
- Contains: ARCHITECTURE.md, STRUCTURE.md (this file), CONVENTIONS.md, TESTING.md, CONCERNS.md, STACK.md, INTEGRATIONS.md
- Auto-generated: Yes, by GSD mapping tool
- Committed: Yes, tracked in git

## Key File Locations

**Entry Points:**
- `index.html`: Main HTML document loaded by browser, contains all UI markup and script import
- `app.js`: ES6 module containing all application logic, event handlers, and FFmpeg integration

**Configuration:**
- `package.json`: Defines npm scripts (`dev`, `build`, `deploy`) and project metadata
- `wrangler.toml`: Cloudflare Pages deployment configuration with project name and compatibility date
- `_headers`: HTTP headers for Cloudflare Pages (sets COEP/COOP headers for SharedArrayBuffer)
- `_redirects`: URL routing rules for Cloudflare Pages
- `server.py`: Local development server with required HTTP headers for FFmpeg.wasm

**Core Logic:**
- `app.js`: Contains entire application logic:
  - FFmpeg initialization and lifecycle management (lines 14-57)
  - Event handler initialization (lines 80-142)
  - File queue management (lines 73-74, 145-196)
  - Video processing pipeline (lines 238-471)
  - UI update functions (lines 59-70, 206-236, 473-509)
  - Download handler (lines 511-522)

**Styling:**
- `styles.css`: All CSS styling for UI components, layout, animations, and responsive design

**Documentation:**
- `README.md`: User guide with features, quick start, deployment, and troubleshooting
- `DEPLOYMENT.md`: Step-by-step Cloudflare Pages deployment instructions
- `DEPLOYMENT_COSTS.md`: Cost analysis and budget estimates for cloud deployment

## Naming Conventions

**Files:**
- `.html`: HTML structure files (single file: `index.html`)
- `.js`: JavaScript files (single file: `app.js`)
- `.css`: Stylesheet (single file: `styles.css`)
- `.py`: Python server (single file: `server.py`)
- `.toml`: Configuration files (`wrangler.toml`)
- `.json`: Configuration files (`package.json`)
- `.md`: Markdown documentation

**Functions in app.js:**
- Camel case: `generateUniqueID()`, `loadFFmpeg()`, `updateProgress()`, `handleMultipleFiles()`, `processQueue()`, `processVideo()`, `updateQueueUI()`, `updateProcessedVideosList()`, `downloadProcessedVideo()`
- Prefixes indicate purpose:
  - `load*`: Initialization functions (`loadFFmpeg()`)
  - `handle*`: Event handlers (`handleMultipleFiles()`, `handleFile()`)
  - `process*`: Processing orchestration (`processQueue()`, `processVideo()`)
  - `update*`: UI state updates (`updateProgress()`, `updateQueueUI()`, `updateProcessedVideosList()`)
  - `generate*`: Data generation (`generateUniqueID()`)

**Variables in app.js:**
- Module-level state uses clear names: `ffmpeg`, `ffmpegLoaded`, `processingQueue`, `isProcessing`, `processedVideos`
- Local variables in functions use descriptive names: `file`, `blob`, `arrayBuffer`, `uint8Array`, `processedURL`, `outputFileName`
- DOM element queries store result in `*Element` or `*Node` style: `statusText`, `progressBar`, `uploadArea`
- Constants use uppercase: `PORT` (in Python server)

**HTML IDs:**
- Use kebab-case: `uploadArea`, `videoInput`, `progressBar`, `progressText`, `previewSection`, `queueSection`, `processedVideosSection`, `originalVideo`, `processedVideo`
- Pattern: Descriptive of element purpose

**CSS Classes:**
- Use kebab-case: `.upload-area`, `.upload-icon`, `.upload-text`, `.progress-bar`, `.video-container`, `.processed-video-item`, `.processed-videos-grid`
- Pattern: Related components grouped with prefix (e.g., `.upload-*`, `.progress-*`, `.processed-video-*`)

## Where to Add New Code

**New Feature (UI Enhancement):**
- HTML structure: Add elements to `index.html` in appropriate section
- Styling: Add CSS classes to `styles.css` (use existing naming pattern)
- Logic: Add functions to `app.js` following naming convention (e.g., `handleNewFeature()`)
- Event binding: Attach listeners in `initializeUploadHandlers()` or create new initialization function

**New Processing Option (Video Transformation):**
- FFmpeg parameters: Modify encoding settings in `processVideo()` function (lines 363-398)
- UI control: Add input element in `index.html` within appropriate section
- State binding: Connect control to JavaScript variable and apply to FFmpeg command
- Testing: Add test files to verify parameter effects (no test framework currently in place)

**New Utilities:**
- Shared helper functions: Add as module-level or top-level functions in `app.js`
- File-based utilities: Create new `.js` file and import with ES6 `import` statement at top of `app.js`

## Special Directories

**.git/**
- Purpose: Git version control repository
- Generated: Yes, by git init
- Committed: Yes (core metadata only)

**.planning/codebase/**
- Purpose: GSD codebase documentation and analysis
- Generated: Yes, by GSD mapping tools
- Committed: Yes, tracked in git for team reference

## File Dependencies

**app.js** imports:
- `https://esm.sh/@ffmpeg/ffmpeg@0.11.6`: External CDN module for FFmpeg.wasm client
- Requires: `index.html` to load via `<script type="module">` tag

**index.html** imports:
- `styles.css`: Stylesheet dependency
- `app.js`: JavaScript module dependency
- Browser APIs: File API, Blob API, URL API, Web Crypto API, Web Workers (indirectly via FFmpeg)

**server.py** serves:
- Static files from project root
- Sets required CORS and embedding policy headers for FFmpeg.wasm

**wrangler.toml** configures:
- Deployment target: Cloudflare Pages
- Build output: Current directory (no build step)
- Includes: HTTP headers from `_headers` and redirects from `_redirects`

---

*Structure analysis: 2026-02-06*
