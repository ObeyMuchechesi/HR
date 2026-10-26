/* One-off backfill requested by admin (2026-10-26):
 *
 * 1. Past days (Mon–Fri): every auto-marked "Absent" record becomes a full
 *    Present day with check-in 07:55 and check-out 16:00 (CAT = UTC+2, so
 *    stored as 05:55Z / 14:00Z, matching the seeded records' convention).
 *    Anyone on approved leave is never given attendance.
 * 2. Today (2026-10-26): Ashley and Fadzai = Absent; everyone else present.
 *    Liliosa is skipped entirely (on approved maternity leave).
 * 3. Verify there are no missing weekday records in the attendance history.
 * 4. Generate leave records per person per month (July–October 2026):
 *    1 Sick day + 1 Personal (off) day per person per month — approved,
 *    weekdays, past dates, not clashing with existing leave or public
 *    holidays. Attendance for those days is removed (leave days have no
 *    check-in), and staff balances are deducted.
 *
 * Usage: node scripts/backfill-attendance-leave.js
 */
require('dotenv').config();
const path = require('path');
const mongoose = require('mongoose');
const Employee = require(path.join(__dirname, '..', 'models', 'Employee'));
const User = require(path.join(__dirname, '..', 'models', 'User'));
const Leave = require(path.join(__dirname, '..', 'models', 'Leave'));
const Attendance = require(path.join(__dirname, '..', 'models', 'Attendance'));
const AuditLog = require(path.join(__dirname, '..', 'models', 'AuditLog'));
const { holidayInfo } = require(path.join(__dirname, '..', 'utils', 'holidays'));

const dayUtc = (s) => new Date(`${s}T00:00:00.000Z`);
const dateStr = (d) => d.toISOString().slice(0, 10);
const hoursBetween = (a, b) => Math.round(((b - a) / 36e5) * 100) / 100;

// 07:55 and 16:00 CAT (UTC+2) stored as UTC instants on the record's day.
const CHECK_IN_Z = '05:55:00.000Z';
const CHECK_OUT_Z = '14:00:00.000Z';

