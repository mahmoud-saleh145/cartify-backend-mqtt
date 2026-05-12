import { v4 as uuidv4 } from 'uuid';

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

export const attachSession = (req, res, next) => {
  if (req.user) { req.sessionId = null; return next(); }
  let sessionId = req.cookies?.sessionId;
  if (!sessionId) {
    sessionId = uuidv4();
    res.cookie('sessionId', sessionId, {
      httpOnly: true,
      maxAge:   SEVEN_DAYS,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      path:     '/',
    });
  }
  req.sessionId = sessionId;
  next();
};

export const clearSessionCookie = (res) => {
  res.clearCookie('sessionId', {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    path:     '/',
  });
};
