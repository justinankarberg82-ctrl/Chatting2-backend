import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { serverBootSec } from '../serverBoot.js';

export default async function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.sendStatus(401);

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);

    // Force re-login after server restart.
    if (typeof req.user?.iat === 'number' && req.user.iat < serverBootSec) {
      return res.status(401).json({ message: 'Session expired' });
    }

    const user = await User.findById(req.user.id).select('isActive activeSession.sessionId');
    if (!user) return res.sendStatus(401);
    if (!user.isActive) return res.status(403).json({ message: 'Account disabled' });

    // Enforce single-session tokens.
    const tokenSid = req.user?.sid ? String(req.user.sid) : '';
    const currentSid = user?.activeSession?.sessionId ? String(user.activeSession.sessionId) : '';
    if (!tokenSid || !currentSid || tokenSid !== currentSid) {
      return res.status(401).json({ message: 'Session expired' });
    }
    next();
  } catch {
    res.sendStatus(401);
  }
}
