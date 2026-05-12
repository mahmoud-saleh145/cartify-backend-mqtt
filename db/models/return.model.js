import { Schema, model } from 'mongoose';

/**
 * ReturnRequest — one document per return request raised by a user.
 *
 * Lifecycle:
 *   pending  → box scans code → completed
 *                             → expired  (TTL or manual)
 *                             → denied
 */
const returnSchema = new Schema(
  {
    // ── Who / What ────────────────────────────────────────────────────────────
    userId:    { type: Schema.Types.ObjectId, ref: 'user',    default: null },
    orderId:   { type: Schema.Types.ObjectId, ref: 'order',   default: null },
    sessionId: { type: String, default: null },

    // ── Items being returned ──────────────────────────────────────────────────
    items: [
      {
        _id:       false,
        productId: { type: Schema.Types.ObjectId, ref: 'product', required: true },
        name:      { type: String, required: true },
        color:     { type: String, required: true, trim: true },
        quantity:  { type: Number, required: true, min: 1 },
      },
    ],

    // ── Return reason (matches frontend chips) ────────────────────────────────
    reason: {
      type: String,
      enum: ['defective', 'wrong_size', 'changed_mind', 'wrong_item', 'other'],
      required: true,
    },
    notes: { type: String, trim: true, maxlength: 1000 },

    // ── Short code sent to the user — validated by the physical box ───────────
    code: {
      type:     String,
      required: true,
      unique:   true,
      uppercase: true,
      trim:     true,
      index:    true,         // hot lookup path — MQTT hits this on every scan
    },

    // ── Validity window ───────────────────────────────────────────────────────
    expiresAt: {
      type:     Date,
      required: true,
      index:    true,
    },

    // ── Status ────────────────────────────────────────────────────────────────
    status: {
      type:    String,
      enum:    ['pending', 'completed', 'expired', 'denied'],
      default: 'pending',
      index:   true,
    },

    // ── Which physical box processed the return ───────────────────────────────
    processedByBox: { type: String, default: null },
    completedAt:    { type: Date,   default: null },
  },
  { timestamps: true }
);

// Compound index — MQTT handler queries by code AND status together
returnSchema.index({ code: 1, status: 1 });

export default model('return', returnSchema);
