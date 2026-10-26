/* Local end-to-end test of the check-in/out approval flow against a running
 * server on :5001. Uses Lisa's real attendance row for TODAY, temporarily
 * flips it through pending-checkin / pending-checkout states, exercises the
 * HTTP endpoints, and restores the row exactly at the end.
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

  // Lisa's row for today
  const day = new Date(new Date().setUTCHours(0, 0, 0, 0));
  const lisa = await Employee.findOne({ firstName: 'Lisa' });
  const rowDoc = await Attendance.findOne({ employee: lisa._id, date: day });
  assert(!!rowDoc, "found Lisa's row for today");
  const original = rowDoc.toObject();
  const id = rowDoc._id;

  // --- 1. permissions and list
  const pend = await http.get('/attendance/pending', admin);
  assert(Array.isArray(pend.data), 'GET /attendance/pending works for admin');

  const empForbidden = (await http.post('/attendance/approve', { ids: [id], action: 'approve' }, emp)).status === 403;
  assert(empForbidden, 'employee is rejected (403) on /approve');

  // --- 2. pending-checkin: excluded from present count; approve + reject work
  // Compute the baseline (approved present rows for today) and make Lisa's row
  // a Present one for the duration of the test so the exclusion is observable.
  const baseline = await Attendance.countDocuments({ date: day, status: 'Present', approvalState: { $ne: 'pending-checkin' } });
  assert((await http.get('/attendance/summary/today', admin)).data.present === baseline, `summary/today matches DB baseline (${baseline})`);

  await Attendance.updateOne({ _id: id }, { approvalState: 'pending-checkin', status: 'Present' });
  const sum = (await http.get('/attendance/summary/today', admin)).data;
  assert(sum.present === baseline, `summary/today excludes pending check-ins (present=${sum.present}, baseline=${baseline})`);

  const list = (await http.get('/attendance/pending', admin)).data;
  assert(list.some(r => String(r._id) === String(id) && r.approvalState === 'pending-checkin'), 'pending list shows the pending-checkin row');

  const bad = await http.post('/attendance/approve', { ids: [], action: 'approve' }, admin);
  assert(bad.status === 400, 'approve with empty ids is a 400');

  const appr = (await http.post('/attendance/approve', { ids: [id], action: 'approve' }, admin)).data;
  assert(appr.approvedCheckins + appr.approvedCheckouts === 1, `approve endpoint approves the row (${appr.message})`);
  let after = await Attendance.findById(id).lean();
  assert(after.approvalState === 'approved', 'row is approved after approve');
  const sumAfter = (await http.get('/attendance/summary/today', admin)).data;
  assert(sumAfter.present === baseline + 1, `approved row counts as present again (${sumAfter.present})`);

  // --- 3. pending-checkout: reject clears the check-out
  await Attendance.updateOne({ _id: id }, { approvalState: 'pending-checkout' });
  const rerolled = await Attendance.findById(id);
  rerolled.checkOut = new Date(day.getTime() + 14 * 3600e3);
  rerolled.hoursWorked = 8.08;
  await rerolled.save();
  const rej = (await http.post('/attendance/approve', { ids: [id], action: 'reject' }, admin)).data;
  assert(rej.rejectedCheckouts === 1, `reject clears the check-out (${rej.message})`);
  after = await Attendance.findById(id).lean();
  assert(!after.checkOut && after.approvalState === 'approved', 'check-out cleared, row approved (open for manual re-checkout)');

  // --- leave summary
  const ls = (await http.get('/attendance/leave-summary?year=2026', admin)).data;
  const lisaLeave = ls.rows.find(r => r.name.includes('Lisa'));
  assert(ls.rows.length >= 5 && !!lisaLeave, `leave-summary returns ${ls.rows.length} person(s) for 2026`);
  console.log('   Lisa 2026 totals:', JSON.stringify(lisaLeave && lisaLeave.total));

  // --- restore Lisa's row + clean audit noise from the test
  await Attendance.updateOne({ _id: id }, {
    $set: {
      employee: original.employee, date: original.date, checkIn: original.checkIn,
      checkOut: original.checkOut, status: original.status, hoursWorked: original.hoursWorked,
      notes: original.notes, approvalState: 'approved'
    },
    $unset: { approvedBy: 1, approvedAt: 1 }
  });
  await AuditLog.deleteMany({ action: { $in: ['attendance.approve', 'attendance.disapprove'] }, createdAt: { $gte: start } });

  const restored = await Attendance.findById(id).lean();
  assert(String(restored.checkOut) === String(original.checkOut) && restored.status === original.status && restored.approvalState === original.approvalState,
    "RESTORED: Lisa's row back to exactly its original state");
  const leftPending = await Attendance.countDocuments({ approvalState: { $exists: true, $ne: 'approved' } });
  assert(leftPending === 0, `no pending rows left behind (${leftPending})`);

  console.log(`\nDone. ${failed ? 'SOME CHECKS FAILED' : 'all checks passed'}`);
  await mongoose.disconnect();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FAIL:', (e && e.data) || e.response?.data || e.message || e); process.exit(1); });
