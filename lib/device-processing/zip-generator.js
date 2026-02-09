/**
 * ZIP generation module for bundling processed videos
 * Uses client-zip for streaming ZIP file creation
 */

/**
 * Generate a ZIP file from an array of files
 * @param {Array<{name: string, blob: Blob}>} files - Files to include in ZIP
 * @returns {Promise<Blob>} ZIP file as Blob
 */
export async function generateZip(files) {
  try {
    // Dynamic import from CDN
    const { downloadZip } = await import('https://esm.sh/client-zip@2');

    // Convert to format expected by client-zip
    const zipFiles = files.map(file => ({
      name: file.name,
      input: file.blob
    }));

    // Generate ZIP (returns Response)
    const zipResponse = await downloadZip(zipFiles);

    // Convert Response to Blob
    const zipBlob = await zipResponse.blob();

    return zipBlob;
  } catch (error) {
    throw new Error(`Failed to generate ZIP file: ${error.message}`);
  }
}

/**
 * Trigger download of a blob via temporary anchor element
 * @param {Blob} blob - Blob to download
 * @param {string} filename - Download filename
 */
export function triggerDownload(blob, filename) {
  try {
    // Create blob URL
    const url = URL.createObjectURL(blob);

    // Create temporary anchor
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';

    // Trigger download
    document.body.appendChild(anchor);
    anchor.click();

    // Clean up immediately
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  } catch (error) {
    throw new Error(`Failed to trigger download: ${error.message}`);
  }
}
