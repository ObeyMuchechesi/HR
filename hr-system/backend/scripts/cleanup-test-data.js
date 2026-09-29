/**
 * One-off cleanup: removes data created during feature testing.
 * Run: node scripts/cleanup-test-data.js   (from hr-system/backend)
 *
 * Removes:
 *  - the 4 Ashley test leaves (notification/SSE/badge tests) and restores
 *    the 2 annual days deducted by the approved test leave
 *  - attendance records dated 2026-09-29 (bulk check-in/out tests)
 *  - all in-app notifications and audit-log entries from testing
 * Keeps: everything seeded from seed.js, Lisa's real sick leave and
 * Liliosa's real maternity leave.
 */
require('dotenv').config({ override: true });
const mongoose = require('mongoose');
const Attendance = require('../models/Attendance');
const Leave = require('../models/Leave');
const Employee = require('../models/Employee');
const Notification = require('../models/Notification');
const AuditLog = require('../models/AuditLog');

const TEST_REASONS = [
  'Family event (notification test)',
  'Doctor appointment (notify test)',
  'SSE latency test',
  'UI badge push test'
];

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('connected');

  const ashley = await Employee.findOne({ email: 'ashley@callcentral.com' }).select('_id leaveBalance');
  if (!ashley) throw new Error('Ashley not found');

  const testLeaves = await Leave.find({ reason: { $in: TEST_REASONS } });
  console.log(`test leaves to delete: ${testLeaves.length}`);
  let restored = 0;
  for (const l of testLeaves) {
    if (l.status === 'Approved' && l.leaveType.toLowerCase() === 'annual') {
      ashley.leaveBalance.annual += l.days;
      restored += l.days;
    }
  }
  const r1 = await Leave.deleteMany({ _id: { $in: testLeaves.map(l => l._id) } });
  console.log(`deleted leaves: ${r1.deletedCount}, annual days restored: ${restored}`);
  await ashley.save();

  const day = new Date('2026-09-29T00:00:00.000Z');
  const r2 = await Attendance.deleteMany({ date: day });
  console.log(`deleted 2026-09-29 attendance records: ${r2.deletedCount}`);

  const r3 = await Notification.deleteMany({});
  const r4 = await AuditLog.deleteMany({});
  console.log(`deleted notifications: ${r3.deletedCount}, audit logs: ${r4.deletedCount}`);

  const leavesLeft = await Leave.countDocuments({});
  const attLeft = await Attendance.countDocuments({});
  console.log(`remaining: ${leavesLeft} leaves, ${attLeft} attendance records`);
  await mongoose.disconnect();
  console.log('done');
})().catch(e => { console.error(e); process.exit(1); });
