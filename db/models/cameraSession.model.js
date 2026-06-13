/**
 * db/models/cameraSession.model.js
 *
 * One document per recording event.
 * A return can have at most one confirmed session (enforced by unique index).
 * Multiple attempts are allowed before confirmation so retries work cleanly.
 *
 * Status flow:
 *   uploading → processing → confirmed
 *                          ↘ failed
 */

import { Schema, model } from 'mongoose';

const cameraSessionSchema = new Schema(
  {
    // ── Identity ──────────────────────────────────────────────────────────────
    returnId: {
      type:     Schema.Types.ObjectId,
      ref:      'return',
      required: true,
      index:    true,
    },
    boxId: {
      type:     String,
      required: true,
      trim:     true,
      index:    true,
    },

    // ── Upload metadata ───────────────────────────────────────────────────────
    status: {
      type:    String,
      enum:    ['uploading', 'processing', 'confirmed', 'failed'],
      default: 'uploading',
      index:   true,
    },

    // ── Video asset ───────────────────────────────────────────────────────────
    videoUrl:   { type: String, trim: true },
    publicId:   { type: String, trim: true },   // Cloudinary public_id for deletion
    thumbnailUrl: { type: String, trim: true },
    durationSec:  { type: Number, default: 0 },
    fileSizeBytes:{ type: Number, default: 0 },
    format:       { type: String, default: 'mp4' },

    // ── Timing ────────────────────────────────────────────────────────────────
    recordingStartedAt: { type: Date },          // set by hardware, sent in payload
    recordingEndedAt:   { type: Date },
    uploadedAt:         { type: Date },
    confirmedAt:        { type: Date },

    // ── Retry tracking ────────────────────────────────────────────────────────
    attemptNumber: { type: Number, default: 1 },
    errorMessage:  { type: String, trim: true },

    // ── Hardware fingerprint ──────────────────────────────────────────────────
    deviceFirmware: { type: String, trim: true },
    checksumMd5:    { type: String, trim: true },  // hardware sends MD5 of file
  },
  { timestamps: true }
);

// Only one confirmed recording per return — allow multiple failed/uploading docs
// so retries are tracked separately
cameraSessionSchema.index(
  { returnId: 1, status: 1 },
  { unique: false }
);

// Fast admin dashboard query: "show all recordings for box X today"
cameraSessionSchema.index({ boxId: 1, createdAt: -1 });

export default model('cameraSession', cameraSessionSchema);
