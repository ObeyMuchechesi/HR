const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  actorName: { type: String, default: 'system' },
  action: { type: String, required: true },   // e.g. 'attendance.manual', 'attendance.edit', 'attendance.bulk-checkin'
  target: { type: String, default: '' },      // employee name the action was about
  details: { type: String, default: '' },     // human-readable summary
  createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

auditLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
