import express from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import adminMiddleware from '../middleware/adminMiddleware.js';
import User from '../models/User.js';
import LoginEvent from '../models/LoginEvent.js';
import UsageEvent from '../models/UsageEvent.js';
import { canAccessProtectedUsers, isProtectedUsername } from '../utils/protectedUsers.js';

const router = express.Router();
router.use(authMiddleware, adminMiddleware);

// GET /api/admin/overview
router.get('/admin/overview', async (req, res) => {
  const totalUsers = await User.countDocuments();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const activeUsersToday = await LoginEvent.distinct('userId', {
    createdAt: { $gte: today }
  });

  const tokensTodayAgg = await UsageEvent.aggregate([
    { $match: { createdAt: { $gte: today } } },
    { $group: { _id: null, total: { $sum: '$tokensUsed' } } }
  ]);

  const requestsToday = await UsageEvent.countDocuments({
    createdAt: { $gte: today }
  });

  res.json({
    totalUsers,
    activeUsersToday: activeUsersToday.length,
    tokensUsedToday: tokensTodayAgg[0]?.total || 0,
    requestsToday
  });
});

function isValidTzOffsetMin(n) {
  return Number.isFinite(n) && Math.abs(n) <= 14 * 60;
}

function parseYmd(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const [yy, mm, dd] = dateStr.split('-').map((x) => Number(x));
  if (!Number.isFinite(yy) || !Number.isFinite(mm) || !Number.isFinite(dd)) return null;
  return { yy, mm, dd };
}

// Convert a client-local midnight (YYYY-MM-DD) to a UTC Date using tzOffsetMin.
function localMidnightToUtcDate({ yy, mm, dd }, tzOffsetMin) {
  const startUtcMs = Date.UTC(yy, mm - 1, dd, 0, 0, 0, 0) + tzOffsetMin * 60 * 1000;
  return new Date(startUtcMs);
}

function addDaysYmd({ yy, mm, dd }, days) {
  const t = new Date(Date.UTC(yy, mm - 1, dd, 0, 0, 0, 0));
  t.setUTCDate(t.getUTCDate() + days);
  return { yy: t.getUTCFullYear(), mm: t.getUTCMonth() + 1, dd: t.getUTCDate() };
}

function dayOfWeekUtc({ yy, mm, dd }) {
  // 0 Sun .. 6 Sat (day-of-week is date-based, safe to compute in UTC)
  return new Date(Date.UTC(yy, mm - 1, dd, 0, 0, 0, 0)).getUTCDay();
}

// GET /api/admin/usage-summary?unit=day|week|month|year&date=YYYY-MM-DD&tzOffset=<minutes>
router.get('/admin/usage-summary', async (req, res) => {
  const unit = String(req.query.unit || 'day').trim().toLowerCase();
  const dateStr = String(req.query.date || '').trim();
  const tzOffsetMin = Number(req.query.tzOffset ?? 0);

  if (!['day', 'week', 'month', 'year'].includes(unit)) {
    return res.status(400).json({ error: 'Invalid unit' });
  }
  if (!isValidTzOffsetMin(tzOffsetMin)) {
    return res.status(400).json({ error: 'Invalid tzOffset' });
  }

  const ymd = parseYmd(dateStr);
  if (!ymd) {
    return res.status(400).json({ error: 'Invalid date' });
  }

  let startYmd = ymd;
  let endYmd = addDaysYmd(ymd, 1);

  if (unit === 'week') {
    const dow = dayOfWeekUtc(ymd);
    const delta = dow === 0 ? -6 : 1 - dow; // Monday start
    startYmd = addDaysYmd(ymd, delta);
    endYmd = addDaysYmd(startYmd, 7);
  }

  if (unit === 'month') {
    startYmd = { yy: ymd.yy, mm: ymd.mm, dd: 1 };
    const nextMm = ymd.mm === 12 ? 1 : ymd.mm + 1;
    const nextYy = ymd.mm === 12 ? ymd.yy + 1 : ymd.yy;
    endYmd = { yy: nextYy, mm: nextMm, dd: 1 };
  }

  if (unit === 'year') {
    startYmd = { yy: ymd.yy, mm: 1, dd: 1 };
    endYmd = { yy: ymd.yy + 1, mm: 1, dd: 1 };
  }

  const start = localMidnightToUtcDate(startYmd, tzOffsetMin);
  const end = localMidnightToUtcDate(endYmd, tzOffsetMin);

  const agg = await UsageEvent.aggregate([
    { $match: { createdAt: { $gte: start, $lt: end } } },
    {
      $group: {
        _id: null,
        requests: { $sum: 1 },
        credits: { $sum: '$tokensUsed' },
      },
    },
  ]);

  return res.json({
    unit,
    date: dateStr,
    requests: agg?.[0]?.requests || 0,
    credits: agg?.[0]?.credits || 0,
  });
});

