# Phase 5: ZIP Download - Research

**Researched:** 2026-02-06
**Domain:** Browser-based ZIP file generation
**Confidence:** MEDIUM

## Summary

Browser-based ZIP file creation has matured significantly with multiple library options. For this use case (packaging 5-20 video files as a single download), JSZip 3.10.1 is the established standard with proven stability and wide adoption (13M+ weekly downloads). The key requirement—STORE compression (no re-compression)—is well-supported and critical for video files that are already compressed.

The technical approach involves collecting blob URLs from the processedVideos array, adding each video blob to a JSZip instance with STORE compression, generating the final ZIP as a blob, triggering download via anchor tag, and cleaning up all blob URLs afterward. Memory management is the primary concern given browser constraints.

**Primary recommendation:** Use JSZip 3.10.1 with STORE compression, generate as blob output type, implement careful blob URL cleanup to prevent memory leaks, and provide clear UI feedback during ZIP generation.

## Standard Stack

The established libraries/tools for browser ZIP creation:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| JSZip | 3.10.1 | Create/read/edit ZIP files in browser | Industry standard with 10.3k GitHub stars, 5706 dependent packages, mature API since 2009 |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| FileSaver.js | Latest | Trigger file downloads cross-browser | Optional helper for download trigger (can use vanilla anchor method) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| JSZip | client-zip 2.5.0 | Faster (40% vs 40x slower than native), smaller (2.6KB vs ~10KB), but streaming-only (no STORE on existing blobs), requires Response objects |
| JSZip | fflate | Better performance, smaller bundle (8KB), but lower-level API, requires manual ZIP structure management |
| JSZip | zip.js | More advanced features (streaming, Web Workers), but callback-based API is less ergonomic than JSZip's Promise-based approach |

**Installation:**
```bash
# JSZip via CDN (no npm in this static site project)
# Already using CDN pattern for FFmpeg.wasm
```

**CDN Import:**
```javascript
import JSZip from 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm';
```

## Architecture Patterns

### Recommended Implementation Flow

```
User clicks "Download All as ZIP"
    ↓
Show progress indicator / disable button
    ↓
Create new JSZip() instance
    ↓
For each video in processedVideos array:
    - Fetch blob from processedVideos[i].processedURL
    - Add to zip with STORE compression
    - Use processedVideos[i].filename
    ↓
Generate ZIP as blob (type: "blob")
    ↓
Create blob URL for ZIP
    ↓
Create anchor tag with download attribute
    ↓
Trigger click to download
    ↓
Cleanup: revoke ZIP blob URL
    ↓
Cleanup: revoke all variation blob URLs
    ↓
Clear processedVideos array
    ↓
Hide ZIP download button
```

### Pattern 1: Adding Files with STORE Compression
**What:** Add pre-compressed video blobs without re-compression
**When to use:** Always for video files (already compressed with H.264/H.265)
**Example:**
```javascript
// Source: https://stuk.github.io/jszip/documentation/api_jszip/file_data.html
const zip = new JSZip();

// Add each video with STORE compression (no re-compression)
for (const video of processedVideos) {
    // Fetch blob from blob URL
    const response = await fetch(video.processedURL);
    const blob = await response.blob();

    // Add to ZIP with STORE compression
    zip.file(video.filename, blob, {
        compression: "STORE"  // Critical: no re-compression of video data
    });
}
```

### Pattern 2: Generate ZIP as Blob
**What:** Generate final ZIP file in memory as a Blob
**When to use:** For all browser-based ZIP downloads
**Example:**
```javascript
// Source: https://stuk.github.io/jszip/documentation/api_jszip/generate_async.html
const zipBlob = await zip.generateAsync({
    type: "blob",
    compression: "STORE",  // Default for unspecified files
    streamFiles: false     // false = more compatible, true = less memory
});
```

