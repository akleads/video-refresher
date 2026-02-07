export function errorHandler(err, req, res, next) {
  console.error(err.stack);

  // Handle Multer-specific errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File too large' });
  }
  if (err.code === 'LIMIT_FILE_COUNT') {
    return res.status(400).json({ error: 'Too many files' });
  }

  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
}
