import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  role: { type: String, enum: ['admin', 'user'], default: 'user' },
  isActive: { type: Boolean, default: true },
  lastLogin: { type: Date, default: null },
  lastLogout: { type: Date, default: null },
  // Single-session lock: used to prevent concurrent logins for the same user.
  // Cleared on explicit logout, socket disconnect best-effort, or server restart.
  activeSession: {
    sessionId: { type: String, default: null },
    bootSec: { type: Number, default: null },
    createdAt: { type: Date, default: null },
  },
}, { timestamps: true });

export default mongoose.model('User', UserSchema);
