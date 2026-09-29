import React, { useCallback, useEffect, useState } from 'react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';

const monthOptions = () => {
  const out = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    out.push({ value, label });
  }
  return out;
};

const Reports = () => {
  const { user } = useAuth();
  const canView = ['admin', 'hr', 'manager'].includes(user?.role);
  const [month, setMonth] = useState(monthOptions()[0].value);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const r = await api.get('/attendance/report', { params: { month } });
      setData(r.data);
    } catch (e) {
      setErr(e.response?.data?.message || 'Failed to load report');
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => { if (canView) load(); }, [load, canView]);

  const exportCsv = () => {
    if (!data?.report?.length) return;
    const header = ['Employee ID', 'Name', 'Present', 'Late', 'Remote', 'Half-day', 'Absent', 'Total Hours'];
    const lines = data.report.map(r =>
      [r.employeeId, r.name, r.present, r.late, r.remote, r.halfDay, r.absent, r.totalHours].join(',')
    );
    const csv = [header.join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `attendance-report-${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!canView) return <div className="card"><div className="empty">Only admins, HR and managers can view reports.</div></div>;

  return (
    <div>
      <div className="card-header">
        <h2>Attendance Reports</h2>
        <div style={{ display: 'flex', gap: 12 }}>
          <select value={month} onChange={e => setMonth(e.target.value)}
            style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid #cbd5e1' }}>
            {monthOptions().map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          <button className="btn btn-primary" onClick={exportCsv} disabled={!data?.report?.length}>⬇ Export CSV</button>
        </div>
      </div>

      <div className="card">
        {loading ? (
          <div className="empty">Loading report…</div>
        ) : err ? (
          <div className="empty">{err}</div>
        ) : !data?.report?.length ? (
          <div className="empty">No data for this month</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Employee ID</th><th>Name</th><th>Present</th><th>Late</th>
                <th>Remote</th><th>Half-day</th><th>Absent</th><th>Total Hours</th>
              </tr>
            </thead>
            <tbody>
              {data.report.map(r => (
                <tr key={r.employeeId}>
                  <td>{r.employeeId}</td>
                  <td><strong>{r.name}</strong></td>
                  <td style={{ color: '#10b981' }}>{r.present}</td>
                  <td style={{ color: '#f59e0b' }}>{r.late}</td>
                  <td style={{ color: '#3b82f6' }}>{r.remote}</td>
                  <td>{r.halfDay}</td>
                  <td style={{ color: '#ef4444' }}>{r.absent}</td>
                  <td><strong>{r.totalHours}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default Reports;
