const express = require('express');
const { protect } = require('../middleware/auth');
const { upcomingHolidays, holidayInfo, workingDaysInMonth } = require('../utils/holidays');
const router = express.Router();

// GET /api/holidays/upcoming?limit=5[&from=YYYY-MM-DD]
// Zimbabwe public holidays ahead (inclusive of today), for the dashboard widget.
router.get('/upcoming', protect, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 5, 26);
    const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '')
      ? new Date(`${req.query.from}T00:00:00.000Z`)
      : new Date();
    const holidays = upcomingHolidays(from, limit).map(h => ({
      date: h.date.toISOString().slice(0, 10),
      name: h.name,
      weekday: h.date.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' }),
      daysUntil: Math.round((h.date - new Date(new Date(from).setUTCHours(0, 0, 0, 0))) / 86400000)
    }));
    res.json({ holidays });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET /api/holidays/today -> { isPublicHoliday, holidayName } (convenience mirror
// of /api/attendance/summary/today fields).
router.get('/today', protect, async (req, res) => {
  try {
    const info = holidayInfo(new Date());
    res.json({ isPublicHoliday: info.isHoliday, holidayName: info.name || null });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET /api/holidays/working-days?year=2026&month=12
// Mon–Fri days minus public holidays, for payroll proration. Includes per-holiday
// breakdown and net pay suggestion at 1/22 per working day.
router.get('/working-days', protect, async (req, res) => {
  try {
    const now = new Date();
    const year = Number(req.query.year) || now.getFullYear();
    const month = Number(req.query.month) || now.getMonth() + 1;
    const w = workingDaysInMonth(year, month);
    res.json({
      year, month,
      totalDays: w.total,
      weekdays: w.weekdays,
      publicHolidays: w.holidays,
      workingDays: w.workingDays,
      holidays: w.holidayList.map(h => ({
        date: h.date.toISOString().slice(0, 10),
        name: h.name
      }))
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
