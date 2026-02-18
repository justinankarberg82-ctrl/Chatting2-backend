import mongoose from 'mongoose';

const AuditEventSchema = new mongoose.Schema(
  {
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    actorUsername: { type: String, required: true },
    actorIp: { type: String, default: '' },
    action: { type: String, required: true },
    targetId: { type: mongoose.Schema.Types.ObjectId },
    targetUsername: { type: String },
    metadata: { type: Object, default: {} }
  },
  { timestamps: true }
);

export default mongoose.model('AuditEvent', AuditEventSchema);
