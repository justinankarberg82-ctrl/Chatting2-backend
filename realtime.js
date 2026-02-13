import jwt from 'jsonwebtoken';
import { Server as SocketIOServer } from 'socket.io';
import { serverBootSec } from './serverBoot.js';

let io;

export function initRealtime(httpServer) {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST', 'PATCH', 'DELETE']
    }
  });

  const onlineCounts = new Map(); // userId -> number
  const offlineTimers = new Map(); // userId -> timeout

  io.use((socket, next) => {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization?.split(' ')[1];

    if (!token) return next(new Error('unauthorized'));
    if (!process.env.JWT_SECRET) return next(new Error('server_misconfigured'));

    try {
      socket.user = jwt.verify(token, process.env.JWT_SECRET);

      // Force re-login after server restart.
      if (typeof socket.user?.iat === 'number' && socket.user.iat < serverBootSec) {
        return next(new Error('unauthorized'));
      }
      return next();
    } catch {
      return next(new Error('unauthorized'));
    }
  });

  io.on('connection', socket => {
    if (socket.user?.role === 'admin') {
      socket.join('admins');
      // Send current presence snapshot so newly connected admins see online users immediately.
      socket.emit('admin:presence_snapshot', Array.from(onlineCounts.keys()));
    }
    if (socket.user?.id) socket.join(`user:${socket.user.id}`);

    const userId = socket.user?.id ? String(socket.user.id) : null;
    if (userId) {
      const t = offlineTimers.get(userId);
      if (t) {
        clearTimeout(t);
        offlineTimers.delete(userId);
      }

      const next = (onlineCounts.get(userId) || 0) + 1;
      onlineCounts.set(userId, next);
      if (next === 1) {
        emitAdminEvent({ type: 'PRESENCE', userId, online: true });
      }

      socket.on('disconnect', () => {
        const now = (onlineCounts.get(userId) || 0) - 1;
        if (now <= 0) onlineCounts.delete(userId);
        else onlineCounts.set(userId, now);

        if (now <= 0) {
          const timer = setTimeout(() => {
            offlineTimers.delete(userId);
            // still offline?
            if (!onlineCounts.get(userId)) {
              emitAdminEvent({ type: 'PRESENCE', userId, online: false });

              // Best-effort: treat disconnect as logout (tab close / browser close).
              // Avoid double-logging when /api/logout already ran.
              Promise.all([
                import('./models/User.js'),
                import('./models/LogoutEvent.js')
              ])
                .then(async ([UserMod, LogoutMod]) => {
                  const User = UserMod.default;
                  const LogoutEvent = LogoutMod.default;

                  const u = await User.findById(userId).select('lastLogout');
                  const last = u?.lastLogout ? new Date(u.lastLogout).getTime() : 0;
                  const nowMs = Date.now();
                  if (nowMs - last < 4000) return;

                   await User.updateOne(
                     {
                       _id: userId,
                       ...(socket.user?.sid ? { 'activeSession.sessionId': String(socket.user.sid) } : {}),
                     },
                     { $set: { lastLogout: new Date() }, $unset: { activeSession: 1 } },
                   ).catch(() => {});
                   await LogoutEvent.create({ userId }).catch(() => {});
                   emitAdminEvent({ type: 'LOGOUT', userId });
                })
                .catch(() => {});
            }
          }, 800);
          offlineTimers.set(userId, timer);
        }
      });
    }
  });

  return io;
}

export function emitAdminEvent(event) {
  if (!io) return;
  io.to('admins').emit('admin:event', {
    ...event,
    at: event?.at || new Date().toISOString()
  });
}

export function emitUserEvent(userId, event) {
  if (!io || !userId) return;
  io.to(`user:${String(userId)}`).emit('user:event', {
    ...event,
    at: event?.at || new Date().toISOString()
  });
}

export function disconnectUserSockets(userId) {
  if (!io || !userId) return;
  io.in(`user:${String(userId)}`).disconnectSockets(true);

  // Best-effort: clear single-session lock when an admin kicks a user.
  import('./models/User.js')
    .then((UserMod) => {
      const User = UserMod.default;
      return User.updateOne(
        { _id: String(userId) },
        { $set: { lastLogout: new Date() }, $unset: { activeSession: 1 } },
      ).catch(() => {});
    })
    .catch(() => {});
}
