import express from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import adminMiddleware from '../middleware/adminMiddleware.js';
import AuditEvent from '../models/AuditEvent.js';
import User from '../models/User.js';
import { canAccessProtectedUsers, isProtectedUsername } from '../utils/protectedUsers.js';

const router = express.Router();

router.use(authMiddleware, adminMiddleware);

// GET /api/admin/users/:id/audit
router.get('/admin/users/:id/audit', async (req, res) => {
  const { id } = req.params;

  const user = await User.findById(id).select('username');
  if (!user) return res.sendStatus(404);

  if (isProtectedUsername(user.username) && !canAccessProtectedUsers(req.user?.username)) {
    return res.status(403).json({ message: 'Not allowed' });
  }

  const events = await AuditEvent.find({ targetId: id })
    .sort({ createdAt: -1 })
    .limit(50)
    .populate('actorId', 'username role');

  res.json(events);
});

export default router;
