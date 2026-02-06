# Technology Stack

**Analysis Date:** 2026-02-06

## Languages

**Primary:**
- JavaScript (ES6 Modules) - Client-side application logic in `app.js`
- HTML5 - Markup in `index.html`
- CSS3 - Styling in `styles.css` with modern gradients and animations

**Secondary:**
- Python 3 - Development server in `server.py` (required for local testing with SharedArrayBuffer headers)

## Runtime

**Environment:**
- Web browser (client-side execution only)
- Requires modern browser with WebAssembly support
- Compatible: Chrome, Firefox, Edge, Safari (latest versions)

**Package Manager:**
- npm - Specified in `package.json`
- Lockfile: `package-lock.json` (in .gitignore, not committed)

## Frameworks

**Core:**
- ffmpeg.wasm 0.11.6 - Video processing library loaded from esm.sh CDN
  - Source: `https://esm.sh/@ffmpeg/ffmpeg@0.11.6` (see `app.js` line 3)
  - Core library: `https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js` (see `app.js` line 40)
  - Purpose: Browser-based FFmpeg for client-side video processing

**Build/Dev:**
- Wrangler 2+ - Cloudflare Pages deployment tool (optional, see `wrangler.toml`)

## Key Dependencies

**Critical:**
- @ffmpeg/ffmpeg 0.11.6 - Core video processing; loaded dynamically from CDN
  - Used in `app.js` for `createFFmpeg` and `fetchFile` imports
  - Loads WebAssembly runtime from unpkg CDN
- No npm dependencies installed - all external code loaded via CDN (esm.sh, unpkg)

**Infrastructure:**
- No backend server required - purely static files
- HTTP server capabilities: Python's `http.server` with custom CORS headers (for development)

## Configuration

**Environment:**
- No environment variables required for production
- Wrangler configuration: `wrangler.toml`
  - Project name: `video-refresher`
  - Compatibility date: `2025-11-22`
  - Build output directory: `.` (root)
- Application settings hardcoded in source:
  - File size limit warning: 100MB in `app.js` line 262
  - Processing queue timeout: 500ms between files in `app.js` line 193
  - Encoding presets vary by file size in `app.js` lines 368-398

**Build:**
- No build step required - static files deployment
- `npm run build` is a no-op per `package.json` line 8

## Platform Requirements

**Development:**
- Python 3 (for `server.py` local development server)
- Node.js (npm, for running deployment scripts via Wrangler)
- Modern web browser
- Required headers for local testing:
  - `Cross-Origin-Opener-Policy: same-origin`
  - `Cross-Origin-Embedder-Policy: require-corp`
  - These are set in `server.py` lines 14-15 to enable SharedArrayBuffer

**Production:**
- Cloudflare Pages hosting (or any static hosting provider)
- CDN access required:
  - esm.sh for @ffmpeg/ffmpeg module
  - unpkg.com for @ffmpeg/core WebAssembly binary
- Static file serving with HTTP/2 support

## CDN Dependencies

**Required external resources:**
- `https://esm.sh/@ffmpeg/ffmpeg@0.11.6` - ffmpeg.wasm module
- `https://unpkg.com/@ffmpeg/core@0.11.0/dist/` - FFmpeg WebAssembly runtime and worker files

These are loaded on-demand when user uploads a video, not at application startup.

---

*Stack analysis: 2026-02-06*
