const express = require('express');
const Attendance = require('../models/Attendance');
const Employee = require('../models/Employee');
const { protect, authorize } = require('../middleware/auth');
const router = express.Router();

// Parse a YYYY-MM-DD string as UTC midnight (consistent with seeded records)
const dayUtc = (dateStr) => new Date(`${dateStr}T00:00:00.000Z`);
const hoursBetween = (a, b) => Math.max(0, Math.round(((b - a) / 36e5) * 100) / 100);

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
    const { employee, date, checkInAt, checkOutAt, status, notes } = req.body;
    if (!employee || !date) return res.status(400).json({ message: 'Employee and date are required' });
    const day = dayUtc(date);
    if (Number.isNaN(day.getTime())) return res.status(400).json({ message: 'Invalid date' });
    const exists = await Attendance.findOne({ employee, date: day });
    if (exists) return res.status(400).json({ message: 'A record already exists for this employee on that date' });

    const checkIn = checkInAt ? new Date(checkInAt) : undefined;
    const checkOut = checkOutAt ? new Date(checkOutAt) : undefined;
    if (checkIn && Number.isNaN(checkIn.getTime())) return res.status(400).json({ message: 'Invalid check-in time' });
    if (checkOut && Number.isNaN(checkOut.getTime())) return res.status(400).json({ message: 'Invalid check-out time' });
    if (checkIn && checkOut && checkOut < checkIn) return res.status(400).json({ message: 'Check-out must be after check-in' });

    const record = await Attendance.create({
      employee,
      date: day,
      checkIn,
      checkOut,
      hoursWorked: checkIn && checkOut ? hoursBetween(checkIn, checkOut) : 0,
      status: status || 'Present',
      notes: notes || (checkIn || checkOut ? 'Added manually by admin' : undefined)
    });
    res.status(201).json(record);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// POST check-in everyone missing a record for a date (admin/hr/manager)
router.post('/checkin-all', protect, authorize('admin', 'hr', 'manager'), async (req, res) => {
  try {
    const { date, checkInAt, status } = req.body;
    const day = date ? dayUtc(date) : new Date(new Date().setUTCHours(0, 0, 0, 0));
    const at = checkInAt ? new Date(checkInAt) : new Date();
    const staff = await Employee.find({ active: { $ne: false } }).select('_id');
    const existing = await Attendance.find({ date: day }).distinct('employee');
    const missing = staff.filter(e => !existing.some(id => id.equals(e._id)));
    if (missing.length > 0) {
      await Attendance.insertMany(missing.map(e => ({
        employee: e._id,
        date: day,
        checkIn: at,
        status: status || 'Present',
        notes: 'Bulk check-in by admin'
      })));
    }
    res.json({ message: `Checked in ${missing.length} employee(s)`, created: missing.length, skipped: staff.length - missing.length });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// POST check out everyone still open for a date (admin/hr/manager)
router.post('/checkout-all', protect, authorize('admin', 'hr', 'manager'), async (req, res) => {
  try {
    const { date, checkOutAt } = req.body;
    let day;
    if (date) {
      day = dayUtc(date);
    } else {
      day = new Date(new Date().setUTCHours(0, 0, 0, 0));
    }
    const at = checkOutAt ? new Date(checkOutAt) : new Date();
    const open = await Attendance.find({ date: day, checkIn: { $ne: null }, checkOut: null });
    for (const record of open) {
      record.checkOut = at;
      record.hoursWorked = hoursBetween(record.checkIn, at);
      await record.save();
    }
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

    if (isAdminish && req.body.date) {
      const day = dayUtc(req.body.date);
      if (Number.isNaN(day.getTime())) return res.status(400).json({ message: 'Invalid date' });
      record.date = day;
    }
    if (isAdminish && req.body.checkInAt) {
      const d = new Date(req.body.checkInAt);
      if (Number.isNaN(d.getTime())) return res.status(400).json({ message: 'Invalid check-in time' });
      record.checkIn = d;
    }

    if (req.body.checkOut || req.body.checkOutAt) {
      if (!record.checkIn) {
        return res.status(400).json({ message: 'Cannot check out before checking in' });
      }
      if (record.checkOut && !req.body.checkOutAt) {
        return res.status(400).json({ message: 'Already checked out' });
      }
      record.checkOut = req.body.checkOutAt ? new Date(req.body.checkOutAt) : new Date();
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
    res.json(record);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

module.exports = router;