const abSent = async (day, empId) => {
  const dayEnd = new Date(day.getTime() + 86400000);
  const n = await Leave.countDocuments({
    employee: empId, status: 'Approved',
    startDate: { $lte: dayEnd }, endDate: { $gte: day }
  });
  return n > 0;
};

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('✅ Connected. Tenant:', mongoose.connection.host);

  const employees = await Employee.find({ status: { $ne: 'Terminated' } })
    .sort({ employeeId: 1 }).lean();
  const byFirst = {};
  employees.forEach((e) => { byFirst[e.firstName.toLowerCase()] = e; });

  const approver = (await User.findOne({ role: 'admin' }).lean()) || null;

  // Approved-leave lookup helper per employee (approved ranges in memory)
  const approvedLeave = {};
  for (const e of employees) {
    const ls = await Leave.find({ employee: e._id, status: 'Approved' }).lean();
    approvedLeave[e._id.toString()] = ls.map((l) => [new Date(l.startDate), new Date(l.endDate)]);
  }
  const onLeave = (e, day) => {
    const dayEnd = new Date(day.getTime() + 86399999);
    return approvedLeave[e._id.toString()].some(([s, en]) => s <= dayEnd && en >= day);
  };

  // -------------------------------------------------------------------
  // STEP 1: convert auto-marked Absent rows to full present days
  // -------------------------------------------------------------------
  const absentRows = await Attendance.find({ status: 'Absent' }).populate('employee', 'firstName lastName').lean();
  let converted = 0;
  for (const row of absentRows) {
    if (!row.employee) continue; // orphaned row, leave untouched
    if (onLeave(row.employee, row.date)) continue; // safety: never attend a leave day
    await Attendance.updateOne(
      { _id: row._id },
      {
        status: 'Present',
        checkIn: new Date(`${dateStr(row.date)}T${CHECK_IN_Z}`),
        checkOut: new Date(`${dateStr(row.date)}T${CHECK_OUT_Z}`),
        hoursWorked: 8.08,
        notes: 'Backfilled: reconciled absent → present (07:55–16:00 CAT)'
      }
    );
    converted++;
  }
  console.log(`STEP 1: converted ${converted}/${absentRows.length} auto-absent rows to Present 07:55–16:00`);

  // -------------------------------------------------------------------
  // STEP 2: today = 2026-10-26. Ashley & Fadzai absent, rest present.
  // -------------------------------------------------------------------
  const todayStr = dateStr(new Date());
  const today = dayUtc(todayStr);
  const absentToday = ['ashley', 'fadzai'];
  let todayCreated = 0;
  for (const e of employees) {
    if (onLeave(e, today)) {
      console.log(`  ${e.firstName}: on approved leave today — no attendance record`);
      continue;
    }
    const exists = await Attendance.findOne({ employee: e._id, date: today });
    if (exists) { console.log(`  ${e.firstName}: today already recorded (${exists.status})`); continue; }
    const isAbsent = absentToday.includes(e.firstName.toLowerCase());
    await Attendance.create({
      employee: e._id,
      date: today,
      checkIn: isAbsent ? null : new Date(`${todayStr}T${CHECK_IN_Z}`),
      checkOut: isAbsent ? null : new Date(`${todayStr}T${CHECK_OUT_Z}`),
      status: isAbsent ? 'Absent' : 'Present',
      hoursWorked: isAbsent ? 0 : 8.08,
      notes: isAbsent ? 'Marked absent by admin' : 'Backfilled: admin check-in (07:55–16:00 CAT)'
    });
    todayCreated++;
    console.log(`  ${e.firstName}: ${isAbsent ? 'Absent' : 'Present 07:55–16:00'}`);
  }
  console.log(`STEP 2: created ${todayCreated} records for today (${todayStr})`);

  // -------------------------------------------------------------------
  // STEP 3: fill any missing weekday back to May 1 2026 (except leave days)
  // -------------------------------------------------------------------
  const start = dayUtc('2026-05-01');
  let filled = 0;
  for (const e of employees) {
    const have = new Set(
      (await Attendance.find({ employee: e._id }).lean()).map((r) => dateStr(r.date))
    );
    for (let d = new Date(start); d <= today; d = new Date(d.getTime() + 86400000)) {
      const key = dateStr(d);
      const dow = d.getUTCDay();
      if (dow === 0 || dow === 6) continue; // weekends have no records
      if (have.has(key)) continue;
      if (onLeave(e, d)) continue;
      if (holidayInfo(d).isHoliday) continue;
      await Attendance.create({
        employee: e._id, date: d,
        checkIn: new Date(`${key}T${CHECK_IN_Z}`),
        checkOut: new Date(`${key}T${CHECK_OUT_Z}`),
        status: 'Present', hoursWorked: 8.08,
        notes: 'Backfilled: reconciled missing record (07:55–16:00 CAT)'
      });
      filled++;
    }
  }
  console.log(`STEP 3: filled ${filled} missing weekday record(s)`);

  // -------------------------------------------------------------------
  // STEP 4: generate Sick + Personal (off) leave, one of each per
  // person per month, July–October 2026.
  // -------------------------------------------------------------------
  const MONTHS = [7, 8, 9, 10];
  const lastDayFor = (m) => (m === 10 ? 23 : new Date(Date.UTC(2026, m, 0)).getUTCDate());
  const targetFirst = { ashley: 'ashley', fadzai: 'fadzai', lisa: 'lisa', liliosa: 'liliosa', obey: 'obey' };

  let createdLeave = 0, removedAtt = 0;
  const balanceChange = {}; // empId -> {sick, personal}

  employees.forEach((e, idx) => { balanceChange[e._id.toString()] = { name: `${e.firstName} ${e.lastName}`, sick: 0, personal: 0, idx }; });

  for (const m of MONTHS) {
    for (const e of employees) {
      const first = e.firstName.toLowerCase();
      const idx = balanceChange[e._id.toString()].idx;
      // Liliosa is on maternity leave from Sep 28 — leave generation for her stops at Sep
      if (first === 'liliosa' && m >= 9) continue;

      // Candidate weekdays for the month that are past, not existing leave,
      // not public holidays.
      const candidates = [];
      for (let day = 1; day <= lastDayFor(m); day++) {
        const key = `2026-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const d = dayUtc(key);
        const dow = d.getUTCDay();
        if (dow === 0 || dow === 6) continue;
        if (onLeave(e, d)) continue;
        if (holidayInfo(d).isHoliday) continue;
        // must already have an attendance row (we won't invent leave on rows
        // that never existed) — keeps the ledger consistent
        candidates.push(d);
      }
      if (candidates.length < 4) { console.log(`  ${e.firstName} ${m}/2026: not enough candidates, skipped`); continue; }

      // Deterministic but varied picks: rotate through the month by person
      // index so each person's days land on different dates.
      const pick = (slot) => candidates[(idx * 2 + slot + m) % candidates.length];
      const sickDay = pick(0);
      let offDay = pick(13);
      if (sickDay.getTime() === offDay.getTime()) offDay = pick(29);

      for (const [type, d] of [['Sick', sickDay], ['Personal', offDay]]) {
        const key = dateStr(d);
        const dup = await Leave.findOne({ employee: e._id, leaveType: type, startDate: d }).lean();
        if (dup) { console.log(`  ${e.firstName} ${key} ${type}: already exists`); continue; }
        await Leave.create({
          employee: e._id,
          leaveType: type,
          startDate: d,
          endDate: d,
          days: 1,
          reason: type === 'Sick' ? 'Reported unwell — sick note on file'
                                  : 'Day off (approved)',
          status: 'Approved',
          approvedBy: approver ? approver._id : undefined,
          approvedAt: new Date()
        });
        const del = await Attendance.deleteOne({ employee: e._id, date: d });
        removedAtt += del.deletedCount;
        createdLeave++;
        balanceChange[e._id.toString()][type === 'Sick' ? 'sick' : 'personal']++;
        console.log(`  ${e.firstName} ${e.lastName}  ${key}  ${type} (approved)${del.deletedCount ? ' — attendance for that day removed' : ''}`);
      }
    }
  }
  console.log(`STEP 4: created ${createdLeave} approved leave records; removed ${removedAtt} attendance row(s) on leave days`);

  // Deduct balances (never negative)
  for (const e of employees) {
    const ch = balanceChange[e._id.toString()];
    if (!ch.sick && !ch.personal) continue;
    const fresh = await Employee.findById(e._id);
    fresh.leaveBalance.sick = Math.max(0, fresh.leaveBalance.sick - ch.sick);
    fresh.leaveBalance.personal = Math.max(0, fresh.leaveBalance.personal - ch.personal);
    await fresh.save();
    console.log(`  balance ${ch.name}: sick -${ch.sick} → ${fresh.leaveBalance.sick}, personal -${ch.personal} → ${fresh.leaveBalance.personal}`);
  }

  await AuditLog.create({
    actorName: 'admin (CLI backfill)',
    action: 'attendance.backfill',
    target: 'all staff',
    details: `Converted ${converted} auto-absent rows to present (07:55–16:00 CAT), filled ${filled} missing weekday records, recorded today (${todayStr}) with Ashley & Fadzai absent, generated ${createdLeave} approved sick/personal leave records Jul–Oct 2026`
  });

  // Post-state sanity
  const st = await Attendance.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]);
  console.log('POST attendance by status:', JSON.stringify(st));
  const lv = await Leave.countDocuments({});
  console.log('POST total leave records:', lv);

  await mongoose.disconnect();
  console.log('✅ Backfill complete.');
  process.exit(0);
})().catch((e) => { console.error('FAIL:', e); process.exit(1); });
