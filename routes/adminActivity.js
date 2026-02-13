import express from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import adminMiddleware from '../middleware/adminMiddleware.js';
import User from '../models/User.js';
import LoginEvent from '../models/LoginEvent.js';
import LogoutEvent from '../models/LogoutEvent.js';
import ChatEvent from '../models/ChatEvent.js';
import AuditEvent from '../models/AuditEvent.js';
import { canAccessProtectedUsers, isProtectedUsername } from '../utils/protectedUsers.js';

const router = express.Router();
router.use(authMiddleware, adminMiddleware);

// GET /api/admin/users/:id/activity
router.get('/admin/users/:id/activity', async (req, res) => {
  const { id } = req.params;
  const limit = Math.min(200, Math.max(10, Number(req.query.limit || 100)));

  const user = await User.findById(id).select('username');
  if (!user) return res.sendStatus(404);

  if (isProtectedUsername(user.username) && !canAccessProtectedUsers(req.user?.username)) {
    return res.status(403).json({ message: 'Not allowed' });
  }

  const [logins, logouts, chats, audits] = await Promise.all([
    LoginEvent.find({ userId: id }).sort({ createdAt: -1 }).limit(limit).lean(),
    LogoutEvent.find({ userId: id }).sort({ createdAt: -1 }).limit(limit).lean(),
    ChatEvent.find({ userId: id }).sort({ createdAt: -1 }).limit(limit).lean(),
    AuditEvent.find({ targetId: id })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('actorId', 'username role')
      .lean()
  ]);

  const events = [];

  for (const e of logins) {
    events.push({
      _id: String(e._id),
      type: 'LOGIN',
      createdAt: e.createdAt,
      userId: String(id),
      username: user.username
    });
  }

  for (const e of logouts) {
    events.push({
      _id: String(e._id),
      type: 'LOGOUT',
      createdAt: e.createdAt,
      userId: String(id),
      username: user.username
    });
  }

  for (const e of chats) {
    events.push({
      _id: String(e._id),
      type: e.type,
      createdAt: e.createdAt,
      userId: String(id),
      username: user.username,
      chatId: e.chatId ? String(e.chatId) : null,
      title: e.title || ''
    });
  }

  for (const e of audits) {
    events.push({
      _id: String(e._id),
      type: 'AUDIT',
      createdAt: e.createdAt,
      action: e.action,
      actorUsername: e.actorUsername || e.actorId?.username || 'System',
      actorRole: e.actorId?.role,
      targetId: e.targetId ? String(e.targetId) : null,
      targetUsername: e.targetUsername,
      metadata: e.metadata || {}
    });
  }

  events.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  res.json(events.slice(0, limit));
});

export default router;