### Pattern 3: Trigger Download and Cleanup
**What:** Create temporary anchor tag to trigger download, then cleanup
**When to use:** Standard pattern for programmatic file downloads
**Example:**
```javascript
// Source: https://dev.to/nombrekeff/download-file-from-blob-21ho
// Create blob URL for ZIP
const zipURL = URL.createObjectURL(zipBlob);

// Create temporary anchor and trigger download
const anchor = document.createElement('a');
anchor.href = zipURL;
anchor.download = `${baseFilename}_variations.zip`;
document.body.appendChild(anchor);
anchor.click();
document.body.removeChild(anchor);

// Cleanup ZIP blob URL (can be immediate after click)
URL.revokeObjectURL(zipURL);

// Cleanup variation blob URLs
processedVideos.forEach(video => {
    blobRegistry.revoke(video.processedURL);
});

// Clear the array
processedVideos = [];
```

### Pattern 4: Progress Feedback During Generation
**What:** Use onUpdate callback to show ZIP generation progress
**When to use:** For larger batches (10+ files) to provide user feedback
**Example:**
```javascript
// Source: https://stuk.github.io/jszip/documentation/api_jszip/generate_async.html
const zipBlob = await zip.generateAsync({
    type: "blob",
    compression: "STORE"
}, function updateCallback(metadata) {
    // metadata.percent: 0-100
    // metadata.currentFile: filename being processed
    updateProgress(metadata.percent, `Creating ZIP: ${Math.round(metadata.percent)}%`);
});
```

### Anti-Patterns to Avoid
- **Using DEFLATE compression on videos:** Videos are already compressed; re-compressing with DEFLATE wastes CPU time and provides no size benefit
- **Forgetting blob URL cleanup:** Creates memory leaks; blob URLs persist until explicitly revoked or page unload
- **Generating ZIP synchronously:** Will freeze the browser UI; always use generateAsync()
- **Not providing feedback:** ZIP generation can take 5-10 seconds for 20 videos; users need progress indication

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ZIP file format structure | Custom binary manipulation | JSZip | ZIP format is complex: local headers, central directory, end-of-central-directory record, CRC32 checksums, etc. |
| Cross-browser download triggering | Browser-specific APIs | Anchor tag with download attribute | Modern browsers support this consistently; FileSaver.js polyfills older browsers if needed |
| Blob URL lifecycle management | Manual tracking in variables | BlobURLRegistry class (already exists) | Easy to miss cleanup cases; centralized registry prevents leaks |
| Progress tracking during ZIP creation | Custom events | JSZip's built-in onUpdate callback | Already integrated with JSZip's generation pipeline |

**Key insight:** ZIP file format has many edge cases (Zip64 for large files, data descriptors, compression methods, CRC32 validation). JSZip handles these correctly after 15+ years of development.

## Common Pitfalls

### Pitfall 1: Memory Exhaustion from Large Batches
**What goes wrong:** Attempting to ZIP 20 large video files (50MB+ each) crashes browser with "Out of Memory" error
**Why it happens:** JSZip's default mode holds entire ZIP in memory. With 20 × 50MB = 1GB of video data, plus ZIP overhead, browser hits memory limit
**How to avoid:**
- Document limitation: "ZIP download supports up to 20 variations with total size under 500MB"
- Use `streamFiles: true` option to reduce memory footprint (trades compatibility for memory)
- Consider limiting batch size further on mobile devices
**Warning signs:** Browser becomes unresponsive during ZIP generation; console shows memory warnings

### Pitfall 2: Incomplete Blob URL Cleanup
**What goes wrong:** Blob URLs remain in memory after ZIP download completes, causing memory leak that grows with each batch
**Why it happens:** There's a known browser bug where `revokeObjectURL()` doesn't free memory if blob was used in download. Even calling revoke after download completes may not release memory in some browsers (especially Firefox)
**How to avoid:**
- Call `revokeObjectURL()` on all variation blob URLs after ZIP generation (not just after download)
- Call `revokeObjectURL()` on ZIP blob URL after download click
- Clear processedVideos array after successful ZIP download
- Rely on beforeunload event as final safety net (already implemented)
**Warning signs:** Browser memory usage increases with each batch; developer tools show growing number of blob: URLs

