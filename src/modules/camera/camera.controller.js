/**
 * src/modules/camera/camera.controller.js
 *
 * Handles the full lifecycle of a camera recording event:
 *
 *   POST /camera/session/start   ← box signals it is about to record
 *   POST /camera/upload          ← box sends the completed video file
 *   GET  /camera/session/:id     ← admin fetches session details
 *   GET  /camera/return/:returnId ← admin fetches recording for a return
 *   DELETE /camera/session/:id   ← admin removes a recording
 */

import fs                   from 'fs';
import crypto               from 'crypto';
import cameraSessionModel   from '../../../db/models/cameraSession.model.js';
import returnModel          from '../../../db/models/return.model.js';
import connectToDB          from '../../../db/connectionDB.js';
import { AppError, asyncHandler } from '../../utils/error.js';
import { sendSuccess }      from '../../utils/response.js';
import { uploadVideoToCloud, deleteVideoFromCloud } from '../../utils/videoUpload.js';
import { handleVideoUpload } from '../../middleware/videoMulter.js';

// ── POST /camera/session/start ───────────────────────────────────────────────
/**
 * Called by the box BEFORE it starts recording.
 * Creates a "uploading" session document so the admin can see
 * "Recording in progress" in the dashboard immediately.
 *
 * Body: { returnId, recordingStartedAt? }
 * Headers: X-Device-Key, X-Box-Id
 */
export const startSession = asyncHandler(async (req, res, next) => {
  await connectToDB();

  const { returnId, recordingStartedAt } = req.body;
  const boxId = req.boxId;   // set by deviceAuth middleware

  if (!returnId) return next(new AppError('returnId is required', 400));

  // Validate the return exists and belongs to this box's region
  const returnDoc = await returnModel.findById(returnId);
  if (!returnDoc) return next(new AppError('Return request not found', 404));
  if (returnDoc.status !== 'pending') {
    return next(new AppError(`Cannot record — return status is "${returnDoc.status}"`, 409));
  }

  // Prevent duplicate active sessions for the same return
  const existing = await cameraSessionModel.findOne({
    returnId,
    status: { $in: ['uploading', 'processing', 'confirmed'] },
  });
  if (existing) {
    return next(new AppError('A session already exists for this return', 409));
  }

  // Count previous attempts for this return (for retry tracking)
  const attemptNumber = await cameraSessionModel.countDocuments({ returnId }) + 1;

  const session = await cameraSessionModel.create({
    returnId,
    boxId,
    status:             'uploading',
    recordingStartedAt: recordingStartedAt ? new Date(recordingStartedAt) : new Date(),
    attemptNumber,
  });

  sendSuccess(res, 201, 'success', { sessionId: session._id });
});

// ── POST /camera/upload ──────────────────────────────────────────────────────
/**
 * The box sends the finished video file via multipart/form-data.
 *
 * Fields:
 *   video          (file)    — the video file, field name must be "video"
 *   returnId       (text)    — MongoDB ObjectId of the return
 *   sessionId      (text)    — the ID returned by /camera/session/start
 *   recordingEndedAt (text)  — ISO timestamp when recording stopped
 *   checksumMd5    (text)    — MD5 hash of the file computed on-device
 *   firmwareVersion (text)   — optional, for diagnostics
 *
 * Flow:
 *   1. Parse multipart upload to disk (videoMulter)
 *   2. Verify MD5 checksum if provided
 *   3. Stream file to Cloudinary
 *   4. Update cameraSession document
 *   5. Attach videoUrl to return document
 *   6. Delete temp file from disk
 */
