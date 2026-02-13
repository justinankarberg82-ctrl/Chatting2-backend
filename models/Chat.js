import mongoose from 'mongoose';

const VersionSchema = new mongoose.Schema({
  version: Number,
  content: String,
  assistant: String,
  createdAt: { type: Date, default: Date.now }
}, { _id: false });

const MessageSchema = new mongoose.Schema({
  role: { type: String, enum: ['user'], required: true },
  activeVersion: { type: Number, default: 1 },
  versions: [VersionSchema]
}, { timestamps: true });

const ChatSchema = new mongoose.Schema({
  userId: mongoose.Schema.Types.ObjectId,
  title: String,
  messages: [MessageSchema],
  activeNodeId: { type: mongoose.Schema.Types.ObjectId, default: null }
}, { timestamps: true });

export default mongoose.model('Chat', ChatSchema);
