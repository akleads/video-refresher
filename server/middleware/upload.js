import multer from 'multer';
import path from 'node:path';
import { generateId } from '../lib/id.js';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './data/uploads';

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${generateId()}${ext}`);
  }
});

export const upload = multer({
  storage,
  limits: {
    fileSize: 500 * 1024 * 1024,  // 500MB per file
    files: 10                       // max 10 files per request
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'video/mp4') {
      cb(null, true);
    } else {
      cb(new Error('Only MP4 files are accepted'), false);
    }
  }
});
