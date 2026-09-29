import React, { useEffect, useState, useCallback } from 'react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';

const pad = (n) => String(n).padStart(2, '0');
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
// ISO instant -> "HH:MM" in the viewer's local time (for time inputs)
const toLocalTime = (iso) => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const STATUS_OPTIONS = ['Present', 'Late', 'Remote', 'Half-day', 'Absent'];

const Attendance = () => {
  const { user } = useAuth();
  const isAdminish = ['admin', 'hr', 'manager'].includes(user?.role);
  const [records, setRecords] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [showCheckIn, setShowCheckIn] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ employee: '', status: 'Present', notes: '' });
  const [manual, setManual] = useState({ employee: '', date: todayStr(), checkInTime: '08:00', checkOutTime: '16:00', status: 'Present', notes: '' });
  const [editForm, setEditForm] = useState({ date: '', checkInTime: '', checkOutTime: '', status: '' });
  const [dateFilter, setDateFilter] = useState('');
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    const params = {};
    if (dateFilter) params.date = dateFilter;
    const { data } = await api.get('/attendance', { params });
    setRecords(data);
  }, [dateFilter]);

  useEffect(() => {
    if (isAdminish) {
      api.get('/employees').then(r => setEmployees(r.data));
    }
  }, [isAdminish]);

  useEffect(() => { load(); }, [load]);

  const flash = (text, ok = true) => {
    setMsg({ text, ok });
    setTimeout(() => setMsg(null), 3500);
  };

  const handleCheckIn = async (e) => {
    e.preventDefault();
    try {
      await api.post('/attendance', form);
      setShowCheckIn(false);
      setForm({ employee: '', status: 'Present', notes: '' });
      flash('Checked in');
      load();
    } catch (err) {
      alert(err.response?.data?.message || 'Error');
    }
  };

  const handleCheckOut = async (id) => {
    try {
      await api.put(`/attendance/${id}`, { checkOut: new Date().toISOString() });
      flash('Checked out');
      load();
    } catch (err) {
      alert(err.response?.data?.message || 'Error');
    }
  };

  const handleBulk = async (kind) => {
    const label = kind === 'checkin' ? 'check in' : 'check out';
    if (!window.confirm(`Are you sure you want to ${label} everyone for today?`)) return;
    try {
      const { data } = await api.post(`/attendance/${kind}-all`, {});
      flash(data.message);
      load();
    } catch (err) {
      alert(err.response?.data?.message || 'Error');
    }
  };

  const handleManual = async (e) => {
    e.preventDefault();
    try {
      await api.post('/attendance/manual', {
        employee: manual.employee,
        date: manual.date,
        checkInTime: manual.checkInTime,
        checkOutTime: manual.checkOutTime || undefined,
        status: manual.status,
        notes: manual.notes || undefined,
        tzOffset: new Date().getTimezoneOffset()
      });
      setShowManual(false);
      setManual({ employee: '', date: todayStr(), checkInTime: '08:00', checkOutTime: '16:00', status: 'Present', notes: '' });
      flash('Record added');
      load();
    } catch (err) {
      alert(err.response?.data?.message || 'Error');
    }
  };

  const openEdit = (r) => {
    setEditId(r._id);
    setEditForm({
      date: r.date ? r.date.slice(0, 10) : '',
      checkInTime: r.checkIn ? toLocalTime(r.checkIn) : '',
      checkOutTime: r.checkOut ? toLocalTime(r.checkOut) : '',
      status: r.status
    });
  };

  const handleEdit = async (e) => {
    e.preventDefault();
    try {
      const payload = { tzOffset: new Date().getTimezoneOffset() };
      if (editForm.date) payload.date = editForm.date;
      if (editForm.checkInTime) payload.checkInTime = editForm.checkInTime;
      if (editForm.checkOutTime) payload.checkOutTime = editForm.checkOutTime;
      if (editForm.status) payload.status = editForm.status;
      await api.put(`/attendance/${editId}`, payload);
      setEditId(null);
      flash('Record updated');
      load();
    } catch (err) {
      alert(err.response?.data?.message || 'Error');
    }
  };

  const statusBadge = (status) => {
    const map = { Present: 'badge-green', Late: 'badge-amber', Absent: 'badge-red', Remote: 'badge-blue', 'Half-day': 'badge-amber' };
    return map[status] || 'badge-gray';
  };

  return (
    <div>
      <div className="card-header">
        <h2>Attendance Records</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input type="date" value={dateFilter} onChange={e => setDateFilter(e.target.value)}
            style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid #cbd5e1' }} />
          {isAdminish && (
            <>
              <button className="btn btn-secondary" onClick={() => handleBulk('checkin')}>✅ Check In Everyone</button>
              <button className="btn btn-secondary" onClick={() => handleBulk('checkout')}>🏁 Check Out Everyone</button>
              <button className="btn btn-secondary" onClick={() => setShowManual(true)}>➕ Manual Entry</button>
              <button className="btn btn-primary" onClick={() => setShowCheckIn(true)}>+ Check In</button>
            </>
          )}
        </div>
      </div>

      {msg && <div className={`flash ${msg.ok ? 'flash-ok' : 'flash-err'}`}>{msg.text}</div>}

      <div className="card">
        {records.length === 0 ? (
          <div className="empty">No attendance records</div>
        ) : (
          <div className="table-wrap">
            <table>
            <thead>
              <tr>
                <th>Employee</th><th>Date</th><th>Check In</th><th>Check Out</th>
                <th>Hours</th><th>Status</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {records.map(r => (
                <tr key={r._id}>
                  <td data-label="Employee"><strong>{r.employee?.firstName} {r.employee?.lastName}</strong></td>
                  <td data-label="Date">{new Date(r.date).toLocaleDateString()}</td>
                  <td data-label="Check In">{r.checkIn ? new Date(r.checkIn).toLocaleTimeString() : '—'}</td>
                  <td data-label="Check Out">{r.checkOut ? new Date(r.checkOut).toLocaleTimeString() : '—'}</td>
                  <td data-label="Hours">{r.hoursWorked || 0}</td>
                  <td data-label="Status"><span className={`badge ${statusBadge(r.status)}`}>{r.status}</span></td>
                  <td data-label="Actions">
                    {!r.checkOut && r.checkIn && (
                      <button className="btn btn-secondary btn-sm" onClick={() => handleCheckOut(r._id)}>Check Out</button>
                    )}
                    {isAdminish && (
                      <button className="btn btn-secondary btn-sm" style={{ marginLeft: 6 }} onClick={() => openEdit(r)}>Edit</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            </table>
          </div>
        )}
      </div>

      {showCheckIn && (
        <Modal title="Check In (now)" onClose={() => setShowCheckIn(false)}>
          <form onSubmit={handleCheckIn}>
            <div className="form-group">
              <label>Employee</label>
              <select value={form.employee} onChange={e => setForm({ ...form, employee: e.target.value })} required>
                <option value="">Select...</option>
                {employees.map(e => <option key={e._id} value={e._id}>{e.firstName} {e.lastName}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Status</label>
              <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
                {STATUS_OPTIONS.slice(0, 4).map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Notes</label>
              <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows="2" />
            </div>
            <ModalActions onClose={() => setShowCheckIn(false)} submitLabel="Check In" />
          </form>
        </Modal>
      )}

      {showManual && (
        <Modal title="Manual Attendance Entry" onClose={() => setShowManual(false)}>
          <form onSubmit={handleManual}>
            <div className="form-group">
              <label>Employee</label>
              <select value={manual.employee} onChange={e => setManual({ ...manual, employee: e.target.value })} required>
                <option value="">Select...</option>
                {employees.map(e => <option key={e._id} value={e._id}>{e.firstName} {e.lastName}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Date</label>
              <input type="date" value={manual.date} onChange={e => setManual({ ...manual, date: e.target.value })} required />
            </div>
            <div className="form-group">
              <label>Check-in time</label>
              <input type="time" value={manual.checkInTime} onChange={e => setManual({ ...manual, checkInTime: e.target.value })} required />
            </div>
            <div className="form-group">
              <label>Check-out time (optional)</label>
              <input type="time" value={manual.checkOutTime} onChange={e => setManual({ ...manual, checkOutTime: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Status</label>
              <select value={manual.status} onChange={e => setManual({ ...manual, status: e.target.value })}>
                {STATUS_OPTIONS.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Notes</label>
              <textarea value={manual.notes} onChange={e => setManual({ ...manual, notes: e.target.value })} rows="2" />
            </div>
            <ModalActions onClose={() => setShowManual(false)} submitLabel="Add Record" />
          </form>
        </Modal>
      )}

      {editId && (
        <Modal title="Edit Attendance Record" onClose={() => setEditId(null)}>
          <form onSubmit={handleEdit}>
            <div className="form-group">
              <label>Date</label>
              <input type="date" value={editForm.date} onChange={e => setEditForm({ ...editForm, date: e.target.value })} required />
            </div>
            <div className="form-group">
              <label>Check-in time</label>
              <input type="time" value={editForm.checkInTime} onChange={e => setEditForm({ ...editForm, checkInTime: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Check-out time</label>
              <input type="time" value={editForm.checkOutTime} onChange={e => setEditForm({ ...editForm, checkOutTime: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Status</label>
              <select value={editForm.status} onChange={e => setEditForm({ ...editForm, status: e.target.value })}>
                {STATUS_OPTIONS.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <ModalActions onClose={() => setEditId(null)} submitLabel="Save Changes" />
          </form>
        </Modal>
      )}
    </div>
  );
};

function Modal({ title, onClose, children }) {
  return (
    <div className="modal-overlay" onClick={(e) => e.target.className === 'modal-overlay' && onClose()}>
      <div className="modal">
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}

function ModalActions({ onClose, submitLabel }) {
  return (
    <div className="modal-actions">
      <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
      <button type="submit" className="btn btn-primary">{submitLabel}</button>
    </div>
  );
}

export default Attendance;
