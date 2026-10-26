/* One-off fixup for the backfill:
 * A. Dedupe: seeded rows are stored at 22:00Z of the previous day (local
 *    midnight in CAT), while backfilled/cron rows use 00:00Z. Both describe
 *    the SAME actual day when viewed in CAT (UTC+2). Group per employee per
 *    CAT-day and keep one row.
 * B. No attendance on approved-leave days: delete rows (both conventions)
 *    for every approved leave day, backfilled or not.
 * C. Today (2026-10-26): Ashley & Fadzai = Absent (an earlier pass wrongly
 *    flipped them to Present), everyone else keeps their record, Liliosa
 *    (maternity leave) keeps none.
 * D. Fill: every remaining missing weekday (May 1 → today, CAT view) gets a
 *    Present row 07:55–16:00, skipping weekends, approved leave and
 *    public holidays.
 *
 * Usage: node scripts/fixup-attendance.js
 */
require('dotenv').config();
const path = require('path');
const mongoose = require('mongoose');
const Employee = require(path.join(__dirname, '..', 'models', 'Employee'));
const User = require(path.join(__dirname, '..', 'models', 'User'));
const Leave = require(path.join(__dirname, '..', 'models', 'Leave'));
const Attendance = require(path.join(__dirname, '..', 'models', 'Attendance'));
const { holidayInfo } = require(path.join(__dirname, '..', 'utils', 'holidays'));

