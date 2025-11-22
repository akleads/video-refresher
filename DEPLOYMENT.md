# Deployment Guide - Cloudflare Pages

This application has been converted to a static web application that can be deployed on Cloudflare Pages (or any static hosting service).

## What Changed

- ✅ Converted from Node.js CLI script to a web application
- ✅ Replaced `fluent-ffmpeg` with `ffmpeg.wasm` (browser-based FFmpeg)
- ✅ All processing happens in the browser (no backend needed)
- ✅ Videos are processed locally and never leave the user's device

## Files Structure

```
VIDEO REFRESHER/
├── index.html      # Main HTML file
├── styles.css      # Styling
├── app.js          # Application logic (uses ffmpeg.wasm)
└── (old files - can be removed)
    ├── script.js   # Old CLI script (no longer needed)
    ├── videos/     # No longer needed
    └── output/     # No longer needed
```

## Deploying to Cloudflare Pages

### Method 1: Via Cloudflare Dashboard (Recommended)

1. **Create a GitHub Repository**
   - Push your project to GitHub (you only need `index.html`, `styles.css`, and `app.js`)

2. **Connect to Cloudflare Pages**
   - Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
   - Navigate to **Pages** → **Create a project**
   - Connect your GitHub repository
   - Configure build settings:
     - **Framework preset**: None
     - **Build command**: (leave empty)
     - **Build output directory**: `/` (root)
   - Click **Save and Deploy**

3. **Your site is live!**
   - Cloudflare will provide you with a URL (e.g., `your-app.pages.dev`)

### Method 2: Via Wrangler CLI

1. **Install Wrangler** (if not already installed):
   ```bash
   npm install -g wrangler
   ```

2. **Login to Cloudflare**:
   ```bash
   wrangler login
   ```

3. **Deploy**:
   ```bash
   wrangler pages deploy . --project-name=video-refresher
   ```

## Important Notes

### Performance Considerations

- **File Size**: Large video files (> 500MB) may cause browser memory issues
- **Processing Time**: Video processing in the browser can take several minutes depending on:
  - Video length
  - Video resolution
  - Device performance
- **Browser Compatibility**: 
  - Requires modern browsers with WebAssembly support
  - Chrome, Firefox, Edge, Safari (latest versions)

### Security & Privacy

- ✅ All processing happens in the browser
- ✅ Videos never leave the user's device
- ✅ No backend server required
- ✅ No data is stored on Cloudflare servers

### Limitations

- **Memory**: Very large videos may fail due to browser memory limits
- **Time**: Long videos may take considerable time to process
- **Format**: Currently only supports MP4 input files

## Alternative Deployment Options

Since this is now a static website, you can also deploy to:

- **GitHub Pages**: Free static hosting
- **Netlify**: Similar to Cloudflare Pages
- **Vercel**: Another excellent option
- **Any web hosting**: Just upload the HTML, CSS, and JS files

## Testing Locally

1. **Simple HTTP Server**:
   ```bash
   # Using Python
   python3 -m http.server 8000
   
   # Using Node.js (if you have http-server installed)
   npx http-server
   ```

2. **Open in browser**:
   - Navigate to `http://localhost:8000`
   - Upload a test MP4 file

## Troubleshooting

### FFmpeg fails to load
- Check browser console for errors
- Ensure you have a stable internet connection (CDN resources need to load)
- Try refreshing the page

### Processing fails
- File might be too large (> 500MB recommended limit)
- Video might be corrupted
- Check browser console for detailed error messages

### Slow processing
- This is normal for browser-based video processing
- Consider reducing video resolution before processing
- Close other browser tabs to free up memory

