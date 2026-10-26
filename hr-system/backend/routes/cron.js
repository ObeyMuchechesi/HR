const express = require('express');
const router = express.Router();
const Attendance = require('../models/Attendance');
const Employee = require('../models/Employee');
const Leave = require('../models/Leave');
const Notification = require('../models/Notification');
const AuditLog = require('../models/AuditLog');
const { protect } = require('../middleware/auth');
const { notify, email } = require('../utils/notify');
const { holidayInfo } = require('../utils/holidays');

// Vercel Cron authenticates with CRON_SECRET; humans fall through to JWT auth.
const authEither = (req, res, next) => {
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (process.env.CRON_SECRET && bearer && bearer === process.env.CRON_SECRET) return next();
  return protect(req, res, next);
};

// GET /api/cron/mark-absents?day=YYYY-MM-DD
// Marks Absent for every active employee without an attendance record.
// Employees on approved leave get no record (leave days are skipped,
// matching the seeder). Auth: Vercel Cron via CRON_SECRET, or any
// logged-in admin (so it can also be triggered by hand from the UI).
router.get('/mark-absents', authEither, async (req, res) => {
  try {
    if (req.user && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin only' });
    }

    const day = /^\d{4}-\d{2}-\d{2}$/.test(req.query.day || '')
      ? new Date(`${req.query.day}T00:00:00.000Z`)
      : new Date(new Date().setUTCHours(0, 0, 0, 0));

    const staff = await Employee.find({ status: { $in: ['Active', 'On Leave'] } }).select('_id firstName lastName');
    const existing = await Attendance.find({ date: day }).distinct('employee');

    // Employees on approved leave that covers this day are skipped entirely
    const dayEnd = new Date(day.getTime() + 86400000);
    const onLeave = await Leave.find({
      status: 'Approved',
      startDate: { $lte: dayEnd },
      endDate: { $gte: day }
    }).distinct('employee');

    const targets = staff.filter(e =>
      !existing.some(id => id.equals(e._id)) &&
      !onLeave.some(id => id.equals(e._id))
    );

    // On a Zimbabwe public holiday everyone without a record gets status
    // 'Holiday' (no absence counted) instead of 'Absent'.
    const hol = holidayInfo(day);
    if (targets.length > 0) {
      await Attendance.insertMany(targets.map(e => ({
        employee: e._id,
        date: day,
        status: hol.isHoliday ? 'Holiday' : 'Absent',
        notes: hol.isHoliday ? `Public holiday (${hol.name})` : 'Auto-marked absent (no check-in recorded)'
      })));
    }
    // Daily close-of-business summary to admins (in-app + email if SMTP set).
    // MUST run before res.json: serverless freezes the function once the
    // response is sent, so background work after it never completes.
    if (!req.query.noSummary) {
      const present = await Attendance.countDocuments({ date: day, status: 'Present' });
      const late = await Attendance.countDocuments({ date: day, status: 'Late' });
      const remote = await Attendance.countDocuments({ date: day, status: 'Remote' });
      const absent = await Attendance.countDocuments({ date: day, status: 'Absent' });
      const holiday = await Attendance.countDocuments({ date: day, status: 'Holiday' });
      const dayStr = day.toISOString().slice(0, 10);
      const summary = `Present ${present} · Late ${late} · Remote ${remote} · Absent ${absent} · Holiday ${holiday} · On leave ${onLeave.length}${hol.isHoliday ? ` — ${hol.name} 🇿🇼` : ''}`;
      await notify({
        roles: ['admin', 'hr'],
        title: `Daily attendance summary — ${dayStr}`,
        body: summary,
        link: '/attendance',
        email: true
      });
    }

    res.json({
      message: hol.isHoliday
        ? `Public holiday (${hol.name}) — marked ${targets.length} employee(s) as Holiday for ${day.toISOString().slice(0, 10)}`
        : `Marked ${targets.length} employee(s) absent for ${day.toISOString().slice(0, 10)}`,
      marked: targets.length,
      status: hol.isHoliday ? 'Holiday' : 'Absent',
      holiday: hol.isHoliday ? hol.name : null,
      skipped: { alreadyRecorded: existing.length, onLeave: onLeave.length }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET /api/cron/holiday-announce[?day=YYYY-MM-DD]
// Runs daily shortly after CAT midnight. If today is a Zimbabwe public holiday,
// sends a company-wide in-app announcement (all roles) — once per holiday per day,
// so cron retries and manual triggers never spam. Auth: CRON_SECRET or admin JWT.
router.get('/holiday-announce', authEither, async (req, res) => {
  try {
    if (req.user && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin only' });
    }
    const day = /^\d{4}-\d{2}-\d{2}$/.test(req.query.day || '')
      ? new Date(`${req.query.day}T00:00:00.000Z`)
      : new Date(new Date().setUTCHours(0, 0, 0, 0));

    const hol = holidayInfo(day);
    if (!hol.isHoliday) {
      return res.json({ announced: false, reason: 'Not a public holiday' });
    }

    // Idempotency: skip if this exact announcement already went out in the
    // last 20 hours (covers cron retries and manual re-triggers; a yearly
    // recurrence is always >20h away). createdAt is the SEND time, not the
    // holiday date, so matching on the holiday's own day window would miss
    // manual triggers for future dates.
    const already = await Notification.exists({
      title: `Public holiday today — ${hol.name} 🇿🇼`,
      createdAt: { $gte: new Date(Date.now() - 20 * 3600 * 1000) }
    });
    if (already) {
      return res.json({ announced: false, reason: 'Already announced today', holiday: hol.name });
    }

    await notify({
      roles: ['admin', 'hr', 'manager', 'employee'],
      title: `Public holiday today — ${hol.name} 🇿🇼`,
      body: `${hol.name} is a Zimbabwe public holiday. The office is closed — no check-in needed. Enjoy the day!`,
      link: '/',
      email: true
    });
    res.json({ announced: true, holiday: hol.name, day: day.toISOString().slice(0, 10) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ---------------------------------------------------------------------------
// AUTO ATTENDANCE (two Vercel cron entries per weekday — the Hobby plan only
// allows each cron to fire at most once per day, so the morning and evening
// passes are separate endpoints/entries)
//
// vercel.json schedules two weekday entries:
//   • /api/cron/auto-attendance at 05:55 UTC (07:55 CAT) → morning pass: every
//     active employee without a record today is checked in at exactly 07:55
//     (on-leave staff and public holidays are skipped; weekends never trigger).
//     On Fridays a weekly attendance summary is generated right afterwards.
//   • /api/cron/evening-close at 22:00 UTC → evening pass: every still-open
//     check-in is closed at 16:00 CAT (8.08h) and everyone with no record at
//     all is marked Absent, then the daily summary notification goes out.
// Everything is idempotent, so manual re-triggers and retries are safe.
// ---------------------------------------------------------------------------

const dayStart = () => new Date(new Date().setUTCHours(0, 0, 0, 0));
const checkInInstant = (day) => new Date(day.getTime() + 5 * 3600e3 + 55 * 60e3);   // 05:55Z = 07:55 CAT
const checkOutInstant = (day) => new Date(day.getTime() + 14 * 3600e3);              // 14:00Z = 16:00 CAT
const WEEKLY_TITLE_PREFIX = 'Weekly attendance summary —';

// Employees (Active/On Leave) that neither have a record nor an approved
// leave covering `day`. Returns { staff, existing, onLeave, missing }.
const staffStateForDay = async (day) => {
  const staff = await Employee.find({ status: { $in: ['Active', 'On Leave'] } }).select('_id firstName lastName').lean();
  const existingIds = await Attendance.find({ date: day }).distinct('employee');
  const dayEnd = new Date(day.getTime() + 86400000);
  const onLeaveIds = await Leave.find({ status: 'Approved', startDate: { $lte: dayEnd }, endDate: { $gte: day } })
    .distinct('employee');
  const have = new Set(existingIds.map(String));
  const offOnLeave = new Set(onLeaveIds.map(String));
  const missing = staff.filter(e => !have.has(e._id.toString()) && !offOnLeave.has(e._id.toString()));
  return { staff, existingIds, onLeaveIds, missing };
};

// Morning pass: auto check-in for everyone missing a record. Rows are created
// as 'pending-checkin' — an admin must approve them before they count.
const runMorningCheckIn = async (day) => {
  const hol = holidayInfo(day);
  if (hol.isHoliday) {
    return { message: `Public holiday (${hol.name}) — auto check-in skipped, no attendance needed` };
  }
  const { missing, onLeaveIds } = await staffStateForDay(day);
  if (missing.length > 0) {
    await Attendance.insertMany(missing.map(e => ({
      employee: e._id,
      date: day,
      checkIn: checkInInstant(day),
      status: 'Present',
      hoursWorked: 0,
      notes: 'Auto check-in (07:55 CAT) — awaiting admin approval',
      approvalState: 'pending-checkin'
    })));
    await notify({
      roles: ['admin', 'hr', 'manager'],
      title: `${missing.length} check-in(s) awaiting approval — ${day.toISOString().slice(0, 10)}`,
      body: 'The 07:55 auto check-ins are waiting for your approval on the Attendance page.',
      link: '/attendance'
    });
  }
  const lines = [`Auto check-in ${day.toISOString().slice(0, 10)} (07:55 CAT)`, `Generated ${missing.length} pending check-in(s)`];
  if (onLeaveIds.length) lines.push(`${onLeaveIds.length} on approved leave skipped`);
  await AuditLog.create({ actorName: 'automation', action: 'attendance.auto-checkin', target: `${missing.length} employees`, details: lines.join(' · ') });
  return { checkedIn: missing.length, onLeaveSkipped: onLeaveIds.length };
};

// Friday extra: weekly attendance summary generated after the Friday check-in.
const runWeeklySummary = async (day) => {
  const monday = new Date(day.getTime() - 4 * 86400000);            // Mon of this week
  const rangeEnd = new Date(day.getTime() + 86400000);              // exclusive
  const range = `${monday.toISOString().slice(0, 10)} → ${day.toISOString().slice(0, 10)}`;

  // Idempotency: one weekly summary per week (even across manual re-triggers).
  const already = await Notification.exists({
    title: `${WEEKLY_TITLE_PREFIX} ${range}`,
    createdAt: { $gte: new Date(Date.now() - 4 * 86400000) }
  });
  if (already) return { generated: false, reason: 'already generated this week' };

  const rows = await Attendance.aggregate([
    { $match: { date: { $gte: monday, $lt: rangeEnd } } },
    { $group: {
      _id: '$employee',
      present: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'Present'] }, { $ne: ['$approvalState', 'pending-checkin'] }] }, 1, 0] } },
      late: { $sum: { $cond: [{ $eq: ['$status', 'Late'] }, 1, 0] } },
      remote: { $sum: { $cond: [{ $eq: ['$status', 'Remote'] }, 1, 0] } },
      absent: { $sum: { $cond: [{ $eq: ['$status', 'Absent'] }, 1, 0] } },
      holiday: { $sum: { $cond: [{ $eq: ['$status', 'Holiday'] }, 1, 0] } },
      hours: { $sum: { $ifNull: ['$hoursWorked', 0] } }
    } }
  ]);
  const staff = await Employee.find({}).select('firstName lastName').lean();
  const names = {};
  staff.forEach(e => { names[e._id.toString()] = `${e.firstName} ${e.lastName}`; });
  const leaveThisWeek = await Leave.find({ status: 'Approved', startDate: { $lt: rangeEnd }, endDate: { $gte: monday } }).lean();
  const leaveByEmp = {};
  leaveThisWeek.forEach(l => { leaveByEmp[l.employee.toString()] = (leaveByEmp[l.employee.toString()] || 0) + l.days; });

  const lines = Object.keys(names).length === 0 ? [] : staff.map(e => {
    const r = rows.find(x => x._id && x._id.toString() === e._id.toString());
    if (!r) return `• ${names[e._id.toString()]}: on leave or no record this week${leaveByEmp[e._id.toString()] ? ` (${leaveByEmp[e._id.toString()]}d leave)` : ''}`;
    const extras = [
      r.absent ? `absent ${r.absent}` : null,
      r.late ? `late ${r.late}` : null,
      r.remote ? `remote ${r.remote}` : null,
      r.holiday ? `holiday ${r.holiday}` : null,
      leaveByEmp[e._id.toString()] ? `leave ${leaveByEmp[e._id.toString()]}d` : null
    ].filter(Boolean);
    return `• ${names[e._id.toString()]}: present ${r.present}, ${Math.round(r.hours * 100) / 100}h${extras.length ? ', ' + extras.join(', ') : ''}`;
  });

  const body = `Week ${range}\n${lines.join('\n') || 'No attendance recorded this week.'}`;
  await notify({
    roles: ['admin', 'hr', 'manager', 'employee'],
    title: `${WEEKLY_TITLE_PREFIX} ${range}`,
    body,
    link: '/attendance',
    email: true
  });
  await AuditLog.create({ actorName: 'automation', action: 'attendance.weekly-summary', target: range, details: `${staff.length} staff included` });
  return { generated: true, range, staff: staff.length };
};

// Evening pass:
//  • check-ins still awaiting approval at end of business become Absent
//    (they were never approved, so they never happened)
//  • approved open check-ins are closed at 16:00 CAT, recorded as
//    'pending-checkout' awaiting admin approval
//  • daily summary notification goes out
const runEveningClose = async (day) => {
  // 1. unresolved check-in approvals → Absent
  const unapproved = await Attendance.find({ date: day, approvalState: 'pending-checkin' }).lean();
  for (const record of unapproved) {
    await Attendance.updateOne(
      { _id: record._id },
      {
        status: 'Absent',
        checkIn: null,
        hoursWorked: 0,
        approvalState: 'approved',
        notes: (record.notes ? record.notes + ' · ' : '') + 'Not approved by close of business — marked absent'
      }
    );
  }

  // 2. check-out everyone approved and still open (skip on-leave staff — leave has no records)
  const open = await Attendance.find({
    date: day, checkIn: { $ne: null }, checkOut: null,
    approvalState: { $ne: 'pending-checkin' }
  }).lean();
  let closed = 0;
  for (const record of open) {
    await Attendance.updateOne(
      { _id: record._id },
      {
        checkOut: checkOutInstant(day),
        hoursWorked: 8.08,
        approvalState: 'pending-checkout',
        notes: (record.notes ? record.notes + ' · ' : '') + 'Auto check-out (16:00 CAT) — awaiting admin approval'
      }
    );
    closed++;
  }

  // 3. mark every active employee without any record as Absent
  //    (on-leave staff excluded — leave days never carry attendance)
  const { staff, existingIds, onLeaveIds, missing } = await staffStateForDay(day);
  if (missing.length > 0) {
    await Attendance.insertMany(missing.map(e => ({
      employee: e._id,
      date: day,
      status: 'Absent',
      checkIn: null,
      checkOut: null,
      hoursWorked: 0,
      notes: 'Auto-marked absent (no check-in recorded)'
    })));
  }

  if (closed > 0) {
    await notify({
      roles: ['admin', 'hr', 'manager'],
      title: `${closed} check-out(s) awaiting approval — ${day.toISOString().slice(0, 10)}`,
      body: 'The 16:00 auto check-outs are waiting for your approval on the Attendance page.',
      link: '/attendance'
    });
  }

  // 4. daily close-of-business summary (same as the old 22:00 mark-absents cron)
  const present = await Attendance.countDocuments({ date: day, status: 'Present', approvalState: { $ne: 'pending-checkin' } });
  const late = await Attendance.countDocuments({ date: day, status: 'Late' });
  const remote = await Attendance.countDocuments({ date: day, status: 'Remote' });
  const absent = await Attendance.countDocuments({ date: day, status: 'Absent' });
  const holiday = await Attendance.countDocuments({ date: day, status: 'Holiday' });
  const hol = holidayInfo(day);
  const summaryText = `Present ${present} · Late ${late} · Remote ${remote} · Absent ${absent} · Holiday ${holiday} · On leave ${onLeaveIds.length}${hol.isHoliday ? ` — ${hol.name} 🇿🇼` : ''}`;
  await notify({
    roles: ['admin', 'hr'],
    title: `Daily attendance summary — ${day.toISOString().slice(0, 10)}`,
    body: summaryText,
    link: '/attendance',
    email: true
  });
  await AuditLog.create({
    actorName: 'automation', action: 'attendance.auto-close', target: day.toISOString().slice(0, 10),
    details: `Unapproved check-ins flipped to absent: ${unapproved.length} · check-outs pending approval: ${closed} · marked absent: ${missing.length}${hol.isHoliday ? ` · public holiday (${hol.name})` : ''}`
  });
  return { checkedOut: closed, pendingCheckinsExpired: unapproved.length, markedAbsent: missing.length, onLeaveSkipped: onLeaveIds.length };
};

// GET /api/cron/auto-attendance  — MORNING pass (07:55 CAT check-in).
// Triggered by the Vercel cron at 05:55Z Mon–Fri (weekends never fire, and a
// day override is still guarded). Auth: CRON_SECRET or a logged-in admin —
// manual triggers are safe and idempotent.
router.get('/auto-attendance', authEither, async (req, res) => {
  try {
    if (req.user && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin only' });
    }
    // Optional override for manual/admin triggers: ?day=YYYY-MM-DD
    const day = /^\d{4}-\d{2}-\d{2}$/.test(req.query.day || '')
      ? new Date(`${req.query.day}T00:00:00.000Z`)
      : dayStart();
    if (Number.isNaN(day.getTime())) return res.status(400).json({ message: 'Invalid day' });
    const dow = day.getUTCDay();
    if (dow === 0 || dow === 6) {
      return res.json({ skipped: true, reason: 'Weekend — no auto check-in' });
    }
    const result = await runMorningCheckIn(day);
    let weekly = null;
    if (dow === 5) weekly = await runWeeklySummary(day);   // Friday check-in → weekly summary
    return res.json({
      pass: 'morning',
      message: `Auto check-in done: ${result.checkedIn} employee(s)${result.onLeaveSkipped ? `, ${result.onLeaveSkipped} on leave skipped` : ''}${weekly && weekly.generated ? ' · weekly summary generated' : ''}`,
      ...result,
      weekly
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET /api/cron/evening-close  — EVENING pass (16:00 CAT check-out + absents).
// Triggered by the Vercel cron at 22:00Z Mon–Fri. Auth: CRON_SECRET or admin.
router.get('/evening-close', authEither, async (req, res) => {
  try {
    if (req.user && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin only' });
    }
    const day = /^\d{4}-\d{2}-\d{2}$/.test(req.query.day || '')
      ? new Date(`${req.query.day}T00:00:00.000Z`)
      : dayStart();
    if (Number.isNaN(day.getTime())) return res.status(400).json({ message: 'Invalid day' });
    const dow = day.getUTCDay();
    if (dow === 0 || dow === 6) {
      return res.json({ skipped: true, reason: 'Weekend — nothing to close' });
    }
    const hol = holidayInfo(day);
    if (hol.isHoliday) {
      return res.json({ pass: 'evening', message: `Public holiday (${hol.name}) — nothing to close` });
    }
    const result = await runEveningClose(day);
    return res.json({
      pass: 'evening',
      message: `${result.pendingCheckinsExpired} unapproved check-in(s) → absent, closed ${result.checkedOut} record(s) at 16:00 CAT, marked ${result.markedAbsent} absent${result.onLeaveSkipped ? `, ${result.onLeaveSkipped} on leave skipped` : ''}`,
      ...result
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
