import React, { useEffect, useState } from 'react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';

const pad = (n) => String(n).padStart(2, '0');
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

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
  const [payId, setPayId] = useState(null);        // record being marked paid
  const [paidOn, setPaidOn] = useState(todayStr()); // payment date for the modal
  const [wd, setWd] = useState(null);
  const [wdYear, setWdYear] = useState(new Date().getFullYear());
  const [wdMonth, setWdMonth] = useState(new Date().getMonth() + 1);

  const load = async () => {
    const { data } = await api.get('/payroll');
    setRecords(data);
  };

  useEffect(() => {
    api.get('/employees').then(r => setEmployees(r.data));
    load();
  }, []);

  // Working days for the selected month (weekdays minus ZW public holidays)
  useEffect(() => {
    let alive = true;
    api.get(`/holidays/working-days?year=${wdYear}&month=${wdMonth}`)
      .then(r => { if (alive) setWd(r.data); })
      .catch(() => {});
    return () => { alive = false; };
  }, [wdYear, wdMonth]);

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

  // Open the paid-date modal; defaults to today but any date can be recorded
  const askPaidDate = (id) => {
    setPaidOn(todayStr());
    setPayId(id);
  };

  const confirmMarkPaid = async (e) => {
    e.preventDefault();
    try {
      await api.put(`/payroll/${payId}/pay`, { paidOn });
      setPayId(null);
      load();
    } catch (err) {
      alert(err.response?.data?.message || 'Error');
    }
  };

  const monthName = (m) => new Date(2000, m - 1).toLocaleString('en', { month: 'long' });

  return (
    <div>
      <div className="card-header">
        <h2>Payroll Records ({records.length})</h2>
        {canEdit && <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ Generate Payroll</button>}
      </div>

      {canEdit && wd && (
        <div className="card" style={{ marginBottom: 16, background: '#f8fafc' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
            <strong>Working days</strong>
            <select value={wdMonth} onChange={e => setWdMonth(Number(e.target.value))}>
              {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{monthName(i + 1)}</option>)}
            </select>
            <input type="number" value={wdYear} onChange={e => setWdYear(Number(e.target.value))} style={{ width: 90 }} />
            <span className="badge badge-green" style={{ padding: '6px 12px' }}>{wd.workingDays} working days</span>
            <span style={{ color: '#64748b', fontSize: 13 }}>{wd.weekdays} weekdays − {wd.publicHolidays} ZW public holidays</span>
          </div>
          {wd.holidays.length > 0 && (
            <div style={{ marginTop: 10, fontSize: 13, color: '#475569' }}>
              {wd.holidays.map(h => (
                <div key={h.date}>• {h.date} — {h.name}</div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="card">
        {records.length === 0 ? (
          <div className="empty">No payroll records</div>
        ) : (
          <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Employee</th><th>Period</th><th>Basic</th>
                <th>Allowances</th><th>Deductions</th><th>Net Pay</th><th>Status</th><th>Paid On</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {records.map(r => {
                const allow = Object.values(r.allowances || {}).reduce((a, b) => a + b, 0);
                const ded = Object.values(r.deductions || {}).reduce((a, b) => a + b, 0);
                return (
                  <tr key={r._id}>
                    <td data-label="Employee"><strong>{r.employee?.firstName} {r.employee?.lastName}</strong></td>
                    <td data-label="Month">{monthName(r.month)} {r.year}</td>
                    <td data-label="Basic">${r.basicSalary.toLocaleString()}</td>
                    <td data-label="Allowances" style={{ color: '#10b981' }}>+${allow.toLocaleString()}</td>
                    <td data-label="Deductions" style={{ color: '#ef4444' }}>-${ded.toLocaleString()}</td>
                    <td data-label="Net Pay"><strong>${r.netPay.toLocaleString()}</strong></td>
                    <td data-label="Status"><span className={`badge ${r.status === 'Paid' ? 'badge-green' : 'badge-amber'}`}>{r.status}</span></td>
                    <td data-label="Paid On">{r.paidAt ? new Date(r.paidAt).toLocaleDateString() : '—'}</td>
                    <td data-label="Actions">
                      {canEdit && r.status === 'Pending' && (
                        <button className="btn btn-success btn-sm" onClick={() => askPaidDate(r._id)}>Mark Paid</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {payId && (
        <div className="modal-overlay" onClick={(e) => e.target.className === 'modal-overlay' && setPayId(null)}>
          <div className="modal">
            <h3>Mark Payroll as Paid</h3>
            <form onSubmit={confirmMarkPaid}>
              <div className="form-group">
                <label>Payment date</label>
                <input type="date" value={paidOn} onChange={e => setPaidOn(e.target.value)} required />
              </div>
              <p style={{ margin: 0, color: '#64748b', fontSize: 13 }}>
                Defaults to today — change it if the money actually went out on a different day.
              </p>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setPayId(null)}>Cancel</button>
                <button type="submit" className="btn btn-success">Mark Paid</button>
              </div>
            </form>
          </div>
        </div>
      )}

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
