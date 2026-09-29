const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { protect, authorize } = require('../middleware/auth');
const router = express.Router();

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRE });
};

// POST /api/auth/register
// Public signup always creates an 'employee'. Privileged roles (admin/hr/manager)
// can only be granted via PUT /api/auth/role by an existing admin.
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const exists = await User.findOne({ email });
    if (exists) return res.status(400).json({ message: 'User already exists' });

    const user = await User.create({ name, email, password, role: 'employee' });
    res.status(201).json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      token: generateToken(user._id)
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email }).populate('employee');
    if (!user || !(await user.matchPassword(password))) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      employee: user.employee,
      token: generateToken(user._id)
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET /api/auth/me
router.get('/me', protect, async (req, res) => {
  res.json(req.user);
});

// GET /api/auth/users  (admin only): list all user accounts
router.get('/users', protect, authorize('admin'), async (req, res) => {
  try {
    const users = await User.find()
      .select('-password')
      .populate('employee', 'firstName lastName employeeId')
      .sort({ createdAt: -1 });
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// PUT /api/auth/role  (admin only): change a user's role
router.put('/role', protect, authorize('admin'), async (req, res) => {
  try {
    const { userId, role } = req.body;
    const allowed = ['admin', 'hr', 'manager', 'employee'];
    if (!userId || !allowed.includes(role)) {
      return res.status(400).json({ message: 'userId and a valid role are required' });
    }
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });
    user.role = role;
    await user.save();
    res.json({ _id: user._id, name: user.name, email: user.email, role: user.role });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// PUT /api/auth/change-password — self-service for ANY logged-in user.
// Requires the current password; rejects weak new passwords; issues a fresh
// token so the session continues seamlessly.
router.put('/change-password', protect, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current and new password are required' });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters' });
    }
    if (newPassword === currentPassword) {
      return res.status(400).json({ message: 'New password must be different from the current one' });
    }
    // req.user comes from the protect middleware; re-fetch to verify the password
    // against the stored hash (req.user.password is not the real hash).
    const user = await User.findById(req.user._id).select('+password');
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (!(await user.matchPassword(currentPassword))) {
      // 400 (not 401) on purpose: the client's interceptor logs out on 401,
      // and a wrong current password shouldn't end the session.
      return res.status(400).json({ message: 'Current password is incorrect' });
    }
    user.password = newPassword; // hashed by the User model's pre-save hook
    await user.save();
    res.json({
      message: 'Password updated successfully',
      token: generateToken(user._id)
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
