import mongoose from 'mongoose';

const UsageEventSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  tokensUsed: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model('UsageEvent', UsageEventSchema);
