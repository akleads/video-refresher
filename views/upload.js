// Upload view with drag-and-drop multi-file selection

import { uploadFiles } from '../lib/api.js';
import { formatBytes } from '../lib/utils.js';
import { supportsClientProcessing } from '../lib/capability-detection.js';
import { setDeviceProcessingData } from './device-progress.js';
import { requestPermissionIfNeeded } from '../lib/notifications.js';

// Module-level state - reset on each render
let selectedFiles = [];

// localStorage key for processing mode preference
const STORAGE_KEY = 'video-refresher.processing-mode';

/**
 * Save processing mode preference to localStorage
 * @param {string} mode - 'server' or 'device'
 */
function saveProcessingMode(mode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch (err) {
    console.warn('[upload] Failed to save processing mode:', err);
  }
}

/**
 * Load processing mode preference from localStorage
 * @returns {string} 'server' or 'device' (defaults to 'server')
 */
function loadProcessingMode() {
  try {
    return localStorage.getItem(STORAGE_KEY) || 'server';
  } catch (err) {
    console.warn('[upload] Failed to load processing mode:', err);
    return 'server';
  }
}

export function renderUpload(params) {
  // Reset state
  selectedFiles = [];

  const container = document.getElementById('view-upload');
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }

  // Main wrapper
  const wrapper = document.createElement('div');
  wrapper.className = 'upload-wrapper';
  wrapper.style.maxWidth = '800px';
  wrapper.style.margin = 'var(--spacing-xl) auto';

  // Page title
  const title = document.createElement('h1');
  title.className = 'upload-title';
  title.textContent = 'Upload Videos';
  wrapper.appendChild(title);

  // Instructions
  const instructions = document.createElement('p');
  instructions.className = 'upload-instructions';
  instructions.textContent = 'Upload one or more MP4 or MOV files to create variations.';
  wrapper.appendChild(instructions);

  // Hidden file input
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'video/mp4,.mov,video/quicktime';
  fileInput.multiple = true;
  fileInput.style.display = 'none';
  wrapper.appendChild(fileInput);

  // Check capability and load saved preference
  const canProcessOnDevice = supportsClientProcessing();
  const savedMode = loadProcessingMode();
  const effectiveMode = (savedMode === 'device' && !canProcessOnDevice) ? 'server' : savedMode;

  // Processing mode radio buttons
  const modeSection = document.createElement('div');
  modeSection.className = 'upload-mode-section';

  // Server radio wrapper
  const serverWrapper = document.createElement('div');
  serverWrapper.className = 'upload-mode-option';

  const serverRadio = document.createElement('input');
  serverRadio.type = 'radio';
  serverRadio.name = 'processing-mode';
  serverRadio.value = 'server';
  serverRadio.id = 'mode-server';
  serverRadio.checked = (effectiveMode === 'server');
  serverWrapper.appendChild(serverRadio);

  const serverLabel = document.createElement('label');
  serverLabel.htmlFor = 'mode-server';
  serverLabel.textContent = 'Send to server';
  serverLabel.style.cursor = 'pointer';
  serverWrapper.appendChild(serverLabel);

  modeSection.appendChild(serverWrapper);

  // Device radio wrapper
  const deviceWrapper = document.createElement('div');
  deviceWrapper.className = 'upload-mode-option';

  const deviceRadio = document.createElement('input');
  deviceRadio.type = 'radio';
  deviceRadio.name = 'processing-mode';
  deviceRadio.value = 'device';
  deviceRadio.id = 'mode-device';
  deviceRadio.checked = (effectiveMode === 'device');
  deviceWrapper.appendChild(deviceRadio);

  const deviceLabel = document.createElement('label');
  deviceLabel.htmlFor = 'mode-device';
  deviceLabel.textContent = 'Process on device';
  deviceLabel.style.cursor = 'pointer';
  deviceWrapper.appendChild(deviceLabel);

  // If device processing not supported, disable and add message
  if (!canProcessOnDevice) {
    deviceRadio.disabled = true;
    deviceLabel.style.color = 'var(--color-text-muted)';
    deviceLabel.style.cursor = 'not-allowed';

    const unsupportedNote = document.createElement('span');
    unsupportedNote.textContent = ' (Not supported in this browser)';
    unsupportedNote.style.fontSize = 'var(--font-size-sm)';
    unsupportedNote.style.color = 'var(--color-text-muted)';
    unsupportedNote.style.fontWeight = 'normal';
    deviceLabel.appendChild(unsupportedNote);
  }

  modeSection.appendChild(deviceWrapper);

  // Attach change listeners for localStorage persistence
  serverRadio.addEventListener('change', () => {
    if (serverRadio.checked) {
      saveProcessingMode('server');
    }
  });

  deviceRadio.addEventListener('change', () => {
    if (deviceRadio.checked) {
      saveProcessingMode('device');
    }
  });

  wrapper.appendChild(modeSection);

  // Drop zone
  const dropZone = document.createElement('div');
  dropZone.className = 'drop-zone';

  const dropIcon = document.createElement('div');
  dropIcon.className = 'drop-zone-icon';
  // Simple upload cloud SVG icon
  dropIcon.innerHTML = '<svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>';
  dropZone.appendChild(dropIcon);

  const dropText = document.createElement('p');
  dropText.className = 'drop-zone-text';
  dropText.textContent = 'Drop video files here or click to browse';
  dropZone.appendChild(dropText);

  const dropHint = document.createElement('p');
  dropHint.className = 'drop-zone-hint';
  dropHint.textContent = 'MP4 and MOV files accepted';
  dropZone.appendChild(dropHint);

  // Collapsed label (hidden initially, added when collapsed)
  let collapsedLabel = null;

  // Click to open file picker
  dropZone.addEventListener('click', () => {
    fileInput.click();
  });

  // Drag and drop handlers
  dropZone.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
  });

  dropZone.addEventListener('dragleave', (e) => {
    // Only remove dragover if leaving the drop zone, not entering a child
    if (e.target === dropZone) {
      dropZone.classList.remove('dragover');
    }
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');

    const files = Array.from(e.dataTransfer.files);
    addFiles(files, fileListContainer, warningDiv, submitBtn, dropZone, collapsedLabel);
  });

  wrapper.appendChild(dropZone);

  // File input change handler
  fileInput.addEventListener('change', (e) => {
    const files = Array.from(e.target.files);
    addFiles(files, fileListContainer, warningDiv, submitBtn, dropZone, collapsedLabel);
    fileInput.value = ''; // Reset so same file can be added again
  });

  // Warning div for non-MP4 files or large files
  const warningDiv = document.createElement('div');
  warningDiv.className = 'upload-warning';
  wrapper.appendChild(warningDiv);

  // File list container
  const fileListContainer = document.createElement('div');
  fileListContainer.className = 'upload-file-list';
  wrapper.appendChild(fileListContainer);

  // Variation count input section
  const variationSection = document.createElement('div');
  variationSection.className = 'upload-variation-section';

  const variationLabel = document.createElement('label');
  variationLabel.textContent = 'Number of variations per video:';
  variationLabel.style.fontWeight = 'var(--font-weight-bold)';
  variationSection.appendChild(variationLabel);

  const variationInput = document.createElement('input');
  variationInput.type = 'number';
  variationInput.min = '1';
  variationInput.max = '20';
  variationInput.value = '5';
  variationInput.className = 'upload-variation-input';
  variationSection.appendChild(variationInput);

  const variationNote = document.createElement('span');
  variationNote.textContent = '(1-20)';
  variationNote.style.color = 'var(--color-text-secondary)';
  variationSection.appendChild(variationNote);

  wrapper.appendChild(variationSection);

  // Submit button
  const submitBtn = document.createElement('button');
  submitBtn.type = 'button';
  submitBtn.className = 'upload-submit';
  submitBtn.textContent = 'Upload and Process';
  submitBtn.disabled = true;

  submitBtn.addEventListener('click', async () => {
    if (selectedFiles.length === 0) return;

    // Validate variation count
    let variations = parseInt(variationInput.value, 10);
    if (isNaN(variations) || variations < 1) variations = 1;
    if (variations > 20) variations = 20;

    // Get selected processing mode
    const selectedMode = document.querySelector('input[name="processing-mode"]:checked').value;

    // Disable submit button and radio buttons
    submitBtn.disabled = true;
    submitBtn.classList.remove('active');
    serverRadio.disabled = true;
    deviceRadio.disabled = true;

    // Branch based on selected mode
    if (selectedMode === 'device') {
      // Device processing path
      submitBtn.textContent = 'Processing...';
      setDeviceProcessingData(selectedFiles, variations);
      window.location.hash = '#device-progress';
      return;
    }

    // Server processing path
    // Request notification permission on first server job submission
    await requestPermissionIfNeeded();

    submitBtn.textContent = 'Uploading...';

    // Show progress section
    progressSection.style.display = 'block';
    progressBar.style.width = '0%';
    progressText.textContent = '0%';

    // Create FormData
    const formData = new FormData();
    selectedFiles.forEach(file => {
      formData.append('videos', file);
    });
    formData.append('variations', variations.toString());

    try {
      const data = await uploadFiles('/api/jobs', formData, (percentComplete) => {
        progressBar.style.width = `${percentComplete}%`;
        progressText.textContent = `${Math.round(percentComplete)}%`;
      });

      // Navigate to job detail page
      window.location.hash = `#job/${data.jobId}`;

    } catch (err) {
      // Re-enable button and radio buttons
      submitBtn.disabled = false;
      submitBtn.classList.add('active');
      submitBtn.textContent = 'Upload and Process';

      serverRadio.disabled = false;
      // Only re-enable device radio if capability supported
      deviceRadio.disabled = !canProcessOnDevice;

      // Show error
      warningDiv.style.display = 'block';
      warningDiv.style.background = 'var(--color-error-bg)';
      warningDiv.style.color = 'var(--color-error-text)';
      warningDiv.textContent = `Upload failed: ${err.message}`;
      progressSection.style.display = 'none';
    }
  });

  wrapper.appendChild(submitBtn);

  // Upload progress section (hidden by default)
  const progressSection = document.createElement('div');
  progressSection.className = 'upload-progress';

  const progressLabel = document.createElement('div');
  progressLabel.className = 'upload-progress-label';
  progressLabel.textContent = 'Upload progress:';
  progressSection.appendChild(progressLabel);

  const progressBarContainer = document.createElement('div');
  progressBarContainer.className = 'upload-progress-track';

  const progressBar = document.createElement('div');
  progressBar.className = 'upload-progress-fill';
  progressBarContainer.appendChild(progressBar);

  const progressText = document.createElement('div');
  progressText.className = 'upload-progress-text';
  progressText.textContent = '0%';
  progressBarContainer.appendChild(progressText);

  progressSection.appendChild(progressBarContainer);
  wrapper.appendChild(progressSection);

  container.appendChild(wrapper);

  // Render initial file list (empty)
  renderFileList(fileListContainer, submitBtn, dropZone, collapsedLabel);
}

