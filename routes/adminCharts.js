import express from 'express';
import mongoose from 'mongoose';
import authMiddleware from '../middleware/authMiddleware.js';
import adminMiddleware from '../middleware/adminMiddleware.js';
import UsageEvent from '../models/UsageEvent.js';

const router = express.Router();
router.use(authMiddleware, adminMiddleware);

// GET /api/admin/charts/tokens-daily?days=30&userId=<id>
router.get('/admin/charts/tokens-daily', async (req, res) => {
  const days = Number(req.query.days || 30);
  const userId = req.query.userId;
  const tzOffsetMin = Number(req.query.tzOffset ?? 0);
  const endStr = String(req.query.end || '').trim();

  if (!Number.isFinite(tzOffsetMin) || Math.abs(tzOffsetMin) > 14 * 60) {
    return res.status(400).json({ error: 'Invalid tzOffset' });
  }

  const tzAbs = Math.abs(tzOffsetMin);
  const tzH = String(Math.floor(tzAbs / 60)).padStart(2, '0');
  const tzM = String(tzAbs % 60).padStart(2, '0');
  // JS getTimezoneOffset(): minutes to add to local to get UTC.
  // Mongo timezone wants local offset from UTC.
  const tzSign = tzOffsetMin > 0 ? '-' : '+';
  const tz = `${tzSign}${tzH}:${tzM}`;

  // Compute client-local midnight as a UTC Date. If end=YYYY-MM-DD is provided,
  // treat it as the client's selected local day (inclusive).
  let endMidnightUtcMs;

  if (endStr) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endStr)) {
      return res.status(400).json({ error: 'Invalid end' });
    }
    const [yy, mm, dd] = endStr.split('-').map((x) => Number(x));
    endMidnightUtcMs = Date.UTC(yy, mm - 1, dd, 0, 0, 0, 0) + tzOffsetMin * 60 * 1000;
  } else {
    const nowUtcMs = Date.now();
    const clientNow = new Date(nowUtcMs - tzOffsetMin * 60 * 1000);
    clientNow.setHours(0, 0, 0, 0);
    endMidnightUtcMs = clientNow.getTime() + tzOffsetMin * 60 * 1000;
  }

  const daysCount = Math.max(1, days);
  const start = new Date(endMidnightUtcMs - (daysCount - 1) * 24 * 60 * 60 * 1000);
  const endExclusive = new Date(endMidnightUtcMs + 24 * 60 * 60 * 1000);

  const match = { createdAt: { $gte: start, $lt: endExclusive } };
  if (userId) {
    if (!mongoose.isValidObjectId(userId)) {
      return res.status(400).json({ error: 'Invalid userId' });
    }
    match.userId = new mongoose.Types.ObjectId(userId);
  }

  const data = await UsageEvent.aggregate([
    { $match: match },
    { $addFields: { _parts: { $dateToParts: { date: '$createdAt', timezone: tz } } } },
    {
      $group: {
        _id: {
          y: '$_parts.year',
          m: '$_parts.month',
          d: '$_parts.day'
        },
        tokens: { $sum: '$tokensUsed' },
        requests: { $sum: 1 }
      }
    },
    { $sort: { '_id.y': 1, '_id.m': 1, '_id.d': 1 } }
  ]);

  const formatted = data.map(r => ({
    date: `${r._id.y}-${String(r._id.m).padStart(2, '0')}-${String(r._id.d).padStart(2, '0')}`,
    tokens: r.tokens,
    requests: r.requests
  }));

  res.json(formatted);
});

// GET /api/admin/charts/tokens-hourly?date=YYYY-MM-DD&userId=<id>
router.get('/admin/charts/tokens-hourly', async (req, res) => {
  const dateStr = String(req.query.date || '').trim();
  const userId = req.query.userId;
  const tzOffsetMin = Number(req.query.tzOffset ?? 0);
  const bucketMin = Number(req.query.bucketMin ?? 10);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return res.status(400).json({ error: 'Invalid date' });
  }

  if (!Number.isFinite(tzOffsetMin) || Math.abs(tzOffsetMin) > 14 * 60) {
    return res.status(400).json({ error: 'Invalid tzOffset' });
  }

  if (!Number.isFinite(bucketMin) || bucketMin <= 0 || 1440 % bucketMin !== 0) {
    return res.status(400).json({ error: 'Invalid bucketMin' });
  }

  const tzAbs = Math.abs(tzOffsetMin);
  const tzH = String(Math.floor(tzAbs / 60)).padStart(2, '0');
  const tzM = String(tzAbs % 60).padStart(2, '0');
  // JS getTimezoneOffset(): minutes to add to local to get UTC.
  // Mongo timezone wants local offset from UTC.
  const tzSign = tzOffsetMin > 0 ? '-' : '+';
  const tz = `${tzSign}${tzH}:${tzM}`;

  const [yy, mm, dd] = dateStr.split('-').map((x) => Number(x));
  // Convert user's local midnight to UTC using their tzOffset.
  const startUtcMs = Date.UTC(yy, mm - 1, dd, 0, 0, 0, 0) + tzOffsetMin * 60 * 1000;
  const start = new Date(startUtcMs);
  const end = new Date(startUtcMs + 24 * 60 * 60 * 1000);

  const match = { createdAt: { $gte: start, $lt: end } };
  if (userId) {
    if (!mongoose.isValidObjectId(userId)) {
      return res.status(400).json({ error: 'Invalid userId' });
    }
    match.userId = new mongoose.Types.ObjectId(userId);
  }

  try {
    const data = await UsageEvent.aggregate([
      { $match: match },
      {
        $addFields: {
          _parts: { $dateToParts: { date: '$createdAt', timezone: tz } }
        }
      },
      {
        $group: {
          _id: {
            bucket: {
              $multiply: [
                {
                  $floor: {
                    $divide: [{ $add: [{ $multiply: ['$_parts.hour', 60] }, '$_parts.minute'] }, bucketMin]
                  }
                },
                bucketMin
              ]
            }
          },
          tokens: { $sum: '$tokensUsed' },
          requests: { $sum: 1 }
        }
      },
      { $sort: { '_id.bucket': 1 } }
    ]);

    return res.json(
      data.map((r) => ({
        minute: r._id.bucket,
        tokens: r.tokens,
        requests: r.requests
      }))
    );
  } catch (err) {
    console.error('GET /api/admin/charts/tokens-hourly failed:', err?.message || err);
    return res.status(500).json({ error: 'Failed to build hourly chart' });
  }
});

export default router;