### Pitfall 3: Forgetting STORE Compression Per-File
**What goes wrong:** Setting `compression: "STORE"` only in generateAsync() doesn't prevent per-file compression if files were added with default options
**Why it happens:** File-level compression options override generateAsync() defaults. If you add files without specifying compression, they might use DEFLATE
**How to avoid:** Explicitly set `compression: "STORE"` when adding each file via zip.file()
**Warning signs:** ZIP generation takes much longer than expected; high CPU usage during generation; ZIP file size doesn't match sum of input files

### Pitfall 4: Timing of Blob URL Revocation
**What goes wrong:** Calling `URL.revokeObjectURL(zipURL)` immediately after `anchor.click()` causes download to fail in some browsers
**Why it happens:** Download may not start synchronously; browser needs time to begin fetch
**How to avoid:** Wait a small delay (100-500ms) before revoking ZIP blob URL, or rely on beforeunload cleanup
**Warning signs:** ZIP download works inconsistently across browsers; download fails silently

### Pitfall 5: UTF-8 Filename Encoding
**What goes wrong:** Non-ASCII characters in filenames (e.g., "vidéo_var1.mp4") appear garbled when ZIP is extracted
**Why it happens:** JSZip only supports UTF-8 natively; some ZIP tools expect different encodings
**How to avoid:** Sanitize filenames to ASCII-only characters, or ensure consistent UTF-8 encoding across tools
**Warning signs:** User reports seeing mojibake (garbled text) in extracted filenames

## Code Examples

Verified patterns from official sources:

### Complete ZIP Download Implementation
```javascript
// Source: Synthesized from https://stuk.github.io/jszip/documentation/examples.html
async function downloadAllAsZip() {
    if (processedVideos.length === 0) {
        alert('No variations to download');
        return;
    }

    const downloadBtn = document.getElementById('downloadAllBtn');
    const statusText = document.getElementById('zipStatus');

    try {
        // Disable button and show progress
        downloadBtn.disabled = true;
        statusText.textContent = 'Preparing ZIP...';
        statusText.style.display = 'block';

        // Create ZIP instance
        const zip = new JSZip();

        // Add each video with STORE compression
        for (let i = 0; i < processedVideos.length; i++) {
            const video = processedVideos[i];
            statusText.textContent = `Adding ${i + 1}/${processedVideos.length} files...`;

            // Fetch blob from blob URL
            const response = await fetch(video.processedURL);
            const blob = await response.blob();

            // Add to ZIP with no compression
            zip.file(video.filename, blob, {
                compression: "STORE"
            });
        }

        // Generate ZIP with progress callback
        const zipBlob = await zip.generateAsync({
            type: "blob",
            compression: "STORE"
        }, function(metadata) {
            const percent = Math.round(metadata.percent);
            statusText.textContent = `Creating ZIP: ${percent}%`;
        });

        // Create download
        const zipURL = URL.createObjectURL(zipBlob);
        const anchor = document.createElement('a');
        anchor.href = zipURL;

        // Use base filename from first variation
        const baseName = processedVideos[0].filename.split('_var')[0];
        anchor.download = `${baseName}_all_variations.zip`;

        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);

        // Cleanup after short delay
        setTimeout(() => {
            URL.revokeObjectURL(zipURL);
        }, 500);

        // Cleanup all variation blob URLs
        processedVideos.forEach(video => {
            blobRegistry.revoke(video.processedURL);
        });
        processedVideos = [];

        statusText.textContent = 'ZIP downloaded! All variations cleared.';
        setTimeout(() => {
            statusText.style.display = 'none';
        }, 3000);

    } catch (error) {
        console.error('ZIP download failed:', error);
        statusText.textContent = `Error: ${error.message}`;
    } finally {
        downloadBtn.disabled = false;
    }
}
```

