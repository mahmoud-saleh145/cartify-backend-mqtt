/**
 * Cartify — Smart Locker Code Generator
 *
 * Algorithm:
 *   input  = "YYYYMMDD:userId:SECRET_KEY"
 *   hash   = SHA-256(input)
 *   code   = (parseInt(hash[0..7], 16) % 9000) + 1000   → always 4 digits
 *
 * Daily-rotating. Per-user unique. Offline-compatible.
 * Secret key NEVER sent to frontend.
 */

import { createHash } from 'crypto';

/**
 * Return today's date as YYYYMMDD (UTC).
 */
function todayUTC() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * Return yesterday's date as YYYYMMDD (UTC) — used as fallback validation window.
 */
function yesterdayUTC() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * Generate the 4-digit locker unlock code for a given userId and date.
 *
 * @param {string} userId   — the numeric userId stored on the return request
 * @param {string} [dateStr] — YYYYMMDD; defaults to today UTC
 * @returns {string}         — exactly 4 digits, e.g. "4821"
 */
export function generateLockerCode(userId, dateStr = null) {
  const key    = process.env.LOCKER_SECRET_KEY;
  if (!key)    throw new Error('LOCKER_SECRET_KEY is not set in environment');
  const date   = dateStr || todayUTC();
  const input  = `${date}:${String(userId)}:${key}`;
  const hash   = createHash('sha256').update(input, 'utf8').digest('hex');
  const raw    = parseInt(hash.substring(0, 8), 16);   // first 4 bytes → uint32
  const code   = (raw % 9000) + 1000;                  // 1000–9999
  return String(code);
}

/**
 * Validate an entered code against today + yesterday (48-hour window).
 *
 * @param {string} userId
 * @param {string} enteredCode
 * @returns {boolean}
 */
export function validateLockerCode(userId, enteredCode) {
  if (!enteredCode || typeof enteredCode !== 'string') return false;
  return (
    enteredCode === generateLockerCode(userId, todayUTC()) ||
    enteredCode === generateLockerCode(userId, yesterdayUTC())
  );
}

/**
 * Generate a random 6-digit numeric user ID for a return request.
 * Simple, user-friendly, not a security secret.
 */
export function generateLockerUserId() {
  return String(Math.floor(100000 + Math.random() * 900000));
}
