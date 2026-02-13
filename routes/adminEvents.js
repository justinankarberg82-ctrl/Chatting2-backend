import express from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import adminMiddleware from '../middleware/adminMiddleware.js';
import AuditEvent from '../models/AuditEvent.js';
import LoginEvent from '../models/LoginEvent.js';
import LogoutEvent from '../models/LogoutEvent.js';
import ChatEvent from '../models/ChatEvent.js';
import UsageEvent from '../models/UsageEvent.js';
import User from '../models/User.js';
import { canAccessProtectedUsers, isProtectedUsername } from '../utils/protectedUsers.js';

const router = express.Router();
router.use(authMiddleware, adminMiddleware);

// GET /api/admin/events?limit=200
router.get('/admin/events', async (req, res) => {
  const limit = Math.min(500, Math.max(20, Number(req.query.limit || 200)));

  const [logins, logouts, chats, usages, audits] = await Promise.all([
    LoginEvent.find().sort({ createdAt: -1 }).limit(limit).lean(),
    LogoutEvent.find().sort({ createdAt: -1 }).limit(limit).lean(),
    ChatEvent.find().sort({ createdAt: -1 }).limit(limit).lean(),
    UsageEvent.find().sort({ createdAt: -1 }).limit(limit).lean(),
    AuditEvent.find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('actorId', 'username role')
      .lean()
  ]);

  const ids = new Set();
  for (const e of logins) ids.add(String(e.userId));
  for (const e of logouts) ids.add(String(e.userId));
  for (const e of chats) ids.add(String(e.userId));
  for (const e of usages) ids.add(String(e.userId));
  for (const e of audits) {
    if (e.targetId) ids.add(String(e.targetId));
  }


  const users = await User.find({ _id: { $in: Array.from(ids) } })
    .select('username')
    .lean();
  const byId = new Map(users.map((u) => [String(u._id), u.username]));

  const events = [];

  for (const e of logins) {
    const username = byId.get(String(e.userId));
    events.push({
      _id: String(e._id),
      type: 'LOGIN',
      createdAt: e.createdAt,
      userId: String(e.userId),
      username
    });
  }

  for (const e of logouts) {
    const username = byId.get(String(e.userId));
    events.push({
      _id: String(e._id),
      type: 'LOGOUT',
      createdAt: e.createdAt,
      userId: String(e.userId),
      username
    });
  }

  for (const e of chats) {
    const username = byId.get(String(e.userId));
    events.push({
      _id: String(e._id),
      type: e.type,
      createdAt: e.createdAt,
      userId: String(e.userId),
      username,
      chatId: e.chatId ? String(e.chatId) : null,
      title: e.title || ''
    });
  }

  for (const e of usages) {
    const username = byId.get(String(e.userId));
    events.push({
      _id: String(e._id),
      type: 'USAGE',
      stage: 'complete',
      createdAt: e.createdAt,
      userId: String(e.userId),
      username,
      tokensUsed: e.tokensUsed
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
      targetUsername: e.targetUsername || (e.targetId ? byId.get(String(e.targetId)) : undefined),
      metadata: e.metadata || {}
    });
  }

  events.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const allowProtected = canAccessProtectedUsers(req.user?.username);
  const filtered = allowProtected
    ? events
    : events.filter((e) => {
        const uname = e?.username || e?.targetUsername;
        return !isProtectedUsername(uname);
      });

  return res.json(filtered.slice(0, limit));
});

export default router;
