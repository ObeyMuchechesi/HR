const express = require('express');
const Attendance = require('../models/Attendance');
const Employee = require('../models/Employee');
const AuditLog = require('../models/AuditLog');
const { protect, authorize } = require('../middleware/auth');
const router = express.Router();

// Parse a YYYY-MM-DD string as UTC midnight (consistent with seeded records)
const dayUtc = (dateStr) => new Date(`${dateStr}T00:00:00.000Z`);
const hoursBetween = (a, b) => Math.max(0, Math.round(((b - a) / 36e5) * 100) / 100);
const fmt = (d) => (d ? new Date(d).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '—');

// Convert admin-entered local date+time to the true UTC instant.
// Browsers run in the admin's timezone; serverless runs in UTC, so the
// client sends getTimezoneOffset() minutes (Harare UTC+2 → -120).
const localToUtc = (dateStr, timeStr, tzOffsetMin) => {
  const d = new Date(`${dateStr}T${timeStr}:00.000Z`);
  if (Number.isNaN(d.getTime())) return d;
  d.setUTCMinutes(d.getUTCMinutes() + (Number(tzOffsetMin) || 0));
  return d;
};

async function audit(req, action, target, details) {
  try {
    await AuditLog.create({ actor: req.user?._id, actorName: req.user?.name || 'system', action, target, details });
  } catch (e) { /* logging must never break the request */ }
}

