const express = require('express');
const Attendance = require('../models/Attendance');
const { protect, authorize } = require('../middleware/auth');
const router = express.Router();

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

// PUT check-out / update
router.put('/:id', protect, async (req, res) => {
  try {
    const record = await Attendance.findById(req.params.id);
    if (!record) return res.status(404).json({ message: 'Record not found' });

    if (req.body.checkOut) {
      if (!record.checkIn) {
        return res.status(400).json({ message: 'Cannot check out before checking in' });
      }
      if (record.checkOut) {
        return res.status(400).json({ message: 'Already checked out' });
      }
      record.checkOut = new Date();
      const diff = Math.max(0, (record.checkOut - record.checkIn) / (1000 * 60 * 60));
      record.hoursWorked = Math.round(diff * 100) / 100;
    }
    if (req.body.status) record.status = req.body.status;
    if (req.body.notes) record.notes = req.body.notes;
    await record.save();
    res.json(record);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

module.exports = router;
