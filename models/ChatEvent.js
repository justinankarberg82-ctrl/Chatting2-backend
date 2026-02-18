import mongoose from 'mongoose';

const ChatEventSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  chatId: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat', required: true },
  type: { type: String, enum: ['CHAT_CREATED', 'CHAT_DELETED'], required: true },
  title: { type: String, default: '' },
  ip: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model('ChatEvent', ChatEventSchema);
