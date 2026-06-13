/**
 * src/modules/camera/camera.routes.js
 *
 * Route layout:
 *
 *   Hardware-facing (device auth only):
 *     POST /camera/session/start   — box signals recording start
 *     POST /camera/upload          — box sends video file
 *
 *   Admin-facing (admin JWT required):
 *     GET  /camera/sessions        — list all recordings
 *     GET  /camera/session/:id     — single session detail
 *     GET  /camera/return/:returnId — recording for a return
 *     DELETE /camera/session/:id   — remove a recording
 */

import { Router }     from 'express';
import { deviceAuth } from '../../middleware/deviceAuth.js';
import { protectRoute, adminOnly } from '../../middleware/auth.js';
import { validate, mongoIdParam }  from '../../middleware/validation.js';
import * as CC from './camera.controller.js';

const router = Router();

// ── Hardware endpoints ────────────────────────────────────────────────────────
// These use deviceAuth instead of JWT — no user login needed.
// Rate-limited separately in index.js (see integration section below).

router.post('/session/start', deviceAuth, CC.startSession);
router.post('/upload',        deviceAuth, CC.uploadVideo);
// NOTE: /upload does NOT use express.json() body parsing — multer handles it.
// The multer middleware is applied INSIDE the controller via handleVideoUpload().

// ── Admin endpoints ───────────────────────────────────────────────────────────
router.use(protectRoute, adminOnly);

router.get('/sessions',                             CC.listSessions);
router.get('/session/:id',   ...mongoIdParam('id'), validate, CC.getSession);
router.get('/return/:returnId', ...mongoIdParam('returnId'), validate, CC.getSessionByReturn);
router.delete('/session/:id', ...mongoIdParam('id'), validate, CC.deleteSession);

export default router;
