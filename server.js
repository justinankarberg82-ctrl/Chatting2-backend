import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import http from 'http';

import authRoutes from './routes/auth.js';
import chatRoutes from './routes/chat.js';
import adminRoutes from './routes/admin.js';
import adminAnalyticsRoutes from './routes/adminAnalytics.js';
import adminAuditRoutes from './routes/adminAudit.js';
import adminActivityRoutes from './routes/adminActivity.js';
import adminEventsRoutes from './routes/adminEvents.js';
import adminChartsRoutes from './routes/adminCharts.js';
import adminUsersRoutes from './routes/adminUsers.js';
import adminChatsRoutes from './routes/adminChats.js';
import adminExportRoutes from './routes/adminExport.js';
import { initRealtime } from './realtime.js';
import { ADMIN_USERNAME } from './config/admin.js';
import User from './models/User.js';

dotenv.config();
const PORT = process.env.PORT || 5000;

const app = express();
// Trust reverse proxy so req.ip and rate limiting behave correctly.
app.set('trust proxy', true);
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
initRealtime(server);

app.use('/api', authRoutes);
app.use('/api', chatRoutes);
app.use('/api', adminRoutes);
app.use('/api', adminAnalyticsRoutes);
app.use('/api', adminAuditRoutes);
app.use('/api', adminActivityRoutes);
app.use('/api', adminEventsRoutes);
app.use('/api', adminChartsRoutes);
app.use('/api', adminUsersRoutes);
app.use('/api', adminChatsRoutes);
app.use('/api', adminExportRoutes);

mongoose
  .connect(process.env.MONGO_URI)
  .then(async () => {
    // Ensure a fixed admin account exists.
    try {
      const name = String(ADMIN_USERNAME || '').trim();
      if (name) {
        const existing = await User.findOne({ username: new RegExp(`^${name}$`, 'i') });
        if (!existing) {
          await User.create({ username: name, role: 'admin', isActive: true });
          console.log(`Admin user created: ${name}`);
        } else if (existing.role !== 'admin' || !existing.isActive) {
          await User.updateOne({ _id: existing._id }, { $set: { role: 'admin', isActive: true } });
          console.log(`Admin user ensured: ${existing.username}`);
        }
      }
    } catch (e) {
      console.error('Admin user ensure failed:', e?.message || e);
    }

    server.listen(PORT, () => {
      console.log(`Server running on ${PORT}`);
    });
  })
  .catch(err => {
    console.error('Mongo connection failed:', err.message);
    process.exit(1);
  });
