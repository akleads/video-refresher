import { FFmpeg } from 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.14/+esm';
import { fetchFile, toBlobURL } from 'https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.2/+esm';

function supportsMultiThreading() {
    return typeof SharedArrayBuffer !== 'undefined' && crossOriginIsolated === true;
}

// Generate unique identifier (same as original script)
function generateUniqueID() {
    const array = new Uint8Array(3);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

// Blob URL lifecycle management
class BlobURLRegistry {
    constructor() {
        this.urls = new Map();
    }

    register(blob, metadata = {}) {
        const url = URL.createObjectURL(blob);
        this.urls.set(url, {
            ...metadata,
            created: new Date().toISOString()
        });
        return url;
    }

    revoke(url) {
        if (this.urls.has(url)) {
            URL.revokeObjectURL(url);
            this.urls.delete(url);
        }
    }

    revokeAll() {
        for (const url of this.urls.keys()) {
            URL.revokeObjectURL(url);
        }
        this.urls.clear();
    }
}

const blobRegistry = new BlobURLRegistry();

// Revoke all blob URLs before page unload
window.addEventListener('beforeunload', () => blobRegistry.revokeAll());

// Track current original video URL for revocation
let currentOriginalURL = null;

// Initialize FFmpeg
let ffmpeg = null;
let ffmpegLoaded = false;
let isMultiThreaded = false;

async function loadFFmpeg() {
    if (ffmpegLoaded) {
        console.log('FFmpeg already loaded');
        return;
    }

    const statusText = document.getElementById('processingStatus');
    if (statusText) {
        statusText.textContent = 'Loading FFmpeg... This may take a moment.';
    }

    try {
        console.log('Creating FFmpeg instance...');
        ffmpeg = new FFmpeg();

        // Event-based progress (replaces callback in 0.11.x)
        ffmpeg.on('progress', ({ progress, time }) => {
            // Clamp progress to 0-1 range (known bug: can return negative values)
            const clampedProgress = Math.max(0, Math.min(1, progress));
            const progressPercent = Math.round(clampedProgress * 100);
            console.log('FFmpeg progress:', progressPercent + '%');
            updateProgress(progressPercent, `Processing... ${progressPercent}%`);
        });

        ffmpeg.on('log', ({ message }) => {
            console.log('FFmpeg:', message);
        });

        // Detect SharedArrayBuffer support for multi-threading
        isMultiThreaded = supportsMultiThreading();
        const coreType = isMultiThreaded ? 'multi-threaded' : 'single-threaded';
        console.log(`Loading FFmpeg (${coreType})...`);

        const baseURL = isMultiThreaded
            ? 'https://cdn.jsdelivr.net/npm/@ffmpeg/core-mt@0.12.10/dist/esm'
            : 'https://cdn.jsdelivr.net/npm/@ffmpeg/core-st@0.12.10/dist/esm';

        const loadConfig = {
            coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
            wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
            classWorkerURL: new URL('./ffmpeg-worker.js', import.meta.url).href,
        };

        // Multi-threaded requires worker file
        if (isMultiThreaded) {
            loadConfig.workerURL = await toBlobURL(`${baseURL}/ffmpeg-core.worker.js`, 'text/javascript');
        }

        console.log('Loading FFmpeg core...');
        await ffmpeg.load(loadConfig);

        ffmpegLoaded = true;
        console.log(`FFmpeg loaded successfully (${coreType})`);
    } catch (error) {
        console.error('Error loading FFmpeg:', error);
        console.error('Error details:', error.message, error.stack);

        // If multi-threaded loading failed, try single-threaded fallback
        if (isMultiThreaded) {
            console.warn('Multi-threaded loading failed, falling back to single-threaded...');
            isMultiThreaded = false;
            try {
                const stBaseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core-st@0.12.10/dist/esm';
                await ffmpeg.load({
                    coreURL: await toBlobURL(`${stBaseURL}/ffmpeg-core.js`, 'text/javascript'),
                    wasmURL: await toBlobURL(`${stBaseURL}/ffmpeg-core.wasm`, 'application/wasm'),
                    classWorkerURL: new URL('./ffmpeg-worker.js', import.meta.url).href,
                });
                ffmpegLoaded = true;
                console.log('FFmpeg loaded successfully (single-threaded fallback)');
                return;
            } catch (fallbackError) {
                console.error('Single-threaded fallback also failed:', fallbackError);
            }
        }

        if (statusText) {
            statusText.textContent = `Error loading FFmpeg: ${error.message}. Please refresh the page.`;
        }
        throw error;
    }
}

// Recover FFmpeg instance after corruption
async function recoverFFmpeg() {
    console.warn('FFmpeg instance corrupted, recovering...');

    // Mark as unloaded
    ffmpegLoaded = false;

    // Create new instance
    ffmpeg = new FFmpeg();

    // Re-attach event handlers (same as in loadFFmpeg)
    ffmpeg.on('progress', ({ progress, time }) => {
        // Clamp progress to 0-1 range (known bug: can return negative values)
        const clampedProgress = Math.max(0, Math.min(1, progress));
        const progressPercent = Math.round(clampedProgress * 100);
        console.log('FFmpeg progress:', progressPercent + '%');
        updateProgress(progressPercent, `Processing... ${progressPercent}%`);
    });

    ffmpeg.on('log', ({ message }) => {
        console.log('FFmpeg:', message);
    });

    // Reload FFmpeg core
    await loadFFmpeg();

    console.log('FFmpeg recovered successfully');
}

// Update progress bar
function updateProgress(percent, text) {
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    
    if (progressBar) {
        progressBar.style.width = `${percent}%`;
    }
    if (progressText) {
        progressText.textContent = text;
    }
}

// Queue for processing multiple files
let processingQueue = [];
let isProcessing = false;

// Store all processed videos (bounded to prevent unbounded memory growth)
const MAX_PROCESSED_VIDEOS = 20;
let processedVideos = [];

// Add processed video with automatic eviction when limit reached
function addProcessedVideo(videoInfo) {
    processedVideos.push(videoInfo);

    if (processedVideos.length > MAX_PROCESSED_VIDEOS) {
        const evicted = processedVideos.shift();
        blobRegistry.revoke(evicted.processedURL);
        console.log('Evicted oldest processed video, revoked blob URL');
    }

    updateProcessedVideosList();
}

// Initialize event listeners when DOM is ready
function initializeUploadHandlers() {
    // Handle file upload
    const uploadArea = document.getElementById('uploadArea');
    const videoInput = document.getElementById('videoInput');
    
    if (!uploadArea || !videoInput) {
        console.error('Required DOM elements not found');
        return;
    }
    
    // Click handler to trigger file input - fixed
    uploadArea.addEventListener('click', (e) => {
        // Only trigger if clicking on the upload area itself, not its children
        if (e.target === uploadArea || e.target.closest('.upload-area')) {
            e.stopPropagation();
            videoInput.click();
        }
    });
    
    // Prevent default drag behaviors
    uploadArea.addEventListener('dragenter', (e) => {
        e.preventDefault();
        e.stopPropagation();
        uploadArea.classList.add('dragover');
    });
    
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        uploadArea.classList.add('dragover');
    });
    
    uploadArea.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Only remove if leaving the upload area, not entering a child element
        if (!uploadArea.contains(e.relatedTarget)) {
            uploadArea.classList.remove('dragover');
        }
    });
    
    // Drop handler - support multiple files
    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        uploadArea.classList.remove('dragover');
        
        const files = Array.from(e.dataTransfer.files);
        handleMultipleFiles(files);
    });
    
    // File input change handler - support multiple files
    videoInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
            const files = Array.from(e.target.files);
            handleMultipleFiles(files);
            // Reset input to allow selecting same files again
            e.target.value = '';
        }
    });
    
    console.log('Upload handlers initialized successfully');
}