const CAT_MS = 2 * 3600 * 1000;
const catDay = (d) => new Date(Math.floor((new Date(d).getTime() + CAT_MS) / 86400000) * 86400000);
const catStr = (d) => new Date(new Date(d).getTime() + CAT_MS).toISOString().slice(0, 10);
const dayUtc = (s) => new Date(`${s}T00:00:00.000Z`);

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const employees = (await Employee.find({ status: { $ne: 'Terminated' } }).sort({ employeeId: 1 }).lean());
  const approver = (await User.findOne({ role: 'admin' }).lean()) || null;

  // Approved leave set per employee, as CAT-day strings
  const leaveDays = {}; // empId -> Set of CAT day strings
  for (const e of employees) {
    const set = new Set();
    const ls = await Leave.find({ employee: e._id, status: 'Approved' }).lean();
    for (const l of ls) {
      for (let d = new Date(l.startDate); d <= l.endDate; d = new Date(d.getTime() + 86400000)) {
        set.add(catStr(d));
      }
    }
    leaveDays[e._id.toString()] = set;
  }
  const onLeave = (e, d) => leaveDays[e._id.toString()].has(catStr(d));

  // ---------- A. dedupe same CAT-day rows ----------
  let dupDeleted = 0;
  for (const e of employees) {
    const rows = await Attendance.find({ employee: e._id }).lean();
    const byCatDay = new Map();
    for (const r of rows) {
      const key = catStr(r.date);
      if (!byCatDay.has(key)) byCatDay.set(key, []);
      byCatDay.get(key).push(r);
    }
    for (const [, group] of byCatDay) {
      if (group.length < 2) continue;
      // Keep the seeded-style original (check-in 05:50Z) when present,
      // otherwise the earliest-created row.
      const keep = group.find((r) => r.checkIn && new Date(r.checkIn).toISOString().startsWith('05:50')) ||
                   group.find((r) => (r.notes || '').match(/seed|07:50/i)) ||
                   group.reduce((a, b) => (new Date(a.createdAt) <= new Date(b.createdAt) ? a : b));
      for (const r of group) {
        if (!r._id.equals(keep._id)) {
          await Attendance.deleteOne({ _id: r._id });
          dupDeleted++;
        }
      }
    }
  }
  console.log(`A) deleted ${dupDeleted} duplicate same-day rows`);

  // ---------- B. remove attendance on approved-leave days ----------
  let leaveDeleted = 0;
  for (const e of employees) {
    const rows = await Attendance.find({ employee: e._id }).lean();
    for (const r of rows) {
      if (onLeave(e, r.date)) {
        await Attendance.deleteOne({ _id: r._id });
        leaveDeleted++;
      }
    }
  }
  console.log(`B) deleted ${leaveDeleted} attendance row(s) on approved-leave days`);

  // ---------- C. today: Ashley & Fadzai absent, others keep/become present ----------
  const todayStr = catStr(new Date());
  const originalTodayStr = new Date(new Date(todayStr + 'T00:00:00.000Z') - CAT_MS).toISOString().slice(0, 10);
  const absentToday = new Set(['ashley', 'fadzai']);
  let todayFixed = 0;
  for (const e of employees) {
    const first = e.firstName.toLowerCase();
    if (onLeave(e, todayStr)) {
      const n = await Attendance.deleteMany({ employee: e._id, date: { $gte: dayUtc(originalTodayStr), $lte: dayUtc(todayStr) } });
      if (n.deletedCount) console.log(`  ${e.firstName}: on leave — removed ${n.deletedCount} stray row(s) around today`);
      continue;
    }
    const row = await Attendance.findOne({ employee: e._id, date: { $gte: dayUtc(originalTodayStr), $lte: dayUtc(todayStr) } }).sort({ date: 1 });
    const isAbsent = absentToday.has(first);
    const checkIn = isAbsent ? null : dayUtc(todayStr); // replaced below with real time
    if (isAbsent) {
      if (row && row.status !== 'Absent') {
        row.status = 'Absent'; row.checkIn = null; row.checkOut = null; row.hoursWorked = 0;
        row.notes = 'Marked absent by admin';
        await row.save(); todayFixed++;
        console.log(`  ${e.firstName}: flipped back to Absent for today`);
      } else if (!row) {
        await Attendance.create({ employee: e._id, date: dayUtc(todayStr), status: 'Absent', checkIn: null, checkOut: null, hoursWorked: 0, notes: 'Marked absent by admin' });
        todayFixed++;
        console.log(`  ${e.firstName}: created Absent for today`);
      } else {
        console.log(`  ${e.firstName}: already Absent today`);
      }
      continue;
    }
    // Present: make sure a record exists and a check-in is recorded
    const inTime = new Date(`${originalTodayStr}T05:55:00.000Z`);
    const outTime = new Date(`${originalTodayStr}T14:00:00.000Z`);
    if (!row) {
      await Attendance.create({
        employee: e._id, date: dayUtc(todayStr),
        checkIn: inTime, checkOut: outTime, status: 'Present',
        hoursWorked: 8.08, notes: 'Backfilled: present 07:55–16:00 CAT'
      });
      todayFixed++;
      console.log(`  ${e.firstName}: created Present 07:55–16:00 for today`);
    } else if (!row.checkIn && row.status === 'Present') {
      row.checkIn = inTime; row.checkOut = outTime; row.hoursWorked = 8.08;
      await row.save(); todayFixed++;
      console.log(`  ${e.firstName}: restored check-in/out for today`);
    } else {
      console.log(`  ${e.firstName}: today already Present with times`);
    }
  }
  console.log(`C) fixed ${todayFixed} row(s) for today (${todayStr})`);

  // ---------- D. fill missing weekday records ----------
  const start = dayUtc('2026-05-01');
  let filled = 0;
  for (const e of employees) {
    const have = new Set(
      (await Attendance.find({ employee: e._id }).lean()).map((r) => catStr(r.date))
    );
    for (let d = new Date(start); catStr(d) <= todayStr; d = new Date(d.getTime() + 86400000)) {
      const key = catStr(d);
      const dow = d.getUTCDay();
      if (dow === 0 || dow === 6) continue;
      if (have.has(key)) continue;
      if (onLeave(e, d)) continue;
      if (holidayInfo(d).isHoliday) continue;
      await Attendance.create({
        employee: e._id, date: d,
        checkIn: new Date(`${key}T05:55:00.000Z`),
        checkOut: new Date(`${key}T14:00:00.000Z`),
        status: 'Present', hoursWorked: 8.08,
        notes: 'Backfilled: present 07:55–16:00 CAT'
      });
      filled++;
    }
  }
  console.log(`D) filled ${filled} missing weekday record(s)`);

  // ---------- summary ----------
  const st = await Attendance.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]);
  console.log('POST attendance by status:', JSON.stringify(st));
  await AuditLog_AndClose(approver);
  process.exit(0);
})().catch((e) => { console.error('FAIL:', e); process.exit(1); });

async function AuditLog_AndClose(approver) {
  const AuditLog = require(path.join(__dirname, '..', 'models', 'AuditLog'));
  await AuditLog.create({
    actorName: 'admin (CLI backfill)',
    action: 'attendance.backfill-fixup',
    target: 'all staff',
    details: `Fixed-up attendance ledger: deduped same-day rows, cleared attendance on approved-leave days, set Ashley & Fadzai absent for today, filled missing weekday records (07:55–16:00 CAT)`
  });
  await mongoose.disconnect();
}
