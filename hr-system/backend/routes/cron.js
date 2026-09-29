const express = require('express');
const router = express.Router();
const Attendance = require('../models/Attendance');
const Employee = require('../models/Employee');
const Leave = require('../models/Leave');
const Notification = require('../models/Notification');
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

module.exports = router;
