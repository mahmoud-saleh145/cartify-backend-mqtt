/**
 * src/middleware/videoMulter.js
 *
 * Multer configuration specifically for video uploads from hardware devices.
 *
 * Strategy: disk storage (not memory) — videos can be hundreds of MB.
 * Storing in memory would crash the Node process on large files.
 * The file is written to /tmp/cartify-uploads/, uploaded to Cloudinary,
 * then immediately deleted from disk.
 *
 * Size limit: 500 MB hard cap.
 * A typical 5-minute HD recording is 150–300 MB at moderate bitrate.
 * Adjust VIDEO_MAX_SIZE_MB in .env to change the limit.
 */

import multer   from 'multer';
import path     from 'path';
import { mkdirSync } from 'fs';
import { nanoid }    from 'nanoid';
import { AppError }  from '../utils/error.js';

const UPLOAD_TMP_DIR = process.env.VIDEO_TMP_DIR || '/tmp/cartify-uploads';
const MAX_MB         = parseInt(process.env.VIDEO_MAX_SIZE_MB || '500', 10);

// Ensure temp directory exists
try { mkdirSync(UPLOAD_TMP_DIR, { recursive: true }); } catch { /* exists */ }

const ALLOWED_VIDEO_MIME = [
  'video/mp4',
  'video/x-matroska',   // mkv — some embedded cameras output this
  'video/quicktime',    // mov
  'video/x-msvideo',    // avi
  'video/webm',
];

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_TMP_DIR),
  filename:    (_req,  file, cb) => {
    const ext = path.extname(file.originalname) || '.mp4';
    cb(null, `cam-${nanoid(10)}${ext}`);
  },
});

const fileFilter = (_req, file, cb) => {
  if (ALLOWED_VIDEO_MIME.includes(file.mimetype)) return cb(null, true);
  cb(new AppError(`Unsupported video format: ${file.mimetype}`, 400), false);
};

export const videoUpload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize:  MAX_MB * 1024 * 1024,
    files:     1,           // one video per request
  },
}).single('video');          // field name the hardware must use

/**
 * Wrap multer in a promise so async/await works cleanly in the controller.
 * Multer errors (file too large, wrong mime) are converted to AppErrors.
 */
export const handleVideoUpload = (req, res) =>
  new Promise((resolve, reject) => {
    videoUpload(req, res, (err) => {
      if (!err)                              return resolve();
      if (err.code === 'LIMIT_FILE_SIZE')    return reject(new AppError(`Video exceeds ${MAX_MB} MB limit`, 413));
      if (err instanceof multer.MulterError) return reject(new AppError(err.message, 400));
      reject(err);
    });
  });
