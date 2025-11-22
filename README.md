# 🎬 Video Refresher - Web Application

A browser-based video processing tool that applies subtle transformations to MP4 videos. All processing happens locally in your browser - your videos never leave your device.

## ✨ Features

- **Browser-based processing**: Uses FFmpeg WebAssembly (ffmpeg.wasm)
- **No backend required**: Entirely client-side application
- **Privacy-focused**: Videos are processed locally, never uploaded
- **Same transformations as original CLI script**:
  - Minimal rotation (0.2°)
  - Slight color adjustments (brightness, contrast, saturation)
  - Frame rate adjustment to 29.97 fps
  - Bitrate optimization
  - Metadata removal

## 🚀 Quick Start

### Test Locally

1. **Start a local server** (required for ES modules and SharedArrayBuffer):
   ```bash
   # Recommended: Use the custom server with required headers
   python3 server.py
   
   # Or using npm script
   npm run dev
   
   # Alternative: Simple server (may not work due to missing headers)
   python3 -m http.server 8000
   ```
   
   **Important:** The custom `server.py` sets required HTTP headers (`Cross-Origin-Embedder-Policy` and `Cross-Origin-Opener-Policy`) that are needed for FFmpeg.wasm to use SharedArrayBuffer.

2. **Open in browser**:
   - Navigate to `http://localhost:8000`
   - Upload an MP4 file and wait for processing

### Deploy to Cloudflare Pages

See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed deployment instructions.

**Quick steps:**
1. Push `index.html`, `styles.css`, and `app.js` to a GitHub repository
2. Go to Cloudflare Dashboard → Pages → Create a project
3. Connect your repository
4. Deploy! (No build step needed)

## 📁 Project Structure

```
VIDEO REFRESHER/
├── index.html      # Main HTML file
├── styles.css      # Styling
├── app.js          # Application logic (uses ffmpeg.wasm)
├── package.json    # Project metadata
├── README.md       # This file
└── DEPLOYMENT.md   # Deployment guide
```

## ⚠️ Important Notes

### Performance
- **File Size**: Recommended limit is 500MB per video
- **Processing Time**: Can take several minutes depending on video length and device performance
- **Memory**: Large videos may cause browser memory issues

### Browser Compatibility
- Requires modern browsers with WebAssembly support
- Chrome, Firefox, Edge, Safari (latest versions)
- Internet connection required for initial FFmpeg loading (CDN)

### Limitations
- Only supports MP4 input files
- Processing happens in the browser (limited by device performance)
- Very large videos (> 1GB) may not work

## 🔧 Technical Details

### Technology Stack
- **HTML5**: Structure
- **CSS3**: Styling with modern gradients and animations
- **JavaScript (ES6 Modules)**: Application logic
- **ffmpeg.wasm**: FFmpeg compiled to WebAssembly for browser use

### How It Works
1. User uploads an MP4 file
2. FFmpeg.wasm is loaded (if not already loaded)
3. Video is processed entirely in the browser
4. Processed video is available for download
5. All processing happens locally - no server involvement

## 🆘 Troubleshooting

**FFmpeg fails to load?**
- Check internet connection (CDN resources need to load)
- Refresh the page
- Check browser console for errors

**Processing fails?**
- File might be too large (> 500MB recommended limit)
- Video might be corrupted
- Check browser console for detailed error messages

**Very slow processing?**
- This is normal for browser-based video processing
- Consider reducing video resolution before processing
- Close other browser tabs to free up memory

## 📝 Migration from CLI Version

If you were using the old CLI version:
- **Old**: `node script.js` (processed videos from `videos/` folder)
- **New**: Upload videos through the web interface
- The old `script.js` file is no longer needed
- The `videos/` and `output/` folders are no longer needed

## 📄 License

ISC

## 🤝 Contributing

Feel free to submit issues or pull requests!