// Handle multiple files
function handleMultipleFiles(files) {
    const validFiles = files.filter(file => 
        file.type.startsWith('video/') || file.name.toLowerCase().endsWith('.mp4')
    );
    
    if (validFiles.length === 0) {
        alert('Please select MP4 video files.');
        return;
    }
    
    if (validFiles.length !== files.length) {
        alert(`Selected ${files.length} file(s), but only ${validFiles.length} are valid MP4 files.`);
    }
    
    // Add files to queue
    validFiles.forEach(file => {
        processingQueue.push(file);
    });
    
    // Update queue UI
    updateQueueUI();
    
    // Process queue
    processQueue();
}

// Process files one at a time from the queue
async function processQueue() {
    if (isProcessing || processingQueue.length === 0) {
        updateQueueUI();
        return;
    }
    
    isProcessing = true;
    updateQueueUI();
    
    const file = processingQueue.shift();
    
    try {
        await handleFile(file);
    } catch (error) {
        console.error('Error processing file:', file.name, error);
    } finally {
        isProcessing = false;
        updateQueueUI();
        
        // Process next file in queue
        if (processingQueue.length > 0) {
            setTimeout(() => processQueue(), 500); // Small delay between files
        }
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeUploadHandlers);
} else {
    // DOM already ready
    initializeUploadHandlers();
}