### Memory-Efficient Version with StreamFiles
```javascript
// Source: https://stuk.github.io/jszip/documentation/api_jszip/generate_async.html
// For larger batches, trade compatibility for memory efficiency
const zipBlob = await zip.generateAsync({
    type: "blob",
    compression: "STORE",
    streamFiles: true  // Uses less memory but data descriptors (may not work in all ZIP tools)
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Server-side ZIP generation | Client-side with JSZip | ~2015 | Eliminates server load, instant download, privacy (files stay local) |
| Synchronous generate() | Async generateAsync() | JSZip 3.0.0 (2016) | Non-blocking UI, progress callbacks, better UX |
| Individual file downloads | Batch ZIP download | Modern practice (2020+) | Single download instead of 20 clicks, better UX at scale |
| FileSaver.js required | Native download attribute | Modern browsers (2018+) | One less dependency, simpler code |

**Deprecated/outdated:**
- `JSZip.generate()` (sync method): Removed in v3.0.0; replaced by generateAsync()
- `JSZipUtils.getBinaryContent()`: Use fetch() API instead
- `new JSZip(data)` constructor: Use JSZip.loadAsync(data) instead

## Open Questions

Things that couldn't be fully resolved:

1. **Optimal streamFiles default**
   - What we know: streamFiles: true reduces memory by ~30-50%, uses data descriptors
   - What's unclear: Which ZIP extraction tools don't support data descriptors in 2026? Windows Explorer support?
   - Recommendation: Start with streamFiles: false (maximum compatibility), add toggle for advanced users if memory issues reported

2. **Browser memory limits for ZIP generation**
   - What we know: 10MB compressed ZIP works reliably; 1GB+ can crash browsers
   - What's unclear: Exact memory limits vary by browser and device (desktop vs mobile)
   - Recommendation: Document soft limit of 500MB total video data; consider detecting available memory if Web APIs permit

3. **Timing of ZIP blob URL revocation**
   - What we know: Immediate revocation after click fails in some browsers; delay works
   - What's unclear: Minimum safe delay (100ms? 500ms? 1000ms?)
   - Recommendation: Use 500ms delay as conservative default; rely on beforeunload as safety net

## Sources

### Primary (HIGH confidence)
- JSZip Official Docs: https://stuk.github.io/jszip/documentation/api_jszip/generate_async.html
- JSZip Official Docs: https://stuk.github.io/jszip/documentation/api_jszip/file_data.html
- JSZip Limitations: https://stuk.github.io/jszip/documentation/limitations.html
- MDN URL.revokeObjectURL(): https://developer.mozilla.org/en-US/docs/Web/API/URL/revokeObjectURL_static

### Secondary (MEDIUM confidence)
- [Create Zip archives in the browser with Jszip | Transloadit](https://transloadit.com/devtips/create-zip-archives-in-the-browser-with-jszip/)
- [Download Any File from Blob - DEV Community](https://dev.to/nombrekeff/download-file-from-blob-21ho)
- [JSZip GitHub Repository](https://github.com/Stuk/jszip)
- [client-zip GitHub Repository](https://github.com/Touffy/client-zip)
- [fflate GitHub Repository](https://github.com/101arrowz/fflate)

### Tertiary (LOW confidence)
- [WebSearch: JSZip best practices 2026](https://www.cjoshmartin.com/blog/creating-zip-files-with-javascript)
- [WebSearch: Browser blob URL cleanup issues](https://bugzilla.mozilla.org/show_bug.cgi?id=939510)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - JSZip is industry standard with 15+ years of development, extensive documentation
- Architecture: HIGH - Patterns verified from official JSZip documentation and MDN
- Pitfalls: MEDIUM - Memory issues and blob cleanup documented in GitHub issues; streamFiles behavior verified from official docs; timing issues based on community reports

**Research date:** 2026-02-06
**Valid until:** ~60 days (stable library, infrequent updates - last release 4 years ago per npm)
