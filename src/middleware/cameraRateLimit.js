/**
 * src/middleware/cameraRateLimit.js
 *
 * Separate rate limiter for hardware device endpoints.
 *
 * Why separate?
 *   - The main API rate limiter is per-IP with a 100 req/min window.
 *   - Hardware boxes may legitimately upload a large file on every session.
 *   - We want to allow 1 upload per 30 s per box without blocking the box
 *     for its legitimate next upload.
 *   - The /upload endpoint skips express-rate-limit's default counting
 *     because the body is multipart — we apply this custom limiter instead.
 */

import rateLimit from 'express-rate-limit';

// /camera/session/start — allow up to 10 starts per box per minute
// (boxes should only call this once per return, but allow retries)
export const sessionStartLimiter = rateLimit({
  windowMs:          60 * 1000,
  max:               10,
  keyGenerator:      (req) => req.headers['x-box-id'] || req.ip,
  message:           { msg: 'error', err: 'Too many session start requests from this device' },
  standardHeaders:   true,
  legacyHeaders:     false,
});

// /camera/upload — 1 upload per box per 30 seconds
// A box should never send two videos in 30 s; if it does, something is wrong.
export const videoUploadLimiter = rateLimit({
  windowMs:          30 * 1000,
  max:               2,           // 2 to allow one immediate retry
  keyGenerator:      (req) => req.headers['x-box-id'] || req.ip,
  message:           { msg: 'error', err: 'Upload rate limit exceeded for this device' },
  standardHeaders:   true,
  legacyHeaders:     false,
});