// Update queue UI
function updateQueueUI() {
    const queueSection = document.getElementById('queueSection');
    const queueList = document.getElementById('queueList');
    
    if (processingQueue.length === 0 && !isProcessing) {
        queueSection.style.display = 'none';
        return;
    }
    
    queueSection.style.display = 'block';
    let html = '';
    
    if (isProcessing) {
        html += '<p class="queue-status">Processing file...</p>';
    }
    
    if (processingQueue.length > 0) {
        html += `<p class="queue-count">${processingQueue.length} file(s) in queue</p>`;
        html += '<ul class="queue-items">';
        processingQueue.slice(0, 5).forEach((file, index) => {
            html += `<li>${file.name}</li>`;
        });
        if (processingQueue.length > 5) {
            html += `<li>...and ${processingQueue.length - 5} more</li>`;
        }
        html += '</ul>';
    }
    
    queueList.innerHTML = html;
}

async function handleFile(file) {
    // Get DOM elements with null checks
    const originalVideo = document.getElementById('originalVideo');
    const processedVideo = document.getElementById('processedVideo');
    const previewSection = document.getElementById('previewSection');
    const progressSection = document.getElementById('progressSection');
    const processingStatus = document.getElementById('processingStatus');
    const originalName = document.getElementById('originalName');
    
    // Check if required elements exist
    if (!originalVideo || !processedVideo || !previewSection || !progressSection || !processingStatus || !originalName) {
        console.error('Required DOM elements not found');
        return;
    }
    
    if (!file.name.toLowerCase().endsWith('.mp4') && !file.type.startsWith('video/')) {
        console.warn('Invalid file type:', file.name);
        return;
    }
    
    // Check file size (warn if too large - 100MB optimized limit)
    const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2);
    console.log('Processing file:', file.name, `${fileSizeMB} MB`);
    
    if (file.size > 100 * 1024 * 1024) {
        const proceed = confirm(
            `Warning: This file is ${fileSizeMB} MB.\n` +
            `Optimized for files up to 100MB. Processing may be slower or fail.\n\n` +
            `Recommended: Use files under 100MB for best results.\n\n` +
            `Do you want to continue anyway?`
        );
        if (!proceed) {
            return;
        }
    }
    
    // Display original video - revoke old URL before creating new one
    if (currentOriginalURL) {
        blobRegistry.revoke(currentOriginalURL);
    }
    const originalURL = blobRegistry.register(file, { type: 'original' });
    currentOriginalURL = originalURL;
    originalVideo.src = originalURL;
    originalName.textContent = `${file.name} (${fileSizeMB} MB)`;
    
    // Show preview and progress sections
    previewSection.style.display = 'grid';
    progressSection.style.display = 'block';
    processedVideo.style.display = 'none';
    processingStatus.style.display = 'flex';
    processingStatus.textContent = `Processing: ${file.name}...`;
    
    // Process video
    try {
        await processVideo(file);
    } catch (error) {
        console.error('Error processing video:', error);
        let errorMessage = error.message;
        
        // Provide helpful error messages for common issues
        if (error.message.includes('OOM') || error.message.includes('Out of Memory')) {
            errorMessage = 'Out of Memory: The video file is too large for browser processing. Try a smaller file (under 100MB) or reduce the video resolution first.';
        } else if (error.message.includes('abort')) {
            errorMessage = 'Processing failed: The video might be too large or corrupted. Try a smaller file.';
        }
        
        if (processingStatus) {
            processingStatus.textContent = `Error: ${errorMessage}`;
            processingStatus.style.display = 'flex';
        }
    }
    
    // Update queue UI after processing
    updateQueueUI();
}

async function loadVideoBuffer(file) {
    console.log('Loading video buffer...');
    const arrayBuffer = await file.arrayBuffer();
    return new Uint8Array(arrayBuffer);
}

function randomInRange(min, max) {
    return min + Math.random() * (max - min);
}

