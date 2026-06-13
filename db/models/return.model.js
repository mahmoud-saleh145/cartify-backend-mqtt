/**
 * db/models/return.model.js  (UPDATED)
 *
 * Added three fields to support camera integration:
 *   videoUrl       — Cloudinary URL of the recorded video
 *   videoSessionId — Reference to the cameraSession document
 *   videoUploadedAt — When the video was confirmed uploaded
 *
 * All other fields and indexes are unchanged from the original.
 */

import { Schema, model } from 'mongoose';

const returnSchema = new Schema(
  {
    // ── Who / What ────────────────────────────────────────────────────────────
    userId: { type: Schema.Types.ObjectId, ref: 'user', default: null },
    orderId: { type: Schema.Types.ObjectId, ref: 'order', default: null },
    sessionId: { type: String, default: null },

    // ── Items being returned ──────────────────────────────────────────────────
    items: [
      {
        _id: false,
        productId: { type: Schema.Types.ObjectId, ref: 'product', required: true },
        name: { type: String, required: true },
        color: { type: String, required: true, trim: true },
        quantity: { type: Number, required: true, min: 1 },
      },
    ],

    // ── Return reason ─────────────────────────────────────────────────────────
    reason: {
      type: String,
      enum: ['defective', 'wrong_size', 'changed_mind', 'wrong_item', 'other'],
      required: true,
    },
    notes: { type: String, trim: true, maxlength: 1000 },

    // ── Locker code ───────────────────────────────────────────────────────────
    lockerUserId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    // ── Validity window ───────────────────────────────────────────────────────
    expiresAt: { type: Date, required: true, index: true },

    // ── Status ────────────────────────────────────────────────────────────────
    status: {
      type: String,
      enum: ['pending', 'completed', 'expired', 'denied'],
      default: 'pending',
      index: true,
    },

    processedByBox: { type: String, default: null },
    completedAt: { type: Date, default: null },

    // ── Camera integration (NEW) ──────────────────────────────────────────────
    videoUrl: { type: String, default: null },
    videoSessionId: { type: Schema.Types.ObjectId, ref: 'cameraSession', default: null },
    videoUploadedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export default model('return', returnSchema);
