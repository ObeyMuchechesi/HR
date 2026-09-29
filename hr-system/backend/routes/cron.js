const express = require('express');
const router = express.Router();
const Attendance = require('../models/Attendance');
const Employee = require('../models/Employee');
const Leave = require('../models/Leave');
const { protect } = require('../middleware/auth');

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

    if (targets.length > 0) {
      await Attendance.insertMany(targets.map(e => ({
        employee: e._id,
        date: day,
        status: 'Absent',
        notes: 'Auto-marked absent (no check-in recorded)'
      })));
    }
    res.json({
      message: `Marked ${targets.length} employee(s) absent for ${day.toISOString().slice(0, 10)}`,
      marked: targets.length,
      skipped: { alreadyRecorded: existing.length, onLeave: onLeave.length }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
