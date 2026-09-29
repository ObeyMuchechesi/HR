const express = require('express');
const Leave = require('../models/Leave');
const Employee = require('../models/Employee');
const User = require('../models/User');
const { protect, authorize } = require('../middleware/auth');
const { notify } = require('../utils/notify');
const router = express.Router();

// GET leaves
router.get('/', protect, async (req, res) => {
  try {
    const filter = {};
    if (req.user.role === 'employee') {
      if (!req.user.employee) return res.status(403).json({ message: 'No employee profile linked to your account' });
      filter.employee = req.user.employee;
    }
    if (req.query.status) filter.status = req.query.status;
    if (req.query.employee) filter.employee = req.query.employee;
    const leaves = await Leave.find(filter)
      .populate('employee', 'firstName lastName employeeId')
      .populate('approvedBy', 'name')
      .sort({ createdAt: -1 });
    res.json(leaves);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// POST create leave request
router.post('/', protect, async (req, res) => {
  try {
    let { employee, leaveType, startDate, endDate, reason } = req.body;
    // Employees can only request leave for themselves
    if (req.user.role === 'employee') {
      if (!req.user.employee) return res.status(403).json({ message: 'No employee profile linked to your account' });
      employee = req.user.employee;
    }
    if (!employee) return res.status(400).json({ message: 'Employee is required' });
    const start = new Date(startDate);
    const end = new Date(endDate);
    const days = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;

    if (days <= 0) return res.status(400).json({ message: 'Invalid date range' });

    const leave = await Leave.create({
      employee, leaveType, startDate: start, endDate: end, days, reason
    });

    // Notify admins/HR (and the requester for visibility)
    const emp = await Employee.findById(employee).select('firstName lastName');
    const name = emp ? `${emp.firstName} ${emp.lastName}` : 'An employee';
    const range = `${start.toISOString().slice(0, 10)} → ${end.toISOString().slice(0, 10)}`;
    await notify({
      roles: ['admin', 'hr', 'manager'],
      userIds: [req.user._id],
      title: 'New leave request',
      body: `${name} requested ${leaveType} leave (${days} day${days > 1 ? 's' : ''}), ${range}`,
      link: '/leaves',
      email: true
    });

    res.status(201).json(leave);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// PUT update leave (approve/reject)
router.put('/:id', protect, authorize('admin', 'hr', 'manager'), async (req, res) => {
  try {
    const { status, rejectionReason } = req.body;
    if (!['Approved', 'Rejected', 'Cancelled'].includes(status)) {
      return res.status(400).json({ message: 'Status must be Approved, Rejected or Cancelled' });
    }
    const leave = await Leave.findById(req.params.id);
    if (!leave) return res.status(404).json({ message: 'Leave not found' });
    if (leave.status !== 'Pending') {
      return res.status(400).json({ message: `Leave already ${leave.status.toLowerCase()}` });
    }

    leave.status = status;
    if (status === 'Approved') {
      leave.approvedBy = req.user._id;
      leave.approvedAt = new Date();
      // Deduct from leave balance
      const emp = await Employee.findById(leave.employee);
      if (emp) {
        const typeKey = leave.leaveType.toLowerCase();
        if (emp.leaveBalance[typeKey] !== undefined) {
          emp.leaveBalance[typeKey] = Math.max(0, emp.leaveBalance[typeKey] - leave.days);
          await emp.save();
        }
      }
    } else if (status === 'Rejected') {
      leave.rejectionReason = rejectionReason || '';
    }
    await leave.save();

    // Tell the requester the outcome
    const leaveUser = await User.findOne({ employee: leave.employee, active: true }).select('_id');
    if (leaveUser) {
      await notify({
        userIds: [leaveUser._id],
        title: `Leave ${status.toLowerCase()}`,
        body: status === 'Approved'
          ? `Your ${leave.leaveType} leave (${leave.days} day${leave.days > 1 ? 's' : ''} from ${leave.startDate.toISOString().slice(0, 10)}) was approved by ${req.user.name}.`
          : `Your ${leave.leaveType} leave request was rejected${leave.rejectionReason ? `: ${leave.rejectionReason}` : ''}.`,
        link: '/leaves',
        email: true
      });
    }

    res.json(leave);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.delete('/:id', protect, authorize('admin', 'hr'), async (req, res) => {
  try {
    await Leave.findByIdAndDelete(req.params.id);
    res.json({ message: 'Leave deleted' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
