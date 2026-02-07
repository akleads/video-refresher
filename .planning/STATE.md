# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-07)

**Core value:** Upload video creatives, get multiple unique variations ready for ad platform rotation -- fast, without waiting at the screen.
**Current focus:** Phase 7 - FFmpeg Processing Engine

## Current Position

Phase: 7 of 9 (FFmpeg Processing Engine) -- second phase of v2.0 milestone
Plan: 0 of TBD in current phase
Status: Ready to plan
Last activity: 2026-02-07 -- Phase 6 complete, verified, deployed to Fly.io

Progress: [=======---] 69% (11 of 16 plans complete)

## Performance Metrics

**v1.0 Velocity (reference):**
- Total plans completed: 8
- Average duration: 4.8 min
- Total execution time: 0.64 hours

**v2.0 Velocity:**
- Total plans completed: 3
- Average duration: 3.2 min
- Phases: 6-9 (4 phases, Phase 6 done with 3 plans)

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
- Deployed FFmpeg version is 5.1.8 (Debian bookworm), not 7.x — may reduce filter parity concerns.

## Session Continuity

Last session: 2026-02-07
Stopped at: Phase 6 complete, all 3 plans executed, verified (17/17 must-haves), deployed to Fly.io
Resume file: None
Next: Plan Phase 7 (FFmpeg Processing Engine)
