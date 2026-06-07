import { Schema, model } from 'mongoose';

/**
 * ReturnRequest — one document per return request.
 *
 * Lifecycle:  pending → completed | expired | denied
 *
 * Locker unlock:
 *   lockerUserId  — 6-digit numeric, shown to user, entered at locker
 *   unlockCode    — 4-digit numeric, shown to user, entered at locker
 *                   (regenerated daily server-side from lockerUserId + date + secret)
 */
const returnSchema = new Schema(
  {
    userId:    { type: Schema.Types.ObjectId, ref: 'user',  default: null },
    orderId:   { type: Schema.Types.ObjectId, ref: 'order', default: null },
    sessionId: { type: String, default: null },

    items: [
      {
        _id:       false,
        productId: { type: Schema.Types.ObjectId, ref: 'product', required: true },
        name:      { type: String, required: true },
        color:     { type: String, required: true, trim: true },
        quantity:  { type: Number, required: true, min: 1 },
      },
    ],

    reason: {
      type:     String,
      enum:     ['defective', 'wrong_size', 'changed_mind', 'wrong_item', 'other'],
      required: true,
    },
    notes: { type: String, trim: true, maxlength: 1000 },

    // ── Locker identification (replaces MQTT code) ────────────────────────
    lockerUserId: {
      type:     String,
      required: true,
      index:    true,       // lookup by user when validating at locker
    },
    // unlockCode is NOT stored — it is deterministically regenerated each
    // time it is needed (generateLockerCode(lockerUserId)). This means:
    //   • it changes daily automatically
    //   • compromising the DB does not expose working codes
    // We store the creation date so we can regenerate the code for display.
    codeGeneratedAt: { type: Date, default: Date.now },

    expiresAt: { type: Date, required: true, index: true },

    status: {
      type:    String,
      enum:    ['pending', 'completed', 'expired', 'denied'],
      default: 'pending',
      index:   true,
    },

    processedByBox: { type: String, default: null },
    completedAt:    { type: Date,   default: null },
  },
  { timestamps: true }
);

returnSchema.index({ lockerUserId: 1, status: 1 });

export default model('return', returnSchema);
