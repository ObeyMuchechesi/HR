const express = require('express');
const Payroll = require('../models/Payroll');
const { protect, authorize } = require('../middleware/auth');
const router = express.Router();

router.get('/', protect, async (req, res) => {
  try {
    const filter = {};
    if (req.query.employee) filter.employee = req.query.employee;
    if (req.query.month) filter.month = Number(req.query.month);
    if (req.query.year) filter.year = Number(req.query.year);

    // Employees can only see their own payroll
    if (req.user.role === 'employee') {
      if (!req.user.employee) return res.status(403).json({ message: 'No employee profile linked to your account' });
      filter.employee = req.user.employee;
    }

    const records = await Payroll.find(filter)
      .populate('employee', 'firstName lastName employeeId')
      .sort({ year: -1, month: -1 });
    res.json(records);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// POST generate payroll
router.post('/', protect, authorize('admin', 'hr'), async (req, res) => {
  try {
    const { employee, month, year, basicSalary, allowances, deductions } = req.body;
    const totalAllowances = Object.values(allowances || {}).reduce((a, b) => a + b, 0);
    const totalDeductions = Object.values(deductions || {}).reduce((a, b) => a + b, 0);
    const netPay = basicSalary + totalAllowances - totalDeductions;

    const payroll = await Payroll.create({
      employee, month, year, basicSalary, allowances, deductions, netPay
    });
    res.status(201).json(payroll);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// PUT mark as paid — body may include { paidOn: 'YYYY-MM-DD' } to record the
// actual payment date (defaults to today).
router.put('/:id/pay', protect, authorize('admin', 'hr'), async (req, res) => {
  try {
    let paidAt = new Date();
    if (req.body.paidOn) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(req.body.paidOn)) {
        return res.status(400).json({ message: 'Invalid paid date — expected YYYY-MM-DD' });
      }
      paidAt = new Date(`${req.body.paidOn}T00:00:00.000Z`);
    }
    const payroll = await Payroll.findByIdAndUpdate(
      req.params.id,
      { status: 'Paid', paidAt },
      { new: true }
    );
    if (!payroll) return res.status(404).json({ message: 'Payroll record not found' });
    res.json(payroll);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

module.exports = router;
