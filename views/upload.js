// Upload view with drag-and-drop multi-file selection

import { uploadFiles } from '../lib/api.js';
import { formatBytes } from '../lib/utils.js';
import { supportsClientProcessing } from '../lib/capability-detection.js';
import { setDeviceProcessingData } from './device-progress.js';

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
  // TODO: migrate to CSS class
  wrapper.style.cssText = 'max-width: 800px; margin: var(--spacing-xl) auto; padding: var(--spacing-base);';

  // Page title
  const title = document.createElement('h1');
  title.textContent = 'Upload Videos';
  wrapper.appendChild(title);

  // Instructions
  const instructions = document.createElement('p');
  instructions.textContent = 'Upload one or more MP4 files to create variations.';
  // TODO: migrate to CSS class
  instructions.style.cssText = 'color: var(--color-text-secondary); margin-bottom: var(--spacing-xl);';
  wrapper.appendChild(instructions);

  // Hidden file input
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'video/mp4';
  fileInput.multiple = true;
  fileInput.style.display = 'none';
  wrapper.appendChild(fileInput);

  // Check capability and load saved preference
  const canProcessOnDevice = supportsClientProcessing();
  const savedMode = loadProcessingMode();
  const effectiveMode = (savedMode === 'device' && !canProcessOnDevice) ? 'server' : savedMode;

  // Processing mode radio buttons
  const modeSection = document.createElement('div');
  // TODO: migrate to CSS class
  modeSection.style.cssText = 'display: flex; align-items: center; gap: var(--spacing-lg); margin-bottom: var(--spacing-lg);';

  // Server radio wrapper
  const serverWrapper = document.createElement('div');
  // TODO: migrate to CSS class
  serverWrapper.style.cssText = 'display: flex; align-items: center; gap: var(--spacing-sm);';

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
  // TODO: migrate to CSS class
  deviceWrapper.style.cssText = 'display: flex; align-items: center; gap: var(--spacing-sm);';

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
    // TODO: migrate to CSS class
    unsupportedNote.style.cssText = 'font-size: var(--font-size-sm); color: var(--color-text-muted); font-weight: normal;';
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

  // Insert mode section before fileInput
  wrapper.insertBefore(modeSection, fileInput);

  // Drag-drop zone
  const dropZone = document.createElement('div');
  dropZone.className = 'drop-zone';
  // TODO: migrate to CSS class
  dropZone.style.cssText = 'border: 2px dashed var(--color-border-subtle); border-radius: var(--radius-lg); padding: var(--spacing-2xl); text-align: center; cursor: pointer; transition: background 0.2s;';

  const dropIcon = document.createElement('div');
  dropIcon.textContent = '📁';
  dropIcon.style.fontSize = 'var(--font-size-3xl)';
  dropZone.appendChild(dropIcon);

  const dropText = document.createElement('p');
  dropText.textContent = 'Click to select files or drag and drop MP4 videos here';
  // TODO: migrate to CSS class
  dropText.style.cssText = 'margin: var(--spacing-base) 0 0; font-size: var(--font-size-md); color: var(--color-text-secondary);';
  dropZone.appendChild(dropText);

  // Click to open file picker
  dropZone.addEventListener('click', () => {
    fileInput.click();
  });

  // Drag and drop handlers
  dropZone.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
    dropZone.style.background = 'var(--color-bg-hover)';
    dropZone.style.borderColor = 'var(--color-accent)';
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
  });

  dropZone.addEventListener('dragleave', (e) => {
    if (e.target === dropZone) {
      dropZone.classList.remove('dragover');
      dropZone.style.background = '';
      dropZone.style.borderColor = 'var(--color-border-subtle)';
    }
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    dropZone.style.background = '';
    dropZone.style.borderColor = 'var(--color-border-subtle)';

    const files = Array.from(e.dataTransfer.files);
    addFiles(files, fileListContainer, warningDiv, submitBtn);
  });

  wrapper.appendChild(dropZone);

  // File input change handler
  fileInput.addEventListener('change', (e) => {
    const files = Array.from(e.target.files);
    addFiles(files, fileListContainer, warningDiv, submitBtn);
    fileInput.value = ''; // Reset so same file can be added again
  });

  // Warning div for non-MP4 files or large files
  const warningDiv = document.createElement('div');
  // TODO: migrate to CSS class
  warningDiv.style.cssText = 'background: var(--color-warning-bg); color: var(--color-warning-text); padding: var(--spacing-base); border-radius: var(--radius-sm); margin-top: var(--spacing-base); display: none;';
  wrapper.appendChild(warningDiv);

  // File list container
  const fileListContainer = document.createElement('div');
  fileListContainer.className = 'file-list';
  // TODO: migrate to CSS class
  fileListContainer.style.cssText = 'margin-top: var(--spacing-xl);';
  wrapper.appendChild(fileListContainer);

  // Variation count input section
  const variationSection = document.createElement('div');
  // TODO: migrate to CSS class
  variationSection.style.cssText = 'margin-top: var(--spacing-xl); display: flex; align-items: center; gap: var(--spacing-base);';

  const variationLabel = document.createElement('label');
  variationLabel.textContent = 'Number of variations per video:';
  variationLabel.style.fontWeight = 'var(--font-weight-bold)';
  variationSection.appendChild(variationLabel);

  const variationInput = document.createElement('input');
  variationInput.type = 'number';
  variationInput.min = '1';
  variationInput.max = '20';
  variationInput.value = '5';
  // TODO: migrate to CSS class
  variationInput.style.cssText = 'width: 80px; padding: var(--spacing-sm); font-size: var(--font-size-base); border: 1px solid var(--color-input-border); border-radius: var(--radius-sm); background: var(--color-input-bg); color: var(--color-input-text);';
  variationSection.appendChild(variationInput);

  const variationNote = document.createElement('span');
  variationNote.textContent = '(1-20)';
  variationNote.style.color = 'var(--color-text-secondary)';
  variationSection.appendChild(variationNote);

  wrapper.appendChild(variationSection);

  // Submit button
  const submitBtn = document.createElement('button');
  submitBtn.type = 'button';
  submitBtn.textContent = 'Upload and Process';
  submitBtn.disabled = true;
  // TODO: migrate to CSS class
  submitBtn.style.cssText = 'margin-top: var(--spacing-xl); padding: var(--spacing-base) var(--spacing-xl); font-size: var(--font-size-md); background: var(--color-gray-600); color: var(--color-gray-50); border: none; border-radius: var(--radius-sm); cursor: not-allowed; width: 100%;';

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
    submitBtn.style.background = 'var(--color-gray-600)';
    submitBtn.style.cursor = 'not-allowed';
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

    // Server processing path (existing code)
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
      submitBtn.style.background = 'var(--color-accent)';
      submitBtn.style.cursor = 'pointer';
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
  // TODO: migrate to CSS class
  progressSection.style.cssText = 'margin-top: var(--spacing-base); display: none;';

  const progressLabel = document.createElement('div');
  progressLabel.textContent = 'Upload progress:';
  // TODO: migrate to CSS class
  progressLabel.style.cssText = 'margin-bottom: var(--spacing-sm); font-weight: var(--font-weight-bold);';
  progressSection.appendChild(progressLabel);

  const progressBarContainer = document.createElement('div');
  // TODO: migrate to CSS class
  progressBarContainer.style.cssText = 'width: 100%; height: 30px; background: var(--color-gray-700); border-radius: var(--radius-sm); overflow: hidden; position: relative;';

  const progressBar = document.createElement('div');
  // TODO: migrate to CSS class
  progressBar.style.cssText = 'height: 100%; background: var(--color-accent); width: 0%; transition: width 0.3s;';
  progressBarContainer.appendChild(progressBar);

  const progressText = document.createElement('div');
  progressText.textContent = '0%';
  // TODO: migrate to CSS class
  progressText.style.cssText = 'position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-weight: var(--font-weight-bold); color: var(--color-text-primary);';
  progressBarContainer.appendChild(progressText);

  progressSection.appendChild(progressBarContainer);
  wrapper.appendChild(progressSection);

  container.appendChild(wrapper);

  // Render initial file list (empty)
  renderFileList(fileListContainer, submitBtn);
}

