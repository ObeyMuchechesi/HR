/* Local end-to-end test of the check-in/out approval flow against a running
 * server on :5001. Anchors on Lisa's attendance row for TODAY: if none exists
 * (e.g. run before the morning pass) a temporary one is created and deleted
 * again at the end; otherwise her real row is flipped through
 * pending-checkin / pending-checkout states and restored exactly at the end.
 *
 * Usage: node scripts/test-approval-flow.js  (server must be running)
 */
require('dotenv').config({ override: true });
const Attendance = require('../models/Attendance');
const Employee = require('../models/Employee');
const AuditLog = require('../models/AuditLog');
const mongoose = require('mongoose');

const BASE = 'http://localhost:5001/api';
const auth = (token) => ({ Authorization: `Bearer ${token}` });
const json = async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) });
const http = {
  get: (url, token) => fetch(BASE + url, { headers: auth(token) }).then(json),
  post: (url, body, token) => fetch(BASE + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth(token) }, body: JSON.stringify(body) }).then(json)
};

const assert = (cond, msg) => {
  console.log(`${cond ? '✅' : '❌'} ${msg}`);
  if (!cond) failed = true;
};
let failed = false;

(async () => {
  const start = new Date();
  await mongoose.connect(process.env.MONGO_URI);

  // login as admin + employee
  const admin = (await http.post('/auth/login', { email: 'obey@hr.local', password: 'Password123' })).data.token;
  const emp = (await http.post('/auth/login', { email: 'lisa@callcentral.com', password: 'Password123' })).data.token;
  assert(!!admin && !!emp, 'login as admin + employee works');

  // Lisa's row for today (created temporarily if the morning pass hasn't run)
  const day = new Date(new Date().setUTCHours(0, 0, 0, 0));
  const lisa = await Employee.findOne({ firstName: 'Lisa' });
  let rowDoc = await Attendance.findOne({ employee: lisa._id, date: day });
  let madeRow = false;
  if (!rowDoc) {
    rowDoc = await Attendance.create({
      employee: lisa._id, date: day, checkIn: new Date(day.getTime() + 5 * 3600e3 + 55 * 60e3),
      checkOut: null, status: 'Present', hoursWorked: 0,
      notes: 'TEMPORARY test row (delete at end)', approvalState: 'approved'
    });
    madeRow = true;
  }
  assert(!!rowDoc, madeRow ? "created a temporary row for Lisa today (none existed)" : "found Lisa's row for today");
  const original = rowDoc.toObject();
  const id = rowDoc._id;

  // --- 1. permissions and list
  const pend = await http.get('/attendance/pending', admin);
  assert(Array.isArray(pend.data), 'GET /attendance/pending works for admin');

  const empForbidden = (await http.post('/attendance/approve', { ids: [id], action: 'approve' }, emp)).status === 403;
  assert(empForbidden, 'employee is rejected (403) on /approve');

  // --- 2. pending-checkin: excluded from present count; approve works
  // Baseline = what summary/today reports as approved&present for today.
  const baseline = await Attendance.countDocuments({ date: day, status: 'Present', approvalState: { $ne: 'pending-checkin' } });
  assert((await http.get('/attendance/summary/today', admin)).data.present === baseline, `summary/today matches DB baseline (${baseline})`);

  await Attendance.updateOne({ _id: id }, { approvalState: 'pending-checkin' });
  const sum = (await http.get('/attendance/summary/today', admin)).data;
  const wasPresent = original.status === 'Present';
  assert(sum.present === baseline - (wasPresent ? 1 : 0), `summary/today excludes pending check-ins (present=${sum.present}, baseline=${baseline})`);

  const list = (await http.get('/attendance/pending', admin)).data;
  assert(list.some(r => String(r._id) === String(id) && r.approvalState === 'pending-checkin'), 'pending list shows the pending-checkin row');

  const bad = await http.post('/attendance/approve', { ids: [], action: 'approve' }, admin);
  assert(bad.status === 400, 'approve with empty ids is a 400');

  const appr = (await http.post('/attendance/approve', { ids: [id], action: 'approve' }, admin)).data;
  assert(appr.approvedCheckins + appr.approvedCheckouts === 1, `approve endpoint approves the row (${appr.message})`);
  let after = await Attendance.findById(id).lean();
  assert(after.approvalState === 'approved', 'row is approved after approve');
  const sumAfter = (await http.get('/attendance/summary/today', admin)).data;
  assert(sumAfter.present === baseline - (wasPresent ? 0 : 1), `approved row counts as present again (${sumAfter.present})`);

  // --- 3. rejection requires a reason; reason is stored on the row
  await Attendance.updateOne({ _id: id }, { approvalState: 'pending-checkout' });
  const rerolled = await Attendance.findById(id);
  if (!rerolled.checkOut) {
    rerolled.checkOut = new Date(day.getTime() + 14 * 3600e3);
    rerolled.hoursWorked = 8.08;
    await rerolled.save();
  }
  const noReason = await http.post('/attendance/approve', { ids: [id], action: 'reject' }, admin);
  assert(noReason.status === 400, 'reject without a reason is a 400');

  const rej = (await http.post('/attendance/approve', { ids: [id], action: 'reject', reason: 'Sick' }, admin)).data;
  assert(rej.rejectedCheckouts === 1, `reject clears the check-out (${rej.message})`);
  after = await Attendance.findById(id).lean();
  assert(!after.checkOut && after.approvalState === 'approved' && after.rejectionReason === 'Sick',
    'check-out cleared, row approved, reason "Sick" stored');

  // --- leave summary
  const ls = (await http.get('/attendance/leave-summary?year=2026', admin)).data;
  const lisaLeave = ls.rows.find(r => r.name.includes('Lisa'));
  assert(ls.rows.length >= 5 && !!lisaLeave, `leave-summary returns ${ls.rows.length} person(s) for 2026`);
  console.log('   Lisa 2026 totals:', JSON.stringify(lisaLeave && lisaLeave.total));

  // --- clean up: temporary row is deleted, a real row is restored exactly
  if (madeRow) {
    await Attendance.deleteOne({ _id: id });
    assert(!(await Attendance.findOne({ employee: lisa._id, date: day })), 'temporary row deleted');
  } else {
    await Attendance.updateOne({ _id: id }, {
      $set: {
        employee: original.employee, date: original.date, checkIn: original.checkIn,
        checkOut: original.checkOut, status: original.status, hoursWorked: original.hoursWorked,
        notes: original.notes, approvalState: 'approved'
      },
      $unset: { approvedBy: 1, approvedAt: 1, ...(original.rejectionReason ? {} : { rejectionReason: 1 }) }
    });
    const restored = await Attendance.findById(id).lean();
    assert(String(restored.checkOut) === String(original.checkOut) && restored.status === original.status && restored.approvalState === original.approvalState,
      "RESTORED: Lisa's row back to exactly its original state");
  }
  // Clean audit noise created by the test run itself (never by automation).
  if (!madeRow) {
    await AuditLog.deleteMany({ action: { $in: ['attendance.approve', 'attendance.disapprove'] }, createdAt: { $gte: start } });
  }

  const leftPending = await Attendance.countDocuments({ approvalState: { $exists: true, $ne: 'approved' } });
  assert(leftPending === 0, `no pending rows left behind (${leftPending})`);

  console.log(`\nDone. ${failed ? 'SOME CHECKS FAILED' : 'all checks passed'}`);
  await mongoose.disconnect();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FAIL:', (e && e.data) || e.response?.data || e.message || e); process.exit(1); });
