# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-07)

**Core value:** Upload video creatives, get multiple unique variations ready for ad platform rotation -- fast, without waiting at the screen.
**Current focus:** Phase 6 - Backend Foundation

## Current Position

Phase: 6 of 9 (Backend Foundation) -- first phase of v2.0 milestone
Plan: 2 of 3 in current phase
Status: In progress
Last activity: 2026-02-07 -- Completed 06-02-PLAN.md

Progress: [=======---] 69% (9 of 13+ plans complete)

## Performance Metrics

**v1.0 Velocity (reference):**
- Total plans completed: 8
- Average duration: 4.8 min
- Total execution time: 0.64 hours

**v2.0 Velocity:**
- Total plans completed: 2
- Average duration: 2.3 min
- Phases: 6-9 (4 phases, 3+ plans known)

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

### Pending Todos

None yet.

### Blockers/Concerns

- FFmpeg filter parity: native FFmpeg 7.x may differ from FFmpeg.wasm (5-6.x). Needs testing in Phase 7.

## Session Continuity

Last session: 2026-02-07 20:09 UTC
Stopped at: Completed 06-02-PLAN.md (Jobs API with multi-file upload, job status/list queries)
Resume file: None
Next: 06-03-PLAN.md (Deployment with Dockerfile and fly.toml)
