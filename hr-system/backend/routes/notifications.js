const express = require('express');
const Notification = require('../models/Notification');
const User = require('../models/User');
const jwt = require('jsonwebtoken');
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

// PATCH mark all read (declared before /:id/read)
router.patch('/read-all', protect, async (req, res) => {
  try {
    await Notification.updateMany({ user: req.user._id, read: false }, { read: true });
    res.json({ message: 'All marked read' });
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

/**
 * GET /api/notifications/stream?token=<JWT>
 *
 * Real-time push over Server-Sent Events. Vercel serverless functions
 * cannot hold a cross-instance pub/sub hub (and Atlas free tier lacks
 * change streams), so the stream itself polls the unread count every 3s
 * and pushes only on change. The function ends after ~45s and the
 * browser's EventSource reconnects automatically, so it feels like a
 * permanent socket from the UI's point of view.
 *
 * EventSource cannot send an Authorization header, so the JWT arrives
 * as a query parameter - same verification as the header path.
 */
router.get('/stream', async (req, res) => {
  try {
    const token = (req.query.token || '').replace(/^Bearer\s+/i, '');
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ message: 'Not authorized' });
    }
    const user = await User.findById(decoded.id).select('_id active');
    if (!user || !user.active) return res.status(401).json({ message: 'Not authorized' });

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write(`event: hello\ndata: {"connected":true}\n\n`);

    const started = Date.now();
    let lastUnread = null;
    let lastSeen = null;

    const tick = async () => {
      const [unread, latest] = await Promise.all([
        Notification.countDocuments({ user: user._id, read: false }),
        Notification.findOne({ user: user._id }).sort({ createdAt: -1 }).select('title body link createdAt').lean()
      ]);
      const latestKey = latest ? String(latest.createdAt) : null;
      if (unread !== lastUnread || latestKey !== lastSeen) {
        lastUnread = unread;
        lastSeen = latestKey;
        res.write(`event: notifications\ndata: ${JSON.stringify({ unread, latest })}\n\n`);
      } else {
        res.write(`: keep-alive\n\n`);
      }
    };

    await tick();
    while (Date.now() - started < 45000) {
      await new Promise(r => setTimeout(r, 3000));
      if (res.writableEnded) return;
      try {
        await tick();
      } catch {
        return res.end();
      }
    }
    res.write(`event: reconnect\ndata: {}\n\n`);
    res.end();
  } catch {
    try { res.end(); } catch { /* already closed */ }
  }
});

module.exports = router;
