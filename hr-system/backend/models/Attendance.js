const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  date: { type: Date, required: true },
  checkIn: { type: Date },
  checkOut: { type: Date },
  status: {
    type: String,
    enum: ['Present', 'Absent', 'Late', 'Half-day', 'Remote', 'Holiday'],
    default: 'Present'
  },
  hoursWorked: { type: Number, default: 0 },
  notes: { type: String },
  // Approval workflow: rows created by the automation (morning auto check-in,
  // bulk check-in, evening auto check-out) wait for an admin to approve them,
  // while everything else (self check-ins, manual entries, history) is
  // 'approved' from the start.
  approvalState: {
    type: String,
    enum: ['pending-checkin', 'pending-checkout', 'approved'],
    default: 'approved'
  },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  approvedAt: { type: Date },
  // Admin's reason for disapproving a proposed check-in/check-out:
  // 'Absent' (they didn't attend), 'Sick' (called in sick) or free text.
  rejectionReason: { type: String }
}, { timestamps: true });

attendanceSchema.index({ employee: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('Attendance', attendanceSchema);
