// Use esm.sh CDN which handles npm packages better for ES modules
// Using older version 0.11.6 which doesn't have worker CORS issues
import { createFFmpeg, fetchFile } from 'https://esm.sh/@ffmpeg/ffmpeg@0.11.6';

// No need to wait - it's loaded as ES module

// Generate unique identifier (same as original script)
function generateUniqueID() {
    const array = new Uint8Array(3);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

// Initialize FFmpeg
let ffmpeg = null;
let ffmpegLoaded = false;

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
        // Use older API (0.11.6) which doesn't have worker CORS issues
        ffmpeg = createFFmpeg({
            log: true,
            progress: ({ ratio }) => {
                const progressPercent = Math.round(ratio * 100);
                console.log('FFmpeg progress:', progressPercent + '%');
                updateProgress(progressPercent, `Processing... ${progressPercent}%`);
            },
            // Load from CDN with proper CORS headers
            corePath: 'https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js',
        });
        
        console.log('Loading FFmpeg core...');
        // Load FFmpeg
        await ffmpeg.load();
        
        ffmpegLoaded = true;
        console.log('FFmpeg loaded successfully');
    } catch (error) {
        console.error('Error loading FFmpeg:', error);
        console.error('Error details:', error.message, error.stack);
        if (statusText) {
            statusText.textContent = `Error loading FFmpeg: ${error.message}. Please refresh the page.`;
        }
        throw error;
    }
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

// Store all processed videos
let processedVideos = [];

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
    
    // Display original video
    const originalURL = URL.createObjectURL(file);
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

async function processVideo(file) {
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
    const arrayBuffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    console.log('File loaded, size:', uint8Array.length);
    
    // Generate output filename
    const fileName = file.name.replace(/\.mp4$/i, '');
    const uniqueID = generateUniqueID();
    const inputFileName = 'input.mp4';
    const outputFileName = `${fileName}_${uniqueID}.mp4`;
    
    // Write input file to FFmpeg filesystem (synchronous operation)
    statusText.textContent = 'Preparing video...';
    updateProgress(10, 'Preparing video...');
    console.log('Writing file to FFmpeg filesystem...');
    
    try {
        ffmpeg.FS('writeFile', inputFileName, uint8Array);
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
        // Determine encoding settings based on file size
        // Optimized for speed while maintaining good quality for files up to 100MB
        const fileSizeMB = file.size / (1024 * 1024);
        let encodingSettings;
        
        if (fileSizeMB < 30) {
            // Small files (< 30MB): Balance quality and speed
            encodingSettings = [
                '-b:v', '2500k',      // Good bitrate for quality
                '-bufsize', '5000k',
                '-maxrate', '3000k',
                '-preset', 'fast',    // Faster preset for speed
                '-crf', '22',         // Good quality
            ];
            console.log('Using fast quality settings for small file');
        } else if (fileSizeMB < 60) {
            // Medium-small files (30-60MB): Balanced for speed
            encodingSettings = [
                '-b:v', '2000k',      // Good bitrate
                '-bufsize', '4000k',
                '-maxrate', '2500k',
                '-preset', 'fast',    // Fast preset
                '-crf', '23',         // Good quality
            ];
            console.log('Using balanced settings for medium-small file');
        } else {
            // Medium files (60-100MB): Prioritize speed
            encodingSettings = [
                '-b:v', '1800k',      // Good bitrate for reasonable quality
                '-bufsize', '3600k',
                '-maxrate', '2200k',
                '-preset', 'veryfast', // Fastest reasonable preset
                '-crf', '24',         // Good quality
            ];
            console.log('Using speed-optimized settings for medium file');
        }
        
        // Optimized settings for browser processing (up to 100MB):
        // - High quality bitrates
        // - Good quality presets
        // - Balanced for quality and memory
        
        await ffmpeg.run(
            '-i', inputFileName,
            '-vf', 'rotate=0.00349,eq=brightness=0.01:contrast=1.01:saturation=1.01',
            '-r', '29.97',
            ...encodingSettings,
            '-map_metadata', '-1',
            '-threads', '4',          // Allow 4 threads for faster processing
            '-pix_fmt', 'yuv420p',    // Ensure compatibility
            '-movflags', '+faststart', // Fast start for web playback
            outputFileName
        );
        console.log('FFmpeg processing completed');
    } catch (error) {
        console.error('FFmpeg processing error:', error);
        console.error('Error details:', error.message, error.stack);
        
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
    
    const data = ffmpeg.FS('readFile', outputFileName);
    
    // Create blob and display
    const blob = new Blob([data.buffer], { type: 'video/mp4' });
    const processedURL = URL.createObjectURL(blob);
    
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
    
    processedVideos.push(processedVideoInfo);
    
    // Update the processed videos list
    updateProcessedVideosList();
    
    updateProgress(100, 'Processing complete!');
    
    // Cleanup FFmpeg filesystem
    try {
        ffmpeg.FS('unlink', inputFileName);
        ffmpeg.FS('unlink', outputFileName);
    } catch (e) {
        console.warn('Cleanup warning:', e);
    }
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

