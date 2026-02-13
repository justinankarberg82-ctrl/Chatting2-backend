import mongoose from 'mongoose';

const CreditBalanceSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', unique: true },
  tokenLimit: { type: Number, default: 100000 }, // default 100k tokens
  tokensUsed: { type: Number, default: 0 },
  lastReset: { type: String } // YYYY-MM
}, { timestamps: true });

export default mongoose.model('CreditBalance', CreditBalanceSchema);
