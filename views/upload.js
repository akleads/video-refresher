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
  wrapper.style.cssText = 'max-width: 800px; margin: 2rem auto; padding: 1rem;';

  // Page title
  const title = document.createElement('h1');
  title.textContent = 'Upload Videos';
  wrapper.appendChild(title);

  // Instructions
  const instructions = document.createElement('p');
  instructions.textContent = 'Upload one or more MP4 files to create variations.';
  instructions.style.cssText = 'color: #666; margin-bottom: 2rem;';
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
  modeSection.style.cssText = 'display: flex; align-items: center; gap: 1.5rem; margin-bottom: 1.5rem;';

  // Server radio wrapper
  const serverWrapper = document.createElement('div');
  serverWrapper.style.cssText = 'display: flex; align-items: center; gap: 0.5rem;';

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
  deviceWrapper.style.cssText = 'display: flex; align-items: center; gap: 0.5rem;';

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
    deviceLabel.style.color = '#999';
    deviceLabel.style.cursor = 'not-allowed';

    const unsupportedNote = document.createElement('span');
    unsupportedNote.textContent = ' (Not supported in this browser)';
    unsupportedNote.style.cssText = 'font-size: 0.85em; color: #999; font-weight: normal;';
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
  dropZone.style.cssText = 'border: 2px dashed #ccc; border-radius: 8px; padding: 3rem; text-align: center; cursor: pointer; transition: background 0.2s;';

  const dropIcon = document.createElement('div');
  dropIcon.textContent = '📁';
  dropIcon.style.fontSize = '4rem';
  dropZone.appendChild(dropIcon);

  const dropText = document.createElement('p');
  dropText.textContent = 'Click to select files or drag and drop MP4 videos here';
  dropText.style.cssText = 'margin: 1rem 0 0; font-size: 1.1rem; color: #666;';
  dropZone.appendChild(dropText);

  // Click to open file picker
  dropZone.addEventListener('click', () => {
    fileInput.click();
  });

  // Drag and drop handlers
  dropZone.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
    dropZone.style.background = '#f0f8ff';
    dropZone.style.borderColor = '#0066cc';
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
  });

  dropZone.addEventListener('dragleave', (e) => {
    if (e.target === dropZone) {
      dropZone.classList.remove('dragover');
      dropZone.style.background = '';
      dropZone.style.borderColor = '#ccc';
    }
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    dropZone.style.background = '';
    dropZone.style.borderColor = '#ccc';

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
  warningDiv.style.cssText = 'background: #fff3cd; color: #856404; padding: 1rem; border-radius: 4px; margin-top: 1rem; display: none;';
  wrapper.appendChild(warningDiv);

  // File list container
  const fileListContainer = document.createElement('div');
  fileListContainer.className = 'file-list';
  fileListContainer.style.cssText = 'margin-top: 2rem;';
  wrapper.appendChild(fileListContainer);

  // Variation count input section
  const variationSection = document.createElement('div');
  variationSection.style.cssText = 'margin-top: 2rem; display: flex; align-items: center; gap: 1rem;';

  const variationLabel = document.createElement('label');
  variationLabel.textContent = 'Number of variations per video:';
  variationLabel.style.fontWeight = 'bold';
  variationSection.appendChild(variationLabel);

  const variationInput = document.createElement('input');
  variationInput.type = 'number';
  variationInput.min = '1';
  variationInput.max = '20';
  variationInput.value = '5';
  variationInput.style.cssText = 'width: 80px; padding: 0.5rem; font-size: 1rem; border: 1px solid #ccc; border-radius: 4px;';
  variationSection.appendChild(variationInput);

  const variationNote = document.createElement('span');
  variationNote.textContent = '(1-20)';
  variationNote.style.color = '#666';
  variationSection.appendChild(variationNote);

  wrapper.appendChild(variationSection);

  // Submit button
  const submitBtn = document.createElement('button');
  submitBtn.type = 'button';
  submitBtn.textContent = 'Upload and Process';
  submitBtn.disabled = true;
  submitBtn.style.cssText = 'margin-top: 2rem; padding: 1rem 2rem; font-size: 1.1rem; background: #ccc; color: white; border: none; border-radius: 4px; cursor: not-allowed; width: 100%;';

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
    submitBtn.style.background = '#ccc';
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
      submitBtn.style.background = '#0066cc';
      submitBtn.style.cursor = 'pointer';
      submitBtn.textContent = 'Upload and Process';

      serverRadio.disabled = false;
      // Only re-enable device radio if capability supported
      deviceRadio.disabled = !canProcessOnDevice;

      // Show error
      warningDiv.style.display = 'block';
      warningDiv.style.background = '#fee';
      warningDiv.style.color = '#c33';
      warningDiv.textContent = `Upload failed: ${err.message}`;
      progressSection.style.display = 'none';
    }
  });

  wrapper.appendChild(submitBtn);

  // Upload progress section (hidden by default)
  const progressSection = document.createElement('div');
  progressSection.style.cssText = 'margin-top: 1rem; display: none;';

  const progressLabel = document.createElement('div');
  progressLabel.textContent = 'Upload progress:';
  progressLabel.style.cssText = 'margin-bottom: 0.5rem; font-weight: bold;';
  progressSection.appendChild(progressLabel);

  const progressBarContainer = document.createElement('div');
  progressBarContainer.style.cssText = 'width: 100%; height: 30px; background: #eee; border-radius: 4px; overflow: hidden; position: relative;';

  const progressBar = document.createElement('div');
  progressBar.style.cssText = 'height: 100%; background: #0066cc; width: 0%; transition: width 0.3s;';
  progressBarContainer.appendChild(progressBar);

  const progressText = document.createElement('div');
  progressText.textContent = '0%';
  progressText.style.cssText = 'position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-weight: bold; color: #333;';
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
    warningDiv.style.background = '#fff3cd';
    warningDiv.style.color = '#856404';
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
    submitBtn.style.background = '#ccc';
    submitBtn.style.cursor = 'not-allowed';
    return;
  }

  // Enable submit button
  submitBtn.disabled = false;
  submitBtn.style.background = '#0066cc';
  submitBtn.style.cursor = 'pointer';

  const heading = document.createElement('h3');
  heading.textContent = 'Selected Files';
  container.appendChild(heading);

  const fileList = document.createElement('div');
  fileList.style.cssText = 'border: 1px solid #ddd; border-radius: 4px; overflow: hidden;';

  selectedFiles.forEach((file, index) => {
    const fileRow = document.createElement('div');
    fileRow.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 1rem; border-bottom: 1px solid #eee;';
    if (index === selectedFiles.length - 1) {
      fileRow.style.borderBottom = 'none';
    }

    const fileInfo = document.createElement('div');
    fileInfo.style.flex = '1';

    const fileName = document.createElement('div');
    fileName.textContent = file.name;
    fileName.style.fontWeight = 'bold';
    fileInfo.appendChild(fileName);

    const fileSize = document.createElement('div');
    fileSize.textContent = formatBytes(file.size);
    fileSize.style.cssText = 'color: #666; font-size: 0.9rem; margin-top: 0.25rem;';
    fileInfo.appendChild(fileSize);

    fileRow.appendChild(fileInfo);

    const removeBtn = document.createElement('button');
    removeBtn.textContent = 'Remove';
    removeBtn.style.cssText = 'padding: 0.5rem 1rem; background: #dc3545; color: white; border: none; border-radius: 4px; cursor: pointer;';
    removeBtn.addEventListener('mouseenter', () => {
      removeBtn.style.background = '#c82333';
    });
    removeBtn.addEventListener('mouseleave', () => {
      removeBtn.style.background = '#dc3545';
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
  totalDiv.style.cssText = 'margin-top: 1rem; font-weight: bold; text-align: right;';
  totalDiv.textContent = `Total: ${selectedFiles.length} file(s), ${formatBytes(totalSize)}`;
  container.appendChild(totalDiv);
}
