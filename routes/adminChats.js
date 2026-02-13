import express from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import adminMiddleware from '../middleware/adminMiddleware.js';
import Chat from '../models/Chat.js';
import ConversationNode from '../models/ConversationNode.js';
import User from '../models/User.js';
import { canAccessProtectedUsers, isProtectedUsername } from '../utils/protectedUsers.js';

const router = express.Router();
router.use(authMiddleware, adminMiddleware);

// GET /api/admin/users/:id/chats
router.get('/admin/users/:id/chats', async (req, res) => {
  const userId = req.params.id;
  const user = await User.findById(userId).select('_id username');
  if (!user) return res.sendStatus(404);

  if (isProtectedUsername(user.username) && !canAccessProtectedUsers(req.user?.username)) {
    return res.status(403).json({ message: 'Not allowed' });
  }

  const chats = await Chat.find({ userId })
    .select('_id title createdAt activeNodeId messages')
    .sort({ createdAt: -1 })
    .lean();

  const result = [];
  for (const chat of chats) {
    if (chat.activeNodeId) {
      const node = await ConversationNode.findById(chat.activeNodeId).lean();
      if (node) {
        result.push({
          _id: chat._id,
          title: chat.title,
          createdAt: chat.createdAt,
          messages: node.messages
        });
        continue;
      }
    }

    // fallback to legacy messages
    result.push({
      _id: chat._id,
      title: chat.title,
      createdAt: chat.createdAt,
      messages: chat.messages
    });
  }

  res.json(result);
});

export default router;
