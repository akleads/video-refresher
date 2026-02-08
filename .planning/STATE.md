# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-07)

**Core value:** Upload video creatives, get multiple unique variations ready for ad platform rotation -- fast, without waiting at the screen.
**Current focus:** Phase 9 - Frontend Integration

## Current Position

Phase: 9 of 9 (Frontend Integration) -- fourth phase of v2.0 milestone
Plan: 3 of 4 in current phase
Status: In progress
Last activity: 2026-02-07 -- Completed 09-03-PLAN.md (Job Tracking Views)

Progress: [█████████-] 100% (19 of 19 plans complete)

## Performance Metrics

**v1.0 Velocity (reference):**
- Total plans completed: 8
- Average duration: 4.8 min
- Total execution time: 0.64 hours

**v2.0 Velocity:**
- Total plans completed: 11
- Average duration: 2.2 min
- Phases: 6-9 (4 phases, Phase 6 done with 3 plans, Phase 7 done with 3 plans, Phase 8 done with 2 plans, Phase 9: 3 of 4)

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

| ID | Decision | Phase | Rationale |
|----|----------|-------|-----------|
| v2.0-init-01 | Use 3GB Fly Volume (not 1GB) | 06 | Peak batch usage ~1.28GB |
| v2.0-init-02 | Use node:22-slim Docker base (not Alpine) | 06 | better-sqlite3 native addon needs glibc |
| v2.0-init-03 | Use child_process.spawn for FFmpeg | 06 | fluent-ffmpeg archived May 2025 |
| v2.0-init-04 | Set min_machines_running = 1 | 06 | Prevents auto-stop mid-processing |
| v2.0-init-05 | All file I/O on Fly Volume (/data/) | 06 | /tmp is RAM disk on Fly.io |
| 06-01-esm | Use "type": "module" for server package | 06-01 | nanoid 5 ESM-only, Node.js 22 best practice |
| 06-01-hmac | HMAC tokens instead of JWT | 06-01 | No external claims needed, simpler, zero deps |
| 06-01-wal | Enable SQLite WAL mode | 06-01 | Concurrent reads during writes, prevents SQLITE_BUSY |
| 06-01-local | Use ./data for local dev | 06-01 | No Fly Volume locally, fallback to relative path |
| 06-02-disk | Multer DiskStorage to UPLOAD_DIR | 06-02 | Direct to Fly Volume, avoids /tmp RAM disk |
| 06-02-clamp | Variations clamped to 1-20 range | 06-02 | Prevents resource exhaustion from excessive variations |
| 06-02-factory | Factory function for jobs router | 06-02 | Dependency injection for db and queries |
| 07-01-pid | Store FFmpeg pid in SQLite | 07-01 | Enables zombie process cleanup on restart |
| 07-01-probe | Return 0 from getVideoDuration on failure | 07-01 | Allows encoding without progress tracking |
| 07-01-stderr | Collect last 20 stderr lines for errors | 07-01 | Debug context without full log storage |
| 07-01-migrate | try/catch for idempotent schema migrations | 07-01 | SQLite lacks ALTER IF NOT EXISTS |
| 07-02-partial | Job 'completed' if any file succeeds | 07-02 | Batch processing delivers partial results |
| 07-02-immediate | setImmediate for rapid back-to-back jobs | 07-02 | Process queue continuously without delay |
| 07-02-throttle | Progress updates throttled to 2% increments | 07-02 | Balance responsiveness with DB write efficiency |
| 07-03-startup | Worker starts after recovery runs | 07-03 | Ensures DB ready and stuck jobs cleaned before processing |
| 07-03-sigkill | Orphaned processes use SIGKILL, active use SIGTERM | 07-03 | Orphans have no parent for signal forwarding |
| 07-03-progress | Overall progress as average of file progress | 07-03 | Simple calculation, meaningful UX |
| 08-01-store | Use archiver { store: true } for ZIPs | 08-01 | STORE method prevents re-compression of H.264 |
| 08-01-folders | Organize ZIP by source video name folders | 08-01 | Groups variations by original filename |
| 08-01-cleanup | Best-effort upload cleanup after processing | 08-01 | Log errors, don't fail jobs on cleanup issues |
| 08-02-interval | 5-minute cleanup interval | 08-02 | Balances responsiveness with CPU overhead |
| 08-02-threshold | 85% eviction threshold | 08-02 | Provides buffer before hitting 3GB volume limit |
| 08-02-stuck | Mark stuck queued jobs failed before expiry | 08-02 | Prevents orphaned queued jobs past expiry |
| 08-02-datadir | Pass DATA_DIR to CleanupDaemon for statfsSync | 08-02 | Volume mount point needed for accurate disk stats |
| 09-01-api-url | API base URL by hostname (localhost:8080 or Fly.io) | 09-01 | Auto-detect dev vs production environment |
| 09-01-xhr | XHR for file uploads (not fetch) | 09-01 | Enables upload progress events via xhr.upload |
| 09-01-auth-guard | Router auth guard redirects to login if no token | 09-01 | Protects all routes except login/empty hash |
| 09-01-nav-toggle | Nav hidden on login, visible on auth views | 09-01 | Clean login UX, persistent nav for logged-in users |
| 09-02-dom | Use createElement for all DOM (no innerHTML) | 09-02 | Prevents XSS vulnerabilities in user-facing views |
| 09-02-inline-errors | Inline error messages (not alerts) | 09-02 | Better UX, preserves context, allows error recovery |
| 09-02-file-warnings | File size warnings at 100MB threshold | 09-02 | Inform users about potentially slow uploads |
| 09-03-adaptive | Adaptive polling for job detail (2s → 10s backoff) | 09-03 | Active monitoring needs faster updates, backs off to reduce load |
| 09-03-visibility | Page Visibility API pauses polling when tab hidden | 09-03 | Battery and bandwidth efficiency for background tabs |
| 09-03-blob | Blob URL download with 1s revocation delay | 09-03 | Clean file downloads without memory leaks |
| 09-03-expiry | Expired jobs = createdAt + 24h < now | 09-03 | Matches server cleanup daemon threshold |

### Pending Todos

None yet.

### Blockers/Concerns

- FFmpeg filter parity: native FFmpeg 7.x may differ from FFmpeg.wasm (5-6.x). Needs testing in Phase 8 API integration.
- Deployed FFmpeg version is 5.1.8 (Debian bookworm), not 7.x — may reduce filter parity concerns.

**Phase 7 Complete:** Processing engine, queue worker, recovery, and process management all implemented.

**Phase 8 Complete:** Download endpoint, cleanup daemon, and full job lifecycle management (creation → processing → download → expiry/eviction).

**Phase 9 Progress (3 of 4):** SPA infrastructure, login/upload views, and job tracking views complete. Final plan (09-04) will integrate all views.

## Session Continuity

Last session: 2026-02-07
Stopped at: Completed 09-03-PLAN.md (Job Tracking Views)
Resume file: None
Next: Execute 09-04-PLAN.md (Final Integration)
