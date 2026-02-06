# Testing Patterns

**Analysis Date:** 2026-02-06

## Test Framework

**Runner:**
- Not detected - no test framework configured
- No test dependencies in `package.json`
- No test configuration files (no `jest.config.js`, `vitest.config.js`, etc.)

**Assertion Library:**
- Not used - no testing framework present

**Run Commands:**
- No test scripts defined in `package.json`
- Manual testing approach with browser dev tools

## Test File Organization

**Location:**
- No test files found in codebase
- No `__tests__` directory or `tests` directory structure
- Single monolithic application file (`app.js`) with no test coverage

**Naming:**
- N/A - no tests present

**Structure:**
- N/A - no tests present

## Current Testing State

**Manual Testing Only:**
- Development relies on browser manual testing
- No automated test suite
- Development server: `npm run dev` runs `python3 server.py` (line 6 in package.json)
- Alternative simple server: `npm run dev-simple` runs Python HTTP server

**Browser-Based Application:**
- Code cannot be easily unit tested due to tight DOM coupling
- No test utilities or test helpers present
- Global state (`ffmpeg`, `processingQueue`, `processedVideos`) not isolated for testing

## Challenges for Testing

**DOM Coupling:**
- All functions directly query DOM with `document.getElementById()`: `const statusText = document.getElementById('processingStatus')`
- Side effects deeply integrated with DOM manipulation
- No separation between business logic and presentation

**FFmpeg Integration:**
- FFmpeg loaded from CDN at runtime
- Heavy reliance on external library initialization
- No mocking of FFmpeg in current codebase

**Async Operations:**
- Multiple async operations with interdependencies
- Queue management with timing-dependent state transitions
- Progress callbacks from FFmpeg processing

**Global State:**
- Module-level mutable variables: `let ffmpeg = null`, `let processingQueue = []`, `let isProcessing = false`
- No state management abstraction
- Difficult to test state transitions in isolation

## Recommended Testing Approach

**Unit Testing:**
To add unit testing, functions would need refactoring to:
- Separate pure functions from DOM operations
- Extract file processing logic into testable modules
- Create helper functions for file validation, encoding settings selection
- Pass DOM elements as parameters rather than querying globally

**Integration Testing:**
- Could test file upload workflow with mock file objects
- Test queue processing logic with stubbed FFmpeg
- Verify state transitions during processing

**Example Refactoring for Testability:**

Currently (untestable):
```javascript
function handleMultipleFiles(files) {
    const validFiles = files.filter(file =>
        file.type.startsWith('video/') || file.name.toLowerCase().endsWith('.mp4')
    );

    if (validFiles.length === 0) {
        alert('Please select MP4 video files.');  // DOM side effect
        return;
    }

    validFiles.forEach(file => {
        processingQueue.push(file);  // Global state mutation
    });

    updateQueueUI();  // DOM mutation
    processQueue();   // Async operation
}
```

Would need to become:
```javascript
// Pure function - testable
export function validateVideoFiles(files) {
    return files.filter(file =>
        file.type.startsWith('video/') || file.name.toLowerCase().endsWith('.mp4')
    );
}

// Pure function - testable
export function getEncodingSettings(fileSizeMB) {
    if (fileSizeMB < 30) {
        return { preset: 'fast', crf: '22' };
    }
    // ...
}

// Needs state management abstraction
function handleMultipleFiles(files, onValidationError) {
    const validFiles = validateVideoFiles(files);
    if (validFiles.length === 0) {
        onValidationError('Please select MP4 video files.');
        return;
    }
    // ...
}
```

## Error Handling for Testing

**Current Approach:**
- Errors caught and logged, but no test verification
- User-facing errors passed to UI through `processingStatus.textContent`
- Example error handling (lines 289-304):

```javascript
try {
    await processVideo(file);
} catch (error) {
    console.error('Error processing video:', error);
    let errorMessage = error.message;

    // Specific error message handling
    if (error.message.includes('OOM') || error.message.includes('Out of Memory')) {
        errorMessage = 'Out of Memory: ...';
    } else if (error.message.includes('abort')) {
        errorMessage = 'Processing failed: ...';
    }

    if (processingStatus) {
        processingStatus.textContent = `Error: ${errorMessage}`;
    }
}
```

**Testing Gaps:**
- Error message customization not testable
- Conditional error message logic would benefit from unit tests
- No verification that specific error conditions trigger appropriate UI updates

## Dependencies and Constraints

**No Test Dependencies:**
- Package.json has no dev dependencies
- No testing framework installed
- No test runners configured
- No code coverage tools

**Browser-Only Execution:**
- FFmpeg.wasm requires browser environment
- Shared ArrayBuffer usage requires specific headers (set in `server.py`)
- Cannot run in Node.js test environment without significant mocking

## Logging for Manual Testing

**Console Output:**
- Heavy use of `console.log()` for debugging
- Useful logging points:
  - FFmpeg initialization: `console.log('Creating FFmpeg instance...')`
  - File operations: `console.log('Reading file as array buffer...')`
  - Processing steps: `console.log('Starting FFmpeg processing...')`
  - Progress tracking: `console.log('FFmpeg progress:', progressPercent + '%')`
  - Error details: `console.error('Error details:', error.message, error.stack)`

**Browser DevTools Usage:**
- Developers can observe console logs during manual testing
- Network tab can verify FFmpeg CDN loads correctly
- Can inspect DOM state after operations
- Can set breakpoints in debugger for step-through testing

## Summary

**Current State:** No automated testing framework present

**Barriers to Testing:**
1. Tight DOM coupling throughout application
2. Global mutable state without abstraction
3. External dependency on FFmpeg.wasm (browser-only)
4. No modular separation of concerns
5. Heavy use of side effects in most functions

**Path to Better Testing:**
1. Extract pure functions (validation, settings selection)
2. Implement state management abstraction
3. Separate DOM operations from business logic
4. Add Jest or Vitest configuration for unit tests
5. Create helper modules for testable logic

---

*Testing analysis: 2026-02-06*