/**
 * Add files to selection
 */
function addFiles(files, fileListContainer, warningDiv, submitBtn) {
  const mp4Files = [];
  const nonMp4Files = [];
  const largeFiles = [];

  files.forEach(file => {
    if (file.type === 'video/mp4' || file.name.toLowerCase().endsWith('.mp4')) {
      mp4Files.push(file);
      if (file.size > 100 * 1024 * 1024) { // >100MB
        largeFiles.push(file);
      }
    } else {
      nonMp4Files.push(file);
    }
  });

  // Add MP4 files to selection
  selectedFiles = selectedFiles.concat(mp4Files);

  // Show warnings if needed
  const warnings = [];
  if (nonMp4Files.length > 0) {
    warnings.push(`${nonMp4Files.length} non-MP4 file(s) skipped. Only MP4 videos are accepted.`);
  }
  if (largeFiles.length > 0) {
    warnings.push(`${largeFiles.length} file(s) larger than 100MB. Upload may take some time.`);
  }

  if (warnings.length > 0) {
    warningDiv.textContent = warnings.join(' ');
    warningDiv.style.display = 'block';
    warningDiv.style.background = 'var(--color-warning-bg)';
    warningDiv.style.color = 'var(--color-warning-text)';
  } else {
    warningDiv.style.display = 'none';
  }

  // Re-render file list
  renderFileList(fileListContainer, submitBtn);
}