export const uploadVideo = asyncHandler(async (req, res, next) => {
  await connectToDB();

  // ── Step 1: Parse the multipart upload ────────────────────────────────────
  try {
    await handleVideoUpload(req, res);
  } catch (err) {
    return next(err);
  }

  if (!req.file) return next(new AppError('No video file received', 400));

  const {
    returnId,
    sessionId,
    recordingEndedAt,
    checksumMd5,
    firmwareVersion,
  } = req.body;

  const boxId    = req.boxId;
  const tmpPath  = req.file.path;

  // Helper to clean up temp file in all error paths
  const cleanup = () => {
    try { fs.unlinkSync(tmpPath); } catch { /* already gone */ }
  };

  if (!returnId) { cleanup(); return next(new AppError('returnId is required', 400)); }

  // ── Step 2: Verify MD5 checksum ────────────────────────────────────────────
  if (checksumMd5) {
    const fileBuffer = fs.readFileSync(tmpPath);
    const computed   = crypto.createHash('md5').update(fileBuffer).digest('hex');
    if (computed !== checksumMd5.toLowerCase()) {
      cleanup();
      return next(new AppError(
        `Checksum mismatch — expected ${checksumMd5}, got ${computed}. File may be corrupt.`,
        422
      ));
    }
  }

  // ── Step 3: Find or create the session document ────────────────────────────
  let session;
  if (sessionId) {
    session = await cameraSessionModel.findById(sessionId);
    if (!session) { cleanup(); return next(new AppError('Session not found', 404)); }
    if (session.boxId !== boxId) {
      cleanup();
      return next(new AppError('Box ID does not match session', 403));
    }
  } else {
    // Box skipped /start — create session now (simpler firmware implementations)
    const returnDoc = await returnModel.findById(returnId);
    if (!returnDoc) { cleanup(); return next(new AppError('Return not found', 404)); }
    const attemptNumber = await cameraSessionModel.countDocuments({ returnId }) + 1;
    session = await cameraSessionModel.create({
      returnId,
      boxId,
      status:         'uploading',
      attemptNumber,
      recordingStartedAt: new Date(),
    });
  }

  // Mark session as processing (upload to cloud is about to start)
  session.status           = 'processing';
  session.recordingEndedAt = recordingEndedAt ? new Date(recordingEndedAt) : new Date();
  session.checksumMd5      = checksumMd5      || null;
  session.deviceFirmware   = firmwareVersion  || null;
  session.fileSizeBytes    = req.file.size;
  await session.save();

  // ── Step 4: Stream to Cloudinary ────────────────────────────────────────────
  let cloudResult;
  try {
    const fileStream = fs.createReadStream(tmpPath);
    cloudResult = await uploadVideoToCloud(fileStream, {
      returnId:         returnId,
      boxId:            boxId,
      sessionTimestamp: session.recordingStartedAt?.getTime() || Date.now(),
    });
  } catch (cloudErr) {
    console.error('[camera] Cloudinary upload failed:', cloudErr.message);
    session.status       = 'failed';
    session.errorMessage = cloudErr.message;
    await session.save();
    cleanup();
    return next(new AppError('Video upload to cloud storage failed', 502));
  }

  // ── Step 5: Update session with cloud result ────────────────────────────────
  session.status       = 'confirmed';
  session.videoUrl     = cloudResult.url;
  session.publicId     = cloudResult.publicId;
  session.thumbnailUrl = cloudResult.thumbnail;
  session.durationSec  = cloudResult.duration;
  session.fileSizeBytes= cloudResult.bytes;
  session.format       = cloudResult.format;
  session.uploadedAt   = new Date();
  session.confirmedAt  = new Date();
  await session.save();

  // ── Step 6: Attach video URL to return document ────────────────────────────
  await returnModel.findByIdAndUpdate(returnId, {
    $set: {
      videoUrl:       cloudResult.url,
      videoSessionId: session._id,
      videoUploadedAt: new Date(),
    },
  });

  // ── Step 7: Delete temp file ───────────────────────────────────────────────
  cleanup();

  sendSuccess(res, 200, 'success', {
    sessionId:    session._id,
    videoUrl:     cloudResult.url,
    thumbnailUrl: cloudResult.thumbnail,
    durationSec:  cloudResult.duration,
  });
});

// ── GET /camera/session/:id ──────────────────────────────────────────────────
export const getSession = asyncHandler(async (req, res, next) => {
  await connectToDB();
  const session = await cameraSessionModel
    .findById(req.params.id)
    .populate('returnId', 'code status reason createdAt');
  if (!session) return next(new AppError('Session not found', 404));
  sendSuccess(res, 200, 'success', { session });
});

// ── GET /camera/return/:returnId ─────────────────────────────────────────────
export const getSessionByReturn = asyncHandler(async (req, res, next) => {
  await connectToDB();
  const session = await cameraSessionModel
    .findOne({ returnId: req.params.returnId, status: 'confirmed' })
    .sort({ createdAt: -1 });
  if (!session) return next(new AppError('No confirmed recording found for this return', 404));
  sendSuccess(res, 200, 'success', { session });
});

// ── GET /camera/sessions ─────────────────────────────────────────────────────
export const listSessions = asyncHandler(async (req, res) => {
  await connectToDB();
  const { page = 1, limit = 20, status, boxId } = req.query;
  const p    = Math.max(parseInt(page)  || 1, 1);
  const l    = Math.min(parseInt(limit) || 20, 100);
  const skip = (p - 1) * l;

  const filter = {};
  if (status) filter.status = status;
  if (boxId)  filter.boxId  = boxId;

  const total    = await cameraSessionModel.countDocuments(filter);
  const sessions = await cameraSessionModel
    .find(filter)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(l)
    .populate('returnId', 'code status reason');

  sendSuccess(res, 200, 'success', {
    page: p, limit: l, total,
    totalPages: Math.ceil(total / l),
    sessions,
  });
});

// ── DELETE /camera/session/:id ───────────────────────────────────────────────
export const deleteSession = asyncHandler(async (req, res, next) => {
  await connectToDB();
  const session = await cameraSessionModel.findById(req.params.id);
  if (!session) return next(new AppError('Session not found', 404));

  // Remove from Cloudinary if it was uploaded
  if (session.publicId) {
    await deleteVideoFromCloud(session.publicId).catch(err =>
      console.warn('[camera] Cloudinary delete failed:', err.message)
    );
  }

  // Remove video reference from return document
  if (session.returnId) {
    await returnModel.findByIdAndUpdate(session.returnId, {
      $unset: { videoUrl: '', videoSessionId: '', videoUploadedAt: '' },
    });
  }

  await session.deleteOne();
  sendSuccess(res, 200, 'success', { message: 'Session deleted' });
});
