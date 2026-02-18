import mongoose from 'mongoose';

const LoginEventSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  ip: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model('LoginEvent', LoginEventSchema);
