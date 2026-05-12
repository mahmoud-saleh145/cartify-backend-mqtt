import returnModel  from '../../../db/models/return.model.js';
import connectToDB   from '../../../db/connectionDB.js';
import { AppError, asyncHandler } from '../../utils/error.js';
import { sendSuccess } from '../../utils/response.js';
import { generateRandomCode } from '../../utils/counter.js';

/** How long a return code stays valid (48 hours matches the frontend UI copy) */
const CODE_TTL_MS = 48 * 60 * 60 * 1000;

// ── POST /returns ─────────────────────────────────────────────────────────────
export const createReturn = asyncHandler(async (req, res) => {
  await connectToDB();
  const { orderId, reason, notes, items } = req.body;

  // Generate a unique 6-char uppercase code — retry once on the rare collision
  let code = generateRandomCode(6);
  if (await returnModel.findOne({ code })) code = generateRandomCode(6);

  const returnRequest = await returnModel.create({
    userId:    req.user?._id     || null,
    sessionId: req.sessionId     || null,
    orderId:   orderId           || null,
    items,
    reason,
    notes:     notes             || '',
    code,
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
    status:    'pending',
  });

  sendSuccess(res, 201, 'success', { returnRequest });
});

// ── GET /returns/my ───────────────────────────────────────────────────────────
export const getMyReturns = asyncHandler(async (req, res) => {
  await connectToDB();
  const filter = req.user ? { userId: req.user._id } : { sessionId: req.sessionId };
  const { page=1, limit=10 } = req.query;
  const p    = Math.max(parseInt(page)  || 1,  1);
  const l    = Math.min(parseInt(limit) || 10, 50);
  const skip = (p - 1) * l;

  const total   = await returnModel.countDocuments(filter);
  const returns = await returnModel
    .find(filter)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(l)
    .populate('orderId', 'randomId totalPrice');

  sendSuccess(res, 200, 'success', { page:p, limit:l, total, totalPages:Math.ceil(total/l), returns });
});

// ── GET /returns/:id ──────────────────────────────────────────────────────────
export const getReturnById = asyncHandler(async (req, res, next) => {
  await connectToDB();
  const returnRequest = await returnModel
    .findById(req.params.id)
    .populate('orderId', 'randomId totalPrice status');

  if (!returnRequest) return next(new AppError('Return request not found', 404));

  // Ownership check — admin sees all, others only their own
  if (req.user?.role !== 'admin') {
    const isOwner =
      (req.user     && returnRequest.userId?.toString() === req.user._id.toString()) ||
      (req.sessionId && returnRequest.sessionId          === req.sessionId);
    if (!isOwner) return next(new AppError('Access denied', 403));
  }

  sendSuccess(res, 200, 'success', { returnRequest });
});

// ── GET /returns (admin) ──────────────────────────────────────────────────────
export const getAllReturns = asyncHandler(async (req, res) => {
  await connectToDB();
  const { page=1, limit=20, status, search } = req.query;
  const p    = Math.max(parseInt(page)  || 1,  1);
  const l    = Math.min(parseInt(limit) || 20, 100);
  const skip = (p - 1) * l;

  const filter = {};
  if (status) filter.status = status;
  if (search) {
    const re = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { code:   { $regex: re, $options: 'i' } },
      { reason: { $regex: re, $options: 'i' } },
    ];
  }

  const total   = await returnModel.countDocuments(filter);
  const returns = await returnModel
    .find(filter)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(l)
    .populate('userId',  'firstName lastName email')
    .populate('orderId', 'randomId totalPrice');

  sendSuccess(res, 200, 'success', { page:p, limit:l, total, totalPages:Math.ceil(total/l), returns });
});

// ── PATCH /returns/:id (admin — manual status override) ───────────────────────
export const updateReturn = asyncHandler(async (req, res, next) => {
  await connectToDB();
  const returnRequest = await returnModel.findById(req.params.id);
  if (!returnRequest) return next(new AppError('Return request not found', 404));

  const { status } = req.body;
  const ALLOWED = ['pending', 'completed', 'expired', 'denied'];
  if (!ALLOWED.includes(status)) return next(new AppError(`Status must be one of: ${ALLOWED.join(', ')}`, 400));

  returnRequest.status = status;
  if (status === 'completed' && !returnRequest.completedAt) {
    returnRequest.completedAt = new Date();
  }
  await returnRequest.save();
  sendSuccess(res, 200, 'success', { returnRequest });
});
