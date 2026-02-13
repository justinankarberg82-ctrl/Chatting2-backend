import express from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import adminMiddleware from '../middleware/adminMiddleware.js';
import UsageEvent from '../models/UsageEvent.js';
import LoginEvent from '../models/LoginEvent.js';

const router = express.Router();
router.use(authMiddleware, adminMiddleware);

// GET /api/admin/export/usage?from=YYYY-MM-DD&to=YYYY-MM-DD&format=csv|json
router.get('/admin/export/usage', async (req, res) => {
  const { from, to, format = 'json' } = req.query;
  const start = from ? new Date(from) : new Date(0);
  const end = to ? new Date(to) : new Date();

  const usage = await UsageEvent.find({ createdAt: { $gte: start, $lte: end } })
    .populate('userId', 'username')
    .lean();

  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="usage.csv"');
    res.write('date,username,tokensUsed\n');
    for (const u of usage) {
      res.write(`${u.createdAt.toISOString()},${u.userId?.username || ''},${u.tokensUsed}\n`);
    }
    return res.end();
  }

  res.json(usage);
});

// GET /api/admin/export/logins?from=YYYY-MM-DD&to=YYYY-MM-DD&format=csv|json
router.get('/admin/export/logins', async (req, res) => {
  const { from, to, format = 'json' } = req.query;
  const start = from ? new Date(from) : new Date(0);
  const end = to ? new Date(to) : new Date();

  const logins = await LoginEvent.find({ createdAt: { $gte: start, $lte: end } })
    .populate('userId', 'username')
    .lean();

  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="logins.csv"');
    res.write('date,username\n');
    for (const l of logins) {
      res.write(`${l.createdAt.toISOString()},${l.userId?.username || ''}\n`);
    }
    return res.end();
  }

  res.json(logins);
});

export default router;