/**
 * Add files to selection
 */
function addFiles(files, fileListContainer, warningDiv, submitBtn, dropZone, collapsedLabel) {
  const validFiles = [];
  const rejectedFiles = [];
  const largeFiles = [];

  files.forEach(file => {
    if (file.type === 'video/mp4' || file.type === 'video/quicktime' || file.name.toLowerCase().endsWith('.mp4') || file.name.toLowerCase().endsWith('.mov')) {
      validFiles.push(file);
      if (file.size > 100 * 1024 * 1024) { // >100MB
        largeFiles.push(file);
      }
    } else {
      rejectedFiles.push(file);
    }
  });

  // Add valid files to selection
  selectedFiles = selectedFiles.concat(validFiles);

  // Show warnings if needed
  const warnings = [];
  if (rejectedFiles.length > 0) {
    warnings.push(`${rejectedFiles.length} unsupported file(s) skipped. Only MP4 and MOV videos are accepted.`);
  }
  if (largeFiles.length > 0) {
    warnings.push(`${largeFiles.length} file(s) larger than 100MB. Upload may take some time.`);
  }

  if (warnings.length > 0) {
    warningDiv.textContent = warnings.join(' ');
    warningDiv.style.display = 'block';
  } else {
    warningDiv.style.display = 'none';
  }

  // Re-render file list and update drop zone state
  renderFileList(fileListContainer, submitBtn, dropZone, collapsedLabel);
}

