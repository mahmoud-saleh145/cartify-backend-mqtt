/**
 * src/middleware/deviceAuth.js
 *
 * Hardware boxes authenticate with a shared API key sent in the
 * X-Device-Key header.  Each box also identifies itself via X-Box-Id.
 *
 * Why not JWT?
 *   Hardware devices rarely have a good way to refresh tokens.
 *   A per-device API key stored in firmware is simpler and secure
 *   enough when combined with TLS + IP allowlisting in production.
 *
 * In production, rotate keys quarterly and store them in an env-managed
 * secrets manager (AWS Secrets Manager / Doppler / etc.).
 */

import { AppError } from '../utils/error.js';

/**
 * Validate the device API key and attach boxId to the request.
 * Applied only to /camera/* routes.
 */
export const deviceAuth = (req, res, next) => {
  const apiKey = req.headers['x-device-key'];
  const boxId  = req.headers['x-box-id'];

  if (!apiKey) {
    return next(new AppError('Missing X-Device-Key header', 401));
  }
  if (!boxId || typeof boxId !== 'string' || !boxId.trim()) {
    return next(new AppError('Missing or invalid X-Box-Id header', 401));
  }

  // DEVICE_API_KEY in .env — a single shared key for all boxes in MVP.
  // For per-device keys, store a hash map in the DB and look up by boxId.
  const validKey = process.env.DEVICE_API_KEY;
  if (!validKey) {
    console.error('[deviceAuth] DEVICE_API_KEY is not set in environment');
    return next(new AppError('Server configuration error', 500));
  }

  // Constant-time comparison to prevent timing attacks
  const provided = Buffer.from(apiKey);
  const expected = Buffer.from(validKey);
  if (
    provided.length !== expected.length ||
    !require('crypto').timingSafeEqual(provided, expected)
  ) {
    return next(new AppError('Invalid device API key', 403));
  }

  req.boxId = boxId.trim();
  next();
};
