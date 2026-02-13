import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import User from '../models/User.js';
import auth from '../middleware/authMiddleware.js';
import { emitAdminEvent } from '../realtime.js';
import LogoutEvent from '../models/LogoutEvent.js';
import { serverBootSec } from '../serverBoot.js';

const router = express.Router();

// registration disabled (admin creates users)

router.post('/login', async (req, res) => {
  try {
    let { username } = req.body;
    if (!username) return res.sendStatus(400);

    // normalize username
    username = username.trim();

    // case-insensitive username lookup
    const user = await User.findOne({ username: new RegExp(`^${username}$`, 'i') });
    if (!user) {
      return res.status(401).json({ error: 'Invalid username' });
    }
    if (!user.isActive) {
      return res.status(401).json({ error: 'Account disabled' });
    }

    if (!process.env.JWT_SECRET) {
      console.error('JWT_SECRET is not defined');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const now = new Date();
    const sessionId = crypto.randomBytes(18).toString('hex');

    // Prevent concurrent logins for the same username.
    // Safety valve: if we never observed a logout/disconnect, allow re-login after 12 hours.
    const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1000);
    const locked = await User.findOneAndUpdate(
      {
        _id: user._id,
        isActive: true,
        $or: [
          { 'activeSession.sessionId': { $exists: false } },
          { 'activeSession.sessionId': null },
          { 'activeSession.bootSec': { $ne: serverBootSec } },
          { 'activeSession.createdAt': { $lt: cutoff } },
        ],
      },
      {
        $set: {
          lastLogin: now,
          activeSession: { sessionId, bootSec: serverBootSec, createdAt: now },
        },
      },
      { new: true },
    );

    if (!locked) {
      return res.status(409).json({ error: 'User already logged in' });
    }

    const token = jwt.sign(
      { id: user._id, role: user.role, username: user.username, sid: sessionId },
      process.env.JWT_SECRET
    );

    // record login activity
    const LoginEvent = (await import('../models/LoginEvent.js')).default;
    LoginEvent.create({ userId: user._id }).catch(() => {});

    emitAdminEvent({
      type: 'LOGIN',
      userId: String(user._id),
      username: user.username
    });
    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: 'Login failed' });
  }
});

// best-effort logout tracking (frontend should call this on logout)
router.post('/logout', async (req, res) => {
  // Allow logout even for disabled accounts.
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.sendStatus(401);

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const id = payload?.id;
    const username = payload?.username;
    const sid = payload?.sid;
    if (!id) return res.sendStatus(401);

    const r = await User.updateOne(
      { _id: id, ...(sid ? { 'activeSession.sessionId': String(sid) } : {}) },
      { $set: { lastLogout: new Date() }, $unset: { activeSession: 1 } },
    ).catch(() => null);

    // Only emit logout if we actually cleared the current session.
    if (r && r.modifiedCount) {
      LogoutEvent.create({ userId: id }).catch(() => {});
      emitAdminEvent({
        type: 'LOGOUT',
        userId: String(id),
        username: username || undefined
      });
    }
    res.sendStatus(204);
  } catch {
    res.sendStatus(401);
  }
});

export default router;