function generateUniqueEffects(count) {
    const effects = [];
    const seen = new Set();
    const maxAttempts = count * 100;
    let attempts = 0;

    while (effects.length < count && attempts < maxAttempts) {
        attempts++;

        // Generate effect with consistent property order for JSON.stringify deduplication
        const effect = {
            rotation: parseFloat(randomInRange(0.001, 0.01).toFixed(4)),
            brightness: parseFloat(randomInRange(-0.05, 0.05).toFixed(4)),
            contrast: parseFloat(randomInRange(0.95, 1.05).toFixed(4)),
            saturation: parseFloat(randomInRange(0.95, 1.05).toFixed(4))
        };

        const key = JSON.stringify(effect);
        if (!seen.has(key)) {
            seen.add(key);
            effects.push(effect);
        }
    }

    if (effects.length < count) {
        throw new Error(`Unable to generate ${count} unique effect combinations. Generated ${effects.length} after ${maxAttempts} attempts.`);
    }

    console.log(`Generated ${count} unique effect combinations in ${attempts} attempts`);
    return effects;
}

function formatVariationFilename(originalName, variationIndex) {
    const baseName = originalName.replace(/\.mp4$/i, '');
    const uniqueID = generateUniqueID();
    return `${baseName}_var${variationIndex}_${uniqueID}.mp4`;
}

async function processVideo(file, preloadedBuffer = null, cleanupInput = true, effects = null, variationIndex = null) {
    const statusText = document.getElementById('processingStatus');
    
    console.log('Starting processVideo for file:', file.name);
    
    // Load FFmpeg if not already loaded
    console.log('Loading FFmpeg...');
    try {
        await loadFFmpeg();
        console.log('FFmpeg loaded successfully');
    } catch (error) {
        console.error('Failed to load FFmpeg:', error);
        throw error;
    }
    
    if (!ffmpeg) {
        throw new Error('FFmpeg instance not initialized');
    }
    
    statusText.textContent = 'Loading video file...';
    updateProgress(5, 'Loading video file...');
    console.log('Reading file as array buffer...');

    // Read file as array buffer
    let uint8Array;
    if (preloadedBuffer) {
        uint8Array = preloadedBuffer;
        console.log('Reusing preloaded buffer');
    } else {
        const arrayBuffer = await file.arrayBuffer();
        uint8Array = new Uint8Array(arrayBuffer);
        console.log('Reading new buffer');
    }
    console.log('File loaded, size:', uint8Array.length);
    
    // Generate output filename
    let outputFileName;
    if (variationIndex !== null) {
        outputFileName = formatVariationFilename(file.name, variationIndex);
    } else {
        const fileName = file.name.replace(/\.mp4$/i, '');
        const uniqueID = generateUniqueID();
        outputFileName = `${fileName}_${uniqueID}.mp4`;
    }
    const inputFileName = 'input.mp4';
    
    // Write input file to FFmpeg filesystem (synchronous operation)
    statusText.textContent = 'Preparing video...';
    updateProgress(10, 'Preparing video...');
    console.log('Writing file to FFmpeg filesystem...');
    
    try {
        await ffmpeg.writeFile(inputFileName, uint8Array);
        console.log('File written to FFmpeg filesystem');
    } catch (error) {
        console.error('Error writing file to FFmpeg filesystem:', error);
        throw new Error('Failed to write file to FFmpeg filesystem');
    }
    
    // Process video with optimized settings for browser (lower memory usage)
    statusText.textContent = 'Processing video... This may take several minutes.';
    updateProgress(20, 'Processing video...');
    console.log('Starting FFmpeg processing...');

    try {
        // Unified encoding: ultrafast preset for maximum speed (Phase 3 optimization)
        // CRF 23 maintains acceptable quality; bitrate cap prevents excessive file size
        const encodingSettings = [
            '-b:v', '2000k',
            '-bufsize', '4000k',
            '-maxrate', '2500k',
            '-preset', 'ultrafast',
            '-crf', '23',
        ];
        console.log('Using ultrafast encoding settings');

        let videoFilters;
        if (effects) {
            videoFilters = `rotate=${effects.rotation}:fillcolor=black@0,eq=brightness=${effects.brightness}:contrast=${effects.contrast}:saturation=${effects.saturation}`;
        } else {
            videoFilters = 'rotate=0.00349,eq=brightness=0.01:contrast=1.01:saturation=1.01';
        }

        const processingStartTime = performance.now();
        await ffmpeg.exec([
            '-i', inputFileName,
            '-vf', videoFilters,
            '-r', '29.97',
            ...encodingSettings,
            '-map_metadata', '-1',
            '-threads', '4',          // Allow 4 threads for faster processing
            '-pix_fmt', 'yuv420p',    // Ensure compatibility
            '-movflags', '+faststart', // Fast start for web playback
            outputFileName
        ]);
        console.log('FFmpeg processing completed');
        const processingEndTime = performance.now();
        const processingTimeSec = ((processingEndTime - processingStartTime) / 1000).toFixed(2);
        console.log(`FFmpeg encoding completed in ${processingTimeSec}s`);
    } catch (error) {
        console.error('FFmpeg processing error:', error);
        console.error('Error details:', error.message, error.stack);

        // Check if FFmpeg instance needs recovery
        const corruptionIndicators = [/abort/i, /OOM/i, /Out of Memory/i, /RuntimeError/i];
        const needsRecovery = corruptionIndicators.some(p => p.test(error.message));
        if (needsRecovery) {
            try {
                await recoverFFmpeg();
            } catch (recoveryError) {
                console.error('FFmpeg recovery failed:', recoveryError);
            }
        }

        // Provide specific error messages
        if (error.message.includes('OOM') || error.message.includes('Out of Memory')) {
            throw new Error('Out of Memory: The video file is too large for browser processing. Try a smaller file (under 200MB) or reduce the video resolution first.');
        } else if (error.message.includes('abort')) {
            throw new Error('Processing failed: The video might be too large, corrupted, or your browser ran out of memory. Try a smaller file.');
        } else {
            throw new Error(`Video processing failed: ${error.message}. The video file might be too large or corrupted.`);
        }
    }
    
    // Read processed file
    statusText.textContent = 'Finalizing...';
    updateProgress(95, 'Finalizing...');

    const data = await ffmpeg.readFile(outputFileName);
    
    // Create blob and display
    const blob = new Blob([data.buffer], { type: 'video/mp4' });
    const processedURL = blobRegistry.register(blob, { type: 'processed' });
    
    const processedVideo = document.getElementById('processedVideo');
    
    // Show current processed video
    processedVideo.src = processedURL;
    processedVideo.style.display = 'block';
    statusText.style.display = 'none';
    
    // Store processed video info
    const processedVideoInfo = {
        originalName: file.name,
        processedName: outputFileName,
        processedURL: processedURL,
        fileSize: file.size,
        date: new Date().toLocaleString()
    };
    
    addProcessedVideo(processedVideoInfo);
    
    updateProgress(100, 'Processing complete!');
    
    // Cleanup FFmpeg filesystem
    try {
        await ffmpeg.deleteFile(outputFileName);
        if (cleanupInput) {
            await ffmpeg.deleteFile(inputFileName);
        }
    } catch (e) {
        console.warn('Cleanup warning:', e);
    }

    return {
        filename: outputFileName,
        blob: blob,
        url: processedURL,
        effects: effects,
        size: blob.size
    };
}