// GET today's summary (declared before /:id)
router.get('/summary/today', protect, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const present = await Attendance.countDocuments({ date: today, status: 'Present' });
    const absent = await Attendance.countDocuments({ date: today, status: 'Absent' });
    const late = await Attendance.countDocuments({ date: today, status: 'Late' });
    const remote = await Attendance.countDocuments({ date: today, status: 'Remote' });
    res.json({ present, absent, late, remote });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET monthly report per employee: ?month=YYYY-MM (defaults to current month)
router.get('/report', protect, authorize('admin', 'hr', 'manager'), async (req, res) => {
  try {
    const monthStr = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : new Date().toISOString().slice(0, 7);
    const start = dayUtc(`${monthStr}-01`);
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));

    const match = { date: { $gte: start, $lt: end } };
    const rows = await Attendance.aggregate([
      { $match: match },
      { $group: {
        _id: '$employee',
        present: { $sum: { $cond: [{ $eq: ['$status', 'Present'] }, 1, 0] } },
        late: { $sum: { $cond: [{ $eq: ['$status', 'Late'] }, 1, 0] } },
        remote: { $sum: { $cond: [{ $eq: ['$status', 'Remote'] }, 1, 0] } },
        absent: { $sum: { $cond: [{ $eq: ['$status', 'Absent'] }, 1, 0] } },
        halfDay: { $sum: { $cond: [{ $eq: ['$status', 'Half-day'] }, 1, 0] } },
        totalHours: { $sum: { $ifNull: ['$hoursWorked', 0] } }
      } },
      { $sort: { totalHours: -1 } }
    ]);

    const employees = await Employee.find({}).select('firstName lastName employeeId');
    const nameOf = {};
    employees.forEach(e => { nameOf[e._id.toString()] = e; });

    const report = rows.map(r => {
      const e = nameOf[r._id.toString()] || {};
      return {
        employeeId: e.employeeId || '—',
        name: `${e.firstName || '?'} ${e.lastName || ''}`.trim(),
        present: r.present, late: r.late, remote: r.remote, absent: r.absent, halfDay: r.halfDay,
        totalHours: Math.round(r.totalHours * 100) / 100
      };
    });
    // include employees with no records at all this month
    employees.forEach(e => {
      if (!report.some(r => r.employeeId === e.employeeId)) {
        report.push({ employeeId: e.employeeId, name: `${e.firstName} ${e.lastName}`, present: 0, late: 0, remote: 0, absent: 0, halfDay: 0, totalHours: 0 });
      }
    });

    res.json({ month: monthStr, report });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET audit trail (recent admin actions)
router.get('/audit', protect, authorize('admin', 'hr', 'manager'), async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 25, 100);
    const logs = await AuditLog.find({}).sort({ createdAt: -1 }).limit(limit);
    res.json(logs);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET attendance
router.get('/', protect, async (req, res) => {
  try {
    const filter = {};
    // Employees can only see their own records
    if (req.user.role === 'employee') {
      if (!req.user.employee) return res.status(403).json({ message: 'No employee profile linked to your account' });
      filter.employee = req.user.employee;
    } else if (req.query.employee) {
      filter.employee = req.query.employee;
    }
    if (req.query.date) {
      const d = new Date(req.query.date);
      filter.date = { $gte: new Date(d.setHours(0, 0, 0, 0)), $lte: new Date(d.setHours(23, 59, 59, 999)) };
    }
    const records = await Attendance.find(filter)
      .populate('employee', 'firstName lastName employeeId')
      .sort({ date: -1 })
      .limit(200);
    res.json(records);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// POST manual record with admin-chosen date and times (admin/hr/manager)
router.post('/manual', protect, authorize('admin', 'hr', 'manager'), async (req, res) => {
  try {
    const { employee, date, checkInTime, checkOutTime, status, notes, tzOffset } = req.body;
    if (!employee || !date || !checkInTime) {
      return res.status(400).json({ message: 'Employee, date and check-in time are required' });
    }
    const day = dayUtc(date);
    if (Number.isNaN(day.getTime())) return res.status(400).json({ message: 'Invalid date' });

    const checkIn = localToUtc(date, checkInTime, tzOffset);
    const checkOut = checkOutTime ? localToUtc(date, checkOutTime, tzOffset) : undefined;
    if (Number.isNaN(checkIn.getTime())) return res.status(400).json({ message: 'Invalid check-in time' });
    if (checkOut && Number.isNaN(checkOut.getTime())) return res.status(400).json({ message: 'Invalid check-out time' });
    if (checkOut && checkOut < checkIn) return res.status(400).json({ message: 'Check-out must be after check-in' });

    const exists = await Attendance.findOne({ employee, date: day });
    if (exists) return res.status(400).json({ message: 'A record already exists for this employee on that date' });

    const emp = await Employee.findById(employee).select('firstName lastName');
    const record = await Attendance.create({
      employee,
      date: day,
      checkIn,
      checkOut,
      hoursWorked: checkOut ? hoursBetween(checkIn, checkOut) : 0,
      status: status || 'Present',
      notes: notes || `Added manually by ${req.user.name}`
    });
    await audit(req, 'attendance.manual', `${emp?.firstName} ${emp?.lastName}`,
      `${date} in ${checkInTime}${checkOutTime ? `, out ${checkOutTime}` : ''} (${status || 'Present'})`);
    res.status(201).json(record);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// POST check-in everyone missing a record for a date (admin/hr/manager)
router.post('/checkin-all', protect, authorize('admin', 'hr', 'manager'), async (req, res) => {
  try {
    const today = new Date();
    const day = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
    const at = new Date();
    const staff = await Employee.find({ status: { $ne: 'Terminated' } }).select('_id firstName lastName');
    const existing = await Attendance.find({ date: day }).distinct('employee');
    const missing = staff.filter(e => !existing.some(id => id.equals(e._id)));
    if (missing.length > 0) {
      await Attendance.insertMany(missing.map(e => ({
        employee: e._id,
        date: day,
        checkIn: at,
        status: 'Present',
        notes: `Bulk check-in by ${req.user.name}`
      })));
    }
    await audit(req, 'attendance.bulk-checkin', `${missing.length} employees`, `Bulk check-in for ${day.toISOString().slice(0, 10)}`);
    res.json({ message: `Checked in ${missing.length} employee(s)`, created: missing.length, skipped: staff.length - missing.length });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// POST check out everyone still open for a date (admin/hr/manager)
router.post('/checkout-all', protect, authorize('admin', 'hr', 'manager'), async (req, res) => {
  try {
    const today = new Date();
    const day = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
    const at = new Date();
    const open = await Attendance.find({ date: day, checkIn: { $ne: null }, checkOut: null });
    for (const record of open) {
      record.checkOut = at;
      record.hoursWorked = hoursBetween(record.checkIn, at);
      await record.save();
    }
    await audit(req, 'attendance.bulk-checkout', `${open.length} employees`, `Bulk check-out for ${day.toISOString().slice(0, 10)}`);
    res.json({ message: `Checked out ${open.length} employee(s)`, updated: open.length });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// POST check-in / create
router.post('/', protect, async (req, res) => {
  try {
    let { employee, status, notes } = req.body;
    // Employees can only check themselves in
    if (req.user.role === 'employee') {
      if (!req.user.employee) return res.status(403).json({ message: 'No employee profile linked to your account' });
      employee = req.user.employee;
    }
    if (!employee) return res.status(400).json({ message: 'Employee is required' });
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let record = await Attendance.findOne({ employee, date: today });
    if (record) return res.status(400).json({ message: 'Already checked in today' });

    record = await Attendance.create({
      employee,
      date: today,
      checkIn: new Date(),
      status: status || 'Present',
      notes
    });
    res.status(201).json(record);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// PUT check-out / update (admins may set explicit date and times)
router.put('/:id', protect, async (req, res) => {
  try {
    const record = await Attendance.findById(req.params.id);
    if (!record) return res.status(404).json({ message: 'Record not found' });
    const isAdminish = ['admin', 'hr', 'manager'].includes(req.user.role);

    const emp = await Employee.findById(record.employee).select('firstName lastName');

    if (isAdminish && req.body.date) {
      const day = dayUtc(req.body.date);
      if (Number.isNaN(day.getTime())) return res.status(400).json({ message: 'Invalid date' });
      record.date = day;
    }
    if (isAdminish && req.body.checkInTime) {
      const baseDate = record.date.toISOString().slice(0, 10);
      const d = localToUtc(baseDate, req.body.checkInTime, req.body.tzOffset);
      if (Number.isNaN(d.getTime())) return res.status(400).json({ message: 'Invalid check-in time' });
      record.checkIn = d;
    }

    if (req.body.checkOutTime || req.body.checkOut) {
      if (!record.checkIn) {
        return res.status(400).json({ message: 'Cannot check out before checking in' });
      }
      if (record.checkOut && !req.body.checkOutTime) {
        return res.status(400).json({ message: 'Already checked out' });
      }
      const baseDate = record.date.toISOString().slice(0, 10);
      record.checkOut = req.body.checkOutTime
        ? localToUtc(baseDate, req.body.checkOutTime, req.body.tzOffset)
        : new Date(req.body.checkOut);
      if (Number.isNaN(record.checkOut.getTime())) return res.status(400).json({ message: 'Invalid check-out time' });
      record.hoursWorked = hoursBetween(record.checkIn, record.checkOut);
    }
    if (req.body.status) record.status = req.body.status;
    if (req.body.notes) record.notes = req.body.notes;

    // Recompute if an admin moved check-in on a closed record
    if (isAdminish && record.checkIn && record.checkOut) {
      record.hoursWorked = hoursBetween(record.checkIn, record.checkOut);
    }
    await record.save();
    if (isAdminish) {
      // Show times as the admin entered them (their local timezone)
      const off = Number(req.body.tzOffset) || 0;
      const asLocal = (d) => (d ? new Date(d.getTime() - off * 60000).toISOString().slice(11, 16) : '—');
      await audit(req, 'attendance.edit', `${emp?.firstName} ${emp?.lastName}`,
        `${record.date.toISOString().slice(0, 10)} → in ${asLocal(record.checkIn)}, out ${asLocal(record.checkOut)}, ${record.status}`);
    }
    res.json(record);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

module.exports = router;
