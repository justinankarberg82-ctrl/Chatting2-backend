import express from 'express';
import User from '../models/User.js';
import AuditEvent from '../models/AuditEvent.js';
import authMiddleware from '../middleware/authMiddleware.js';
import adminMiddleware from '../middleware/adminMiddleware.js';
import { emitAdminEvent, forceLogoutUser } from '../realtime.js';
import { canAccessProtectedUsers, isProtectedUsername, filterUsersForAdmin } from '../utils/protectedUsers.js';
import { getClientIpFromReq } from '../utils/clientIp.js';

const router = express.Router();

// All admin routes require auth + admin role
router.use(authMiddleware, adminMiddleware);

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// GET /api/admin/users - list all users
router.get('/admin/users', async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.json(filterUsersForAdmin(users, req.user?.username));
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch users' });
  }
});

// POST /api/admin/users - create allowed account
router.post('/admin/users', async (req, res) => {
  const { username, role, isActive } = req.body;

  const uname = String(username || '').trim();
  if (!uname) {
    return res.status(400).json({ message: 'Username is required' });
  }

  try {
    if (isProtectedUsername(uname) && !canAccessProtectedUsers(req.user?.username)) {
      return res.status(403).json({ message: 'Not allowed' });
    }

    const existing = await User.findOne({
      username: new RegExp(`^${escapeRegex(uname)}$`, 'i')
    });
    if (existing) {
      return res.status(409).json({ message: 'User already exists' });
    }

    const user = await User.create({
      username: uname,
      role: role === 'admin' ? 'admin' : 'user',
      isActive: typeof isActive === 'boolean' ? isActive : true
    });

    AuditEvent.create({
      actorId: req.user?.id || req.user?._id,
      actorUsername: req.user?.username || 'unknown',
      actorIp: getClientIpFromReq(req),
      action: 'CREATE_USER',
      targetId: user._id,
      targetUsername: user.username,
      metadata: { role: user.role, isActive: user.isActive }
    }).catch(() => {});

    emitAdminEvent({
      type: 'USER_CREATED',
      userId: String(user._id),
      username: user.username,
      role: user.role,
      isActive: user.isActive,
      ip: getClientIpFromReq(req)
    });

    res.status(201).json(user);
  } catch (err) {
    console.error('POST /api/admin/users failed:', err?.message || err);
    res.status(500).json({ message: 'Failed to create user' });
  }
});

// PATCH /api/admin/users/:id - enable / disable user
router.patch('/admin/users/:id', async (req, res) => {
  const { isActive, role, username } = req.body;

  try {
    const actorUsername = req.user?.username;

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const prevIsActive = !!user.isActive;
    const prevRole = user.role;
    const prevUsername = user.username;

    // Protect main admin account from common admins
    if (isProtectedUsername(user.username) && !canAccessProtectedUsers(actorUsername)) {
      return res.status(403).json({ message: 'Not allowed' });
    }

    if (typeof isActive === 'boolean') {
      user.isActive = isActive;
    }

    if (role && ['admin', 'user'].includes(role)) {
      user.role = role;
    }

    if (typeof username === 'string') {
      const nextName = username.trim();
      if (!nextName) return res.status(400).json({ message: 'Username is required' });
      if (isProtectedUsername(nextName) && !canAccessProtectedUsers(actorUsername)) {
        return res.status(403).json({ message: 'Not allowed' });
      }

      const existing = await User.findOne({
        username: new RegExp(`^${escapeRegex(nextName)}$`, 'i')
      }).select('_id');

      if (existing && String(existing._id) !== String(user._id)) {
        return res.status(409).json({ message: 'User already exists' });
      }

      user.username = nextName;
    }

    await user.save();

    const changes = {};
    if (prevIsActive !== user.isActive) changes.isActive = { from: prevIsActive, to: user.isActive };
    if (prevRole !== user.role) changes.role = { from: prevRole, to: user.role };
    if (prevUsername !== user.username) changes.username = { from: prevUsername, to: user.username };
    if (Object.keys(changes).length) {
      AuditEvent.create({
        actorId: req.user?.id || req.user?._id,
        actorUsername: req.user?.username || 'unknown',
        actorIp: getClientIpFromReq(req),
        action: 'UPDATE_USER',
        targetId: user._id,
        targetUsername: user.username,
        metadata: { changes }
      }).catch(() => {});
    }

    // If we just disabled an account, force any active sessions to logout.
    if (prevIsActive && user.isActive === false) {
      forceLogoutUser(user._id, 'disabled');
    }

    emitAdminEvent({
      type: 'USER_UPDATED',
      userId: String(user._id),
      username: user.username,
      role: user.role,
      isActive: user.isActive,
      ip: getClientIpFromReq(req)
    });
    res.json({ message: 'User updated' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to update user' });
  }
});

  // DELETE /api/admin/users/:id - permanently delete user (with audit log)
  router.delete('/admin/users/:id', async (req, res) => {
    try {
    const actorId = req.user?.id || req.user?._id;
    if (!actorId) return res.sendStatus(401);
    const actorUsername = req.user?.username;

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Protect main admin account from common admins
    if (isProtectedUsername(user.username) && !canAccessProtectedUsers(actorUsername)) {
      return res.status(403).json({ message: 'Not allowed' });
    }

    // Prevent admin deleting themselves
    if (req.user && String(actorId) === String(user._id)) {
      return res.status(400).json({ message: 'You cannot delete your own account' });
    }

    await AuditEvent.create({
      actorId,
      actorUsername: actorUsername || 'unknown',
      actorIp: getClientIpFromReq(req),
      action: 'DELETE_USER',
      targetId: user._id,
      targetUsername: user.username
    });

      // If the user is currently logged in, force logout + disconnect sockets before deletion.
      forceLogoutUser(user._id, 'deleted');

      await user.deleteOne();

    emitAdminEvent({
      type: 'USER_DELETED',
      userId: String(user._id),
      username: user.username,
      ip: getClientIpFromReq(req)
    });
      res.sendStatus(204);
    } catch (err) {
    console.error('DELETE /api/admin/users/:id failed:', err?.message || err);
    res.status(500).json({ message: 'Failed to delete user' });
  }
});

export default router;