/**
 * Render file list
 */
function renderFileList(container, submitBtn) {
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }

  if (selectedFiles.length === 0) {
    submitBtn.disabled = true;
    submitBtn.style.background = 'var(--color-gray-600)';
    submitBtn.style.cursor = 'not-allowed';
    return;
  }

  // Enable submit button
  submitBtn.disabled = false;
  submitBtn.style.background = 'var(--color-accent)';
  submitBtn.style.cursor = 'pointer';

  const heading = document.createElement('h3');
  heading.textContent = 'Selected Files';
  container.appendChild(heading);

  const fileList = document.createElement('div');
  // TODO: migrate to CSS class
  fileList.style.cssText = 'border: 1px solid var(--color-border); border-radius: var(--radius-sm); overflow: hidden;';

  selectedFiles.forEach((file, index) => {
    const fileRow = document.createElement('div');
    // TODO: migrate to CSS class
    fileRow.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: var(--spacing-base); border-bottom: 1px solid var(--color-border);';
    if (index === selectedFiles.length - 1) {
      fileRow.style.borderBottom = 'none';
    }

    const fileInfo = document.createElement('div');
    fileInfo.style.flex = '1';

    const fileName = document.createElement('div');
    fileName.textContent = file.name;
    fileName.style.fontWeight = 'var(--font-weight-bold)';
    fileInfo.appendChild(fileName);

    const fileSize = document.createElement('div');
    fileSize.textContent = formatBytes(file.size);
    // TODO: migrate to CSS class
    fileSize.style.cssText = 'color: var(--color-text-secondary); font-size: var(--font-size-sm); margin-top: var(--spacing-xs);';
    fileInfo.appendChild(fileSize);

    fileRow.appendChild(fileInfo);

    const removeBtn = document.createElement('button');
    removeBtn.textContent = 'Remove';
    // TODO: migrate to CSS class
    removeBtn.style.cssText = 'padding: var(--spacing-sm) var(--spacing-base); background: var(--color-red-600); color: var(--color-gray-50); border: none; border-radius: var(--radius-sm); cursor: pointer;';
    removeBtn.addEventListener('mouseenter', () => {
      removeBtn.style.background = 'var(--color-red-700)';
    });
    removeBtn.addEventListener('mouseleave', () => {
      removeBtn.style.background = 'var(--color-red-600)';
    });
    removeBtn.addEventListener('click', () => {
      selectedFiles.splice(index, 1);
      renderFileList(container, submitBtn);
    });

    fileRow.appendChild(removeBtn);
    fileList.appendChild(fileRow);
  });

  container.appendChild(fileList);

  // Total size
  const totalSize = selectedFiles.reduce((sum, file) => sum + file.size, 0);
  const totalDiv = document.createElement('div');
  // TODO: migrate to CSS class
  totalDiv.style.cssText = 'margin-top: var(--spacing-base); font-weight: var(--font-weight-bold); text-align: right;';
  totalDiv.textContent = `Total: ${selectedFiles.length} file(s), ${formatBytes(totalSize)}`;
  container.appendChild(totalDiv);
}