// GET /api/admin/top-users?unit=day|week|month|year&date=YYYY-MM-DD&tzOffset=<minutes>&limit=5
router.get('/admin/top-users', async (req, res) => {
  const unit = String(req.query.unit || 'day').trim().toLowerCase();
  const dateStr = String(req.query.date || '').trim();
  const tzOffsetMin = Number(req.query.tzOffset ?? 0);
  const limit = Math.max(1, Math.min(50, Number(req.query.limit ?? 5)));

  if (!['day', 'week', 'month', 'year'].includes(unit)) {
    return res.status(400).json({ error: 'Invalid unit' });
  }
  if (!isValidTzOffsetMin(tzOffsetMin)) {
    return res.status(400).json({ error: 'Invalid tzOffset' });
  }

  const ymd = parseYmd(dateStr);
  if (!ymd) {
    return res.status(400).json({ error: 'Invalid date' });
  }

  let startYmd = ymd;
  let endYmd = addDaysYmd(ymd, 1);

  if (unit === 'week') {
    const dow = dayOfWeekUtc(ymd);
    const delta = dow === 0 ? -6 : 1 - dow;
    startYmd = addDaysYmd(ymd, delta);
    endYmd = addDaysYmd(startYmd, 7);
  }

  if (unit === 'month') {
    startYmd = { yy: ymd.yy, mm: ymd.mm, dd: 1 };
    const nextMm = ymd.mm === 12 ? 1 : ymd.mm + 1;
    const nextYy = ymd.mm === 12 ? ymd.yy + 1 : ymd.yy;
    endYmd = { yy: nextYy, mm: nextMm, dd: 1 };
  }

  if (unit === 'year') {
    startYmd = { yy: ymd.yy, mm: 1, dd: 1 };
    endYmd = { yy: ymd.yy + 1, mm: 1, dd: 1 };
  }

  const start = localMidnightToUtcDate(startYmd, tzOffsetMin);
  const end = localMidnightToUtcDate(endYmd, tzOffsetMin);

  const rows = await UsageEvent.aggregate([
    { $match: { createdAt: { $gte: start, $lt: end } } },
    {
      $group: {
        _id: '$userId',
        requests: { $sum: 1 },
        credits: { $sum: '$tokensUsed' }
      }
    },
    { $sort: { requests: -1, credits: -1 } },
    { $limit: limit },
    {
      $lookup: {
        from: 'users',
        localField: '_id',
        foreignField: '_id',
        as: 'user'
      }
    },
    { $unwind: '$user' },
    {
      $project: {
        _id: 0,
        userId: '$_id',
        username: '$user.username',
        role: '$user.role',
        isActive: '$user.isActive',
        requests: 1,
        credits: 1
      }
    }
  ]);

  const allowProtected = canAccessProtectedUsers(req.user?.username);
  const filtered = allowProtected
    ? rows
    : (rows || []).filter((r) => !isProtectedUsername(r?.username));

  return res.json(filtered);
});

export default router;
