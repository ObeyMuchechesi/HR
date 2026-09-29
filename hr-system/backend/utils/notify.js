const Notification = require('../models/Notification');
const User = require('../models/User');

// Optional email via nodemailer - activated only when SMTP_HOST is set
// (e.g. Gmail app password, Zoho, Outlook). In-app notifications work
// with zero configuration.
let transporter = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
  const nodemailer = require('nodemailer');
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: String(process.env.SMTP_SECURE) === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

async function email(to, subject, text) {
  if (!transporter || !to) return;
  try {
    await transporter.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject, text });
  } catch (e) {
    console.error('email send failed:', e.message);
  }
}

/**
 * Create in-app notifications for every user matching the roles,
 * and optionally email them. Never throws.
 * notify({ roles:['admin','hr'], title, body, link, email:true })
 */
async function notify({ roles = [], userIds = [], title, body = '', link = '', email: wantEmail = false }) {
  try {
    // roles and userIds are OR-ed: everyone matching either gets notified
    const queries = [];
    if (roles.length) queries.push(User.find({ active: true, role: { $in: roles } }).select('name email'));
    if (userIds.length) queries.push(User.find({ active: true, _id: { $in: userIds } }).select('name email'));
    const results = await Promise.all(queries);
    const seen = new Set();
    const users = [];
    results.flat().forEach(u => {
      const k = u._id.toString();
      if (!seen.has(k)) { seen.add(k); users.push(u); }
    });
    if (users.length === 0) return;

    await Notification.insertMany(users.map(u => ({
      user: u._id, title, body, link
    })));

    if (wantEmail) {
      await Promise.all(users.filter(u => u.email).map(u => email(u.email, title, `${body}\n\n${process.env.APP_URL || ''}${link}`)));
    }
  } catch (e) {
    console.error('notify failed:', e.message);
  }
}

module.exports = { notify, email };
