import mongoose from 'mongoose';

const LogoutEventSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model('LogoutEvent', LogoutEventSchema);