// Update the list of all processed videos
function updateProcessedVideosList() {
    const processedVideosSection = document.getElementById('processedVideosSection');
    const processedVideosList = document.getElementById('processedVideosList');
    
    if (processedVideos.length === 0) {
        processedVideosSection.style.display = 'none';
        return;
    }
    
    processedVideosSection.style.display = 'block';
    
    let html = '<div class="processed-videos-grid">';
    
    // Show all processed videos, newest first
    processedVideos.slice().reverse().forEach((video, index) => {
        const fileSizeMB = (video.fileSize / (1024 * 1024)).toFixed(2);
        html += `
            <div class="processed-video-item">
                <div class="processed-video-preview">
                    <video src="${video.processedURL}" controls></video>
                </div>
                <div class="processed-video-info">
                    <p class="processed-video-name" title="${video.originalName}">${video.originalName}</p>
                    <p class="processed-video-size">${fileSizeMB} MB</p>
                    <p class="processed-video-date">${video.date}</p>
                    <button class="download-btn-small" onclick="downloadProcessedVideo(${processedVideos.length - 1 - index})">
                        Download
                    </button>
                </div>
            </div>
        `;
    });
    
    html += '</div>';
    processedVideosList.innerHTML = html;
}

// Download a specific processed video
window.downloadProcessedVideo = function(index) {
    const video = processedVideos[index];
    if (!video) return;
    
    const a = document.createElement('a');
    a.href = video.processedURL;
    a.download = video.processedName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