/**
 * Render file list
 */
function renderFileList(container, submitBtn, dropZone, collapsedLabel) {
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }

  if (selectedFiles.length === 0) {
    // No files: disable submit, restore idle drop zone
    submitBtn.disabled = true;
    submitBtn.classList.remove('active');

    // Remove collapsed state
    dropZone.classList.remove('collapsed');
    if (collapsedLabel && collapsedLabel.parentNode) {
      collapsedLabel.parentNode.removeChild(collapsedLabel);
    }
    return;
  }

  // Files selected: enable submit, collapse drop zone
  submitBtn.disabled = false;
  submitBtn.classList.add('active');

  // Add collapsed state
  if (!dropZone.classList.contains('collapsed')) {
    dropZone.classList.add('collapsed');

    // Create collapsed label if it doesn't exist
    if (!collapsedLabel) {
      collapsedLabel = document.createElement('span');
      collapsedLabel.className = 'drop-zone-collapsed-label';
      collapsedLabel.textContent = 'Add more files';
    }

    // Ensure collapsed label is in the drop zone
    if (!collapsedLabel.parentNode) {
      dropZone.appendChild(collapsedLabel);
    }
  }

  const heading = document.createElement('h3');
  heading.textContent = 'Selected Files';
  container.appendChild(heading);

  const fileList = document.createElement('div');
  fileList.className = 'upload-file-list-container';

  selectedFiles.forEach((file, index) => {
    const fileRow = document.createElement('div');
    fileRow.className = 'upload-file-row';

    const fileInfo = document.createElement('div');
    fileInfo.style.flex = '1';

    const fileName = document.createElement('div');
    fileName.className = 'upload-file-name';
    fileName.textContent = file.name;
    fileInfo.appendChild(fileName);

    const fileSize = document.createElement('div');
    fileSize.className = 'upload-file-size';
    fileSize.textContent = formatBytes(file.size);
    fileInfo.appendChild(fileSize);

    fileRow.appendChild(fileInfo);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'upload-file-remove';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => {
      selectedFiles.splice(index, 1);
      renderFileList(container, submitBtn, dropZone, collapsedLabel);
    });

    fileRow.appendChild(removeBtn);
    fileList.appendChild(fileRow);
  });

  container.appendChild(fileList);

  // Total size
  const totalSize = selectedFiles.reduce((sum, file) => sum + file.size, 0);
  const totalDiv = document.createElement('div');
  totalDiv.className = 'upload-total';
  totalDiv.textContent = `Total: ${selectedFiles.length} file(s), ${formatBytes(totalSize)}`;
  container.appendChild(totalDiv);
}
