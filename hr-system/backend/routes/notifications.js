const express = require('express');
const Notification = require('../models/Notification');
const { protect } = require('../middleware/auth');
const router = express.Router();

// GET own notifications (newest first, capped)
router.get('/', protect, async (req, res) => {
  try {
    const items = await Notification.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(30);
    res.json(items);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET unread count (for the bell badge)
router.get('/unread-count', protect, async (req, res) => {
  try {
    const count = await Notification.countDocuments({ user: req.user._id, read: false });
    res.json({ count });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// PATCH mark one read
router.patch('/:id/read', protect, async (req, res) => {
  try {
    await Notification.updateOne({ _id: req.params.id, user: req.user._id }, { read: true });
    res.json({ message: 'Marked read' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// PATCH mark all read
router.patch('/read-all', protect, async (req, res) => {
  try {
    await Notification.updateMany({ user: req.user._id, read: false }, { read: true });
    res.json({ message: 'All marked read' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
