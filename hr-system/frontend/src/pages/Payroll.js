import React, { useEffect, useState } from 'react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';

const Payroll = () => {
  const { user } = useAuth();
  const [records, setRecords] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({
    employee: '', month: new Date().getMonth() + 1, year: new Date().getFullYear(),
    basicSalary: 0,
    allowances: { housing: 0, transport: 0, medical: 0, other: 0 },
    deductions: { tax: 0, pension: 0, insurance: 0, other: 0 }
  });
  const canEdit = ['admin', 'hr'].includes(user?.role);

  const load = async () => {
    const { data } = await api.get('/payroll');
    setRecords(data);
  };

  useEffect(() => {
    api.get('/employees').then(r => setEmployees(r.data));
    load();
  }, []);

  const calcNet = () => {
    const a = Object.values(form.allowances).reduce((x, y) => x + Number(y || 0), 0);
    const d = Object.values(form.deductions).reduce((x, y) => x + Number(y || 0), 0);
    return Number(form.basicSalary) + a - d;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await api.post('/payroll', form);
      setShowModal(false);
      load();
    } catch (err) {
      alert(err.response?.data?.message || 'Error');
    }
  };

  const markPaid = async (id) => {
    await api.put(`/payroll/${id}/pay`);
    load();
  };

  const monthName = (m) => new Date(2000, m - 1).toLocaleString('en', { month: 'long' });

  return (
    <div>
      <div className="card-header">
        <h2>Payroll Records ({records.length})</h2>
        {canEdit && <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ Generate Payroll</button>}
      </div>

      <div className="card">
        {records.length === 0 ? (
          <div className="empty">No payroll records</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Employee</th><th>Period</th><th>Basic</th>
                <th>Allowances</th><th>Deductions</th><th>Net Pay</th><th>Status</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {records.map(r => {
                const allow = Object.values(r.allowances || {}).reduce((a, b) => a + b, 0);
                const ded = Object.values(r.deductions || {}).reduce((a, b) => a + b, 0);
                return (
                  <tr key={r._id}>
                    <td><strong>{r.employee?.firstName} {r.employee?.lastName}</strong></td>
                    <td>{monthName(r.month)} {r.year}</td>
                    <td>${r.basicSalary.toLocaleString()}</td>
                    <td style={{ color: '#10b981' }}>+${allow.toLocaleString()}</td>
                    <td style={{ color: '#ef4444' }}>-${ded.toLocaleString()}</td>
                    <td><strong>${r.netPay.toLocaleString()}</strong></td>
                    <td><span className={`badge ${r.status === 'Paid' ? 'badge-green' : 'badge-amber'}`}>{r.status}</span></td>
                    <td>
                      {canEdit && r.status === 'Pending' && (
                        <button className="btn btn-success btn-sm" onClick={() => markPaid(r._id)}>Mark Paid</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={(e) => e.target.className === 'modal-overlay' && setShowModal(false)}>
          <div className="modal">
            <h3>Generate Payroll</h3>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Employee</label>
                <select value={form.employee} onChange={e => {
                  const emp = employees.find(x => x._id === e.target.value);
                  setForm({ ...form, employee: e.target.value, basicSalary: emp?.salary || 0 });
                }} required>
                  <option value="">Select...</option>
                  {employees.map(e => <option key={e._id} value={e._id}>{e.firstName} {e.lastName}</option>)}
                </select>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Month</label>
                  <select value={form.month} onChange={e => setForm({ ...form, month: Number(e.target.value) })}>
                    {Array.from({ length: 12 }, (_, i) => (
                      <option key={i + 1} value={i + 1}>{monthName(i + 1)}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Year</label>
                  <input type="number" value={form.year} onChange={e => setForm({ ...form, year: Number(e.target.value) })} />
                </div>
              </div>
              <div className="form-group">
                <label>Basic Salary</label>
                <input type="number" value={form.basicSalary} onChange={e => setForm({ ...form, basicSalary: Number(e.target.value) })} required />
              </div>
              <h4 style={{ marginTop: 16, marginBottom: 8 }}>Allowances</h4>
              <div className="form-row">
                {['housing', 'transport', 'medical', 'other'].map(k => (
                  <div className="form-group" key={k}>
                    <label style={{ textTransform: 'capitalize' }}>{k}</label>
                    <input type="number" value={form.allowances[k]}
                      onChange={e => setForm({ ...form, allowances: { ...form.allowances, [k]: Number(e.target.value) } })} />
                  </div>
                ))}
              </div>
              <h4 style={{ marginTop: 16, marginBottom: 8 }}>Deductions</h4>
              <div className="form-row">
                {['tax', 'pension', 'insurance', 'other'].map(k => (
                  <div className="form-group" key={k}>
                    <label style={{ textTransform: 'capitalize' }}>{k}</label>
                    <input type="number" value={form.deductions[k]}
                      onChange={e => setForm({ ...form, deductions: { ...form.deductions, [k]: Number(e.target.value) } })} />
                  </div>
                ))}
              </div>
              <div className="card" style={{ background: '#f8fafc', marginTop: 16, marginBottom: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <strong>Net Pay:</strong>
                  <strong style={{ color: '#10b981', fontSize: 20 }}>${calcNet().toLocaleString()}</strong>
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Generate</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Payroll;
