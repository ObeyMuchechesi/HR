import React, { useState } from 'react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';

const Profile = () => {
  const { user } = useAuth();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setMsg(null);
    setErr(null);
    if (form.newPassword !== form.confirm) {
      setErr('New passwords do not match');
      return;
    }
    if ((form.newPassword || '').length < 6) {
      setErr('New password must be at least 6 characters');
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.put('/auth/change-password', {
        currentPassword: form.currentPassword,
        newPassword: form.newPassword
      });
      // Rotate the stored token so the session continues with the new one
      const stored = JSON.parse(localStorage.getItem('hr_user') || 'null');
      if (stored) {
        localStorage.setItem('hr_user', JSON.stringify({ ...stored, token: data.token }));
      }
      setForm({ currentPassword: '', newPassword: '', confirm: '' });
      setMsg('Password updated successfully.');
    } catch (e2) {
      setErr(e2.response?.data?.message || 'Could not update password');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="card-header">
        <h2>My Profile</h2>
      </div>

      <div className="two-col">
        <div className="card">
          <h2>Account</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div><strong>Name:</strong> {user?.name}</div>
            <div><strong>Email:</strong> {user?.email}</div>
            <div>
              <strong>Role:</strong>{' '}
              <span className="badge badge-blue" style={{ textTransform: 'capitalize' }}>{user?.role}</span>
            </div>
          </div>
          <div style={{ marginTop: 16, fontSize: 13, color: '#64748b' }}>
            Changing your password keeps you signed in on this device. Other devices
            stay logged in until their token expires.
          </div>
        </div>

        <div className="card">
          <h2>Change Password</h2>
          {msg && <div className="badge badge-green" style={{ display: 'block', marginBottom: 16, padding: '10px 16px' }}>{msg}</div>}
          {err && <div className="badge badge-red" style={{ display: 'block', marginBottom: 16, padding: '10px 16px' }}>{err}</div>}
          <form onSubmit={submit}>
            <div className="form-group">
              <label>Current password</label>
              <input
                type="password"
                value={form.currentPassword}
                onChange={e => setForm({ ...form, currentPassword: e.target.value })}
                required
                autoComplete="current-password"
              />
            </div>
            <div className="form-group">
              <label>New password</label>
              <input
                type="password"
                value={form.newPassword}
                onChange={e => setForm({ ...form, newPassword: e.target.value })}
                required
                minLength={6}
                autoComplete="new-password"
              />
            </div>
            <div className="form-group">
              <label>Confirm new password</label>
              <input
                type="password"
                value={form.confirm}
                onChange={e => setForm({ ...form, confirm: e.target.value })}
                required
                minLength={6}
                autoComplete="new-password"
              />
            </div>
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? 'Updating…' : 'Update Password'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Profile;
