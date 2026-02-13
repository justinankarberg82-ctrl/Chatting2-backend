import mongoose from 'mongoose';

const MessageSchema = new mongoose.Schema({
  role: { type: String, enum: ['user', 'assistant'], required: true },
  content: { type: String, default: '' }
}, { _id: false });

const ConversationNodeSchema = new mongoose.Schema({
  chatId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  parentNodeId: { type: mongoose.Schema.Types.ObjectId, default: null },
  forkMessageIndex: { type: Number, default: null },
  messages: { type: [MessageSchema], default: [] }
}, { timestamps: true });

export default mongoose.model('ConversationNode', ConversationNodeSchema);
