import React, { useEffect, useState } from 'react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';

const Leaves = () => {
  const { user } = useAuth();
  const [leaves, setLeaves] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [filter, setFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({
    employee: '', leaveType: 'Annual', startDate: '', endDate: '', reason: ''
  });
  const canApprove = ['admin', 'hr', 'manager'].includes(user?.role);

  const load = async () => {
    const { data } = await api.get('/leaves', { params: filter ? { status: filter } : {} });
    setLeaves(data);
  };

  useEffect(() => {
    api.get('/employees').then(r => setEmployees(r.data));
  }, []);

  useEffect(() => { load(); }, [filter]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await api.post('/leaves', form);
      setShowModal(false);
      setForm({ employee: '', leaveType: 'Annual', startDate: '', endDate: '', reason: '' });
      load();
    } catch (err) {
      alert(err.response?.data?.message || 'Error');
    }
  };

  const handleApprove = async (id, status) => {
    const rejectionReason = status === 'Rejected' ? prompt('Reason for rejection:') : undefined;
    await api.put(`/leaves/${id}`, { status, rejectionReason });
    load();
  };

  const badgeClass = (status) => {
    if (status === 'Approved') return 'badge-green';
    if (status === 'Rejected') return 'badge-red';
    if (status === 'Pending') return 'badge-amber';
    return 'badge-gray';
  };

  return (
    <div>
      <div className="card-header">
        <h2>Leave Requests ({leaves.length})</h2>
        <div style={{ display: 'flex', gap: 12 }}>
          <select value={filter} onChange={e => setFilter(e.target.value)}
            style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid #cbd5e1' }}>
            <option value="">All Statuses</option>
            <option>Pending</option><option>Approved</option><option>Rejected</option>
          </select>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ Request Leave</button>
        </div>
      </div>

      <div className="card">
        {leaves.length === 0 ? (
          <div className="empty">No leave requests</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Employee</th><th>Type</th><th>From</th><th>To</th>
                <th>Days</th><th>Reason</th><th>Status</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {leaves.map(l => (
                <tr key={l._id}>
                  <td><strong>{l.employee?.firstName} {l.employee?.lastName}</strong></td>
                  <td><span className="badge badge-blue">{l.leaveType}</span></td>
                  <td>{new Date(l.startDate).toLocaleDateString()}</td>
                  <td>{new Date(l.endDate).toLocaleDateString()}</td>
                  <td>{l.days}</td>
                  <td style={{ maxWidth: 200 }}>{l.reason}</td>
                  <td><span className={`badge ${badgeClass(l.status)}`}>{l.status}</span></td>
                  <td>
                    <div className="actions">
                      {canApprove && l.status === 'Pending' && (
                        <>
                          <button className="btn btn-success btn-sm" onClick={() => handleApprove(l._id, 'Approved')}>Approve</button>
                          <button className="btn btn-danger btn-sm" onClick={() => handleApprove(l._id, 'Rejected')}>Reject</button>
                        </>
                      )}
                    </div>
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
            <h3>Request Leave</h3>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Employee</label>
                <select value={form.employee} onChange={e => setForm({ ...form, employee: e.target.value })} required>
                  <option value="">Select...</option>
                  {employees.map(e => <option key={e._id} value={e._id}>{e.firstName} {e.lastName}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Leave Type</label>
                <select value={form.leaveType} onChange={e => setForm({ ...form, leaveType: e.target.value })}>
                  <option>Annual</option><option>Sick</option><option>Personal</option>
                  <option>Maternity</option><option>Paternity</option><option>Unpaid</option>
                </select>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Start Date</label>
                  <input type="date" value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} required />
                </div>
                <div className="form-group">
                  <label>End Date</label>
                  <input type="date" value={form.endDate} onChange={e => setForm({ ...form, endDate: e.target.value })} required />
                </div>
              </div>
              <div className="form-group">
                <label>Reason</label>
                <textarea value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} rows="3" required />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Submit</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Leaves;
