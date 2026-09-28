import React, { useEffect, useState } from 'react';
import api from '../api/axios';

const Attendance = () => {
  const [records, setRecords] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ employee: '', status: 'Present', notes: '' });
  const [dateFilter, setDateFilter] = useState('');

  const load = async () => {
    const params = {};
    if (dateFilter) params.date = dateFilter;
    const { data } = await api.get('/attendance', { params });
    setRecords(data);
  };

  useEffect(() => {
    api.get('/employees').then(r => setEmployees(r.data));
  }, []);

  useEffect(() => { load(); }, [dateFilter]);

  const handleCheckIn = async (e) => {
    e.preventDefault();
    try {
      await api.post('/attendance', form);
      setShowModal(false);
      setForm({ employee: '', status: 'Present', notes: '' });
      load();
    } catch (err) {
      alert(err.response?.data?.message || 'Error');
    }
  };

  const handleCheckOut = async (id) => {
    await api.put(`/attendance/${id}`, { checkOut: new Date() });
    load();
  };

  const statusBadge = (status) => {
    const map = { Present: 'badge-green', Late: 'badge-amber', Absent: 'badge-red', Remote: 'badge-blue', 'Half-day': 'badge-amber' };
    return map[status] || 'badge-gray';
  };

  return (
    <div>
      <div className="card-header">
        <h2>Attendance Records</h2>
        <div style={{ display: 'flex', gap: 12 }}>
          <input type="date" value={dateFilter} onChange={e => setDateFilter(e.target.value)}
            style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid #cbd5e1' }} />
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ Check In</button>
        </div>
      </div>

      <div className="card">
        {records.length === 0 ? (
          <div className="empty">No attendance records</div>
        ) : (
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
                  <td><strong>{r.employee?.firstName} {r.employee?.lastName}</strong></td>
                  <td>{new Date(r.date).toLocaleDateString()}</td>
                  <td>{r.checkIn ? new Date(r.checkIn).toLocaleTimeString() : '—'}</td>
                  <td>{r.checkOut ? new Date(r.checkOut).toLocaleTimeString() : '—'}</td>
                  <td>{r.hoursWorked || 0}</td>
                  <td><span className={`badge ${statusBadge(r.status)}`}>{r.status}</span></td>
                  <td>
                    {!r.checkOut && r.checkIn && (
                      <button className="btn btn-secondary btn-sm" onClick={() => handleCheckOut(r._id)}>Check Out</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={(e) => e.target.className === 'modal-overlay' && setShowModal(false)}>
          <div className="modal">
            <h3>Check In</h3>
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
                  <option>Present</option><option>Late</option><option>Remote</option><option>Half-day</option>
                </select>
              </div>
              <div className="form-group">
                <label>Notes</label>
                <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows="2" />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Check In</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Attendance;
