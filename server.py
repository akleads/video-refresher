#!/usr/bin/env python3
"""
Simple HTTP server with required headers for FFmpeg.wasm
This server sets Cross-Origin-Embedder-Policy and Cross-Origin-Opener-Policy
headers that are required for SharedArrayBuffer (used by FFmpeg.wasm)
"""
import http.server
import socketserver
from urllib.parse import urlparse

class CORSRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Required headers for SharedArrayBuffer
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

    def log_message(self, format, *args):
        # Suppress default logging for cleaner output
        pass

if __name__ == '__main__':
    PORT = 8000
    
    with socketserver.TCPServer(("", PORT), CORSRequestHandler) as httpd:
        print(f"Server running at http://localhost:{PORT}/")
        print("Press Ctrl+C to stop the server")
        httpd.serve_forever()

