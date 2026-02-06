# External Integrations

**Analysis Date:** 2026-02-06

## APIs & External Services

**Video Processing:**
- FFmpeg WebAssembly (@ffmpeg/ffmpeg 0.11.6) - Client-side video encoding
  - SDK: @ffmpeg/ffmpeg via esm.sh CDN
  - No authentication required
  - Module import: `app.js` lines 1-2
  - Core library path: `https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js`
  - Used in `loadFFmpeg()` function (`app.js` lines 18-57) and `processVideo()` function (`app.js` lines 310-471)

**CDN Providers:**
- esm.sh - ES module hosting for @ffmpeg/ffmpeg package
  - URL: `https://esm.sh/@ffmpeg/ffmpeg@0.11.6`
  - No authentication required

- unpkg.com - Distribution network for @ffmpeg/core WebAssembly binary
  - URL: `https://unpkg.com/@ffmpeg/core@0.11.0/dist/`
  - No authentication required

## Data Storage

**Databases:**
- Not applicable - No backend database used

**File Storage:**
- Browser Local Storage Only
  - Temporary: FFmpeg filesystem (virtual in-memory filesystem)
  - Session-based: Video blobs created with `URL.createObjectURL()` (`app.js` lines 275, 439)
  - No persistent storage
  - All processed videos stored in-memory in `processedVideos` array (`app.js` line 77)

**Caching:**
- Browser cache - CDN resources cached by browser
- FFmpeg loaded once per session (`ffmpegLoaded` flag in `app.js` line 16)

## Authentication & Identity

**Auth Provider:**
- Not applicable - No authentication required

**Implementation:**
- Public application - No user accounts or authentication
- Cloudflare Pages deployment may use Cloudflare security, but not explicitly configured

## Monitoring & Observability

**Error Tracking:**
- Not integrated - No external error tracking service
- Client-side error logging via `console.error()` in:
  - `loadFFmpeg()` - `app.js` lines 50-51
  - `handleFile()` - `app.js` lines 291-303
  - `processVideo()` - `app.js` lines 418-428

**Logs:**
- Browser console only
- Console logs at key points:
  - FFmpeg loading progress: `app.js` line 36
  - File processing status: `app.js` lines 260, 313, 317
  - Error details: `app.js` lines 50-51, 419-420
- Sentry, LogRocket, or similar not configured

## CI/CD & Deployment

**Hosting:**
- Cloudflare Pages (primary deployment target per `wrangler.toml` and `DEPLOYMENT.md`)
- Alternative: Any static hosting (GitHub Pages, Netlify, Vercel, etc.)

**CI Pipeline:**
- Configured through Cloudflare Pages GitHub integration
- No explicit CI/CD service configured (GitHub Actions not referenced)
- Deployment method: Direct GitHub repository connection via Cloudflare Dashboard
- Build process: None (static files only)

**Deployment Tools:**
- Wrangler CLI optional for manual deployments
- Command: `npx wrangler pages deploy . --project-name=video-refresher --compatibility-date=2025-11-22`
  - See `package.json` line 9

## Environment Configuration

**Required env vars:**
- None required for production

**Application configuration:**
- Hardcoded in source files:
  - FFmpeg settings: `app.js` lines 32-41, 405-415
  - File size limits: `app.js` lines 262-272
  - Processing queue delays: `app.js` line 193

**Secrets location:**
- Not applicable - No secrets used

## Webhooks & Callbacks

**Incoming:**
- None configured - No webhook endpoints

**Outgoing:**
- None configured - No external API calls to third-party services
- Browser fetch requests only to CDN for FFmpeg resources

## Client-Side Only Architecture

**Key constraint:**
- Entire application runs in browser
- No backend API endpoints
- No server-side processing
- Videos processed entirely locally and never transmitted to external servers
- User privacy preserved - all data stays on user's device

**Processing Flow:**
1. User uploads MP4 file via drag-and-drop or file input (`app.js` lines 80-141)
2. Browser loads FFmpeg WebAssembly from CDN (`app.js` lines 18-57)
3. File processed entirely in browser memory using FFmpeg (`app.js` lines 310-471)
4. Processed video available for download via blob URL (`app.js` lines 512-522)
5. No external API calls made during processing

---

*Integration audit: 2026-02-06*
