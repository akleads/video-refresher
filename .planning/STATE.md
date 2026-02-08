# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-07)

**Core value:** Upload video creatives, get multiple unique variations ready for ad platform rotation -- fast, without waiting at the screen.
**Current focus:** Phase 9 - Frontend Integration

## Current Position

Phase: 9 of 9 (Frontend Integration) -- fourth phase of v2.0 milestone
Plan: 0 of TBD in current phase
Status: Ready to plan
Last activity: 2026-02-07 -- Phase 8 complete, verified (10/10 must-haves)

Progress: [█████████-] 94% (16 of 17 plans complete)

## Performance Metrics

**v1.0 Velocity (reference):**
- Total plans completed: 8
- Average duration: 4.8 min
- Total execution time: 0.64 hours

**v2.0 Velocity:**
- Total plans completed: 8
- Average duration: 2.1 min
- Phases: 6-9 (4 phases, Phase 6 done with 3 plans, Phase 7 done with 3 plans, Phase 8 done with 2 plans)

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

### Pending Todos

None yet.

### Blockers/Concerns

- FFmpeg filter parity: native FFmpeg 7.x may differ from FFmpeg.wasm (5-6.x). Needs testing in Phase 8 API integration.
- Deployed FFmpeg version is 5.1.8 (Debian bookworm), not 7.x — may reduce filter parity concerns.

**Phase 7 Complete:** Processing engine, queue worker, recovery, and process management all implemented.

**Phase 8 Complete:** Download endpoint, cleanup daemon, and full job lifecycle management (creation → processing → download → expiry/eviction).

## Session Continuity

Last session: 2026-02-07
Stopped at: Phase 8 complete, verified (10/10 must-haves)
Resume file: None
Next: Plan Phase 9 (Frontend Integration)
