import express from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import adminMiddleware from '../middleware/adminMiddleware.js';
import User from '../models/User.js';
import LoginEvent from '../models/LoginEvent.js';
import UsageEvent from '../models/UsageEvent.js';
import { canAccessProtectedUsers, isProtectedUsername } from '../utils/protectedUsers.js';

const router = express.Router();
router.use(authMiddleware, adminMiddleware);

// GET /api/admin/users/:id/analytics
router.get('/admin/users/:id/analytics', async (req, res) => {
  const userId = req.params.id;

  const user = await User.findById(userId).select('username role isActive createdAt');
  if (!user) return res.sendStatus(404);

  if (isProtectedUsername(user.username) && !canAccessProtectedUsers(req.user?.username)) {
    return res.status(403).json({ message: 'Not allowed' });
  }

  const totalLogins = await LoginEvent.countDocuments({ userId });
  const lastLogin = await LoginEvent.findOne({ userId }).sort({ createdAt: -1 });

  const usageAgg = await UsageEvent.aggregate([
    { $match: { userId: user._id } },
    { $group: { _id: null, totalTokens: { $sum: '$tokensUsed' }, requests: { $sum: 1 } } }
  ]);

  res.json({
    user,
    totalLogins,
    lastLogin: lastLogin?.createdAt || null,
    totalTokens: usageAgg[0]?.totalTokens || 0,
    totalRequests: usageAgg[0]?.requests || 0
  });
});

// PATCH /api/admin/users/:id/credits
router.patch('/admin/users/:id/credits', async (req, res) => {
  const { tokenLimit } = req.body;
  const CreditBalance = (await import('../models/CreditBalance.js')).default;
  await CreditBalance.updateOne(
    { userId: req.params.id },
    { $set: { tokenLimit } },
    { upsert: true }
  );
  res.sendStatus(204);
});

export default router;
