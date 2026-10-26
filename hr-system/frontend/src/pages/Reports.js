import React, { useCallback, useEffect, useState } from 'react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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

const cellText = (v) => {
  if (!v) return '';
  const parts = [];
  if (v.sick) parts.push(`${v.sick} sick`);
  if (v.personal) parts.push(`${v.personal} off`);
  if (v.annual) parts.push(`${v.annual} annual`);
  if (v.other) parts.push(`${v.other} other`);
  return parts.join(' · ');
};

const Reports = () => {
  const { user } = useAuth();
  const canView = ['admin', 'hr', 'manager'].includes(user?.role);
  const [month, setMonth] = useState(monthOptions()[0].value);
  const [data, setData] = useState(null);
  const [leaveData, setLeaveData] = useState(null);
  const [leaveErr, setLeaveErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const year = month.slice(0, 4);

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

  const loadLeave = useCallback(async () => {
    setLeaveErr('');
    try {
      const r = await api.get('/attendance/leave-summary', { params: { year } });
      setLeaveData(r.data);
    } catch (e) {
      setLeaveErr(e.response?.data?.message || 'Failed to load leave summary');
    }
  }, [year]);

  useEffect(() => { if (canView) load(); }, [load, canView]);
  useEffect(() => { if (canView) loadLeave(); }, [loadLeave, canView]);

  const exportCsv = () => {
    if (!data?.report?.length) return;
    const header = ['Employee ID', 'Name', 'Present', 'Late', 'Remote', 'Half-day', 'Absent', 'Holiday', 'Total Hours'];
    const lines = data.report.map(r =>
      [r.employeeId, r.name, r.present, r.late, r.remote, r.halfDay, r.absent, r.holiday ?? 0, r.totalHours].join(',')
    );
    const csv = [header.join(','), ...lines].join('\\n');
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
          <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Employee ID</th><th>Name</th><th>Present</th><th>Late</th>
                <th>Remote</th><th>Half-day</th><th>Absent</th><th>Holiday</th><th>Total Hours</th>
              </tr>
            </thead>
            <tbody>
              {data.report.map(r => (
                <tr key={r.employeeId}>
                  <td data-label="Employee ID">{r.employeeId}</td>
                  <td data-label="Name"><strong>{r.name}</strong></td>
                  <td data-label="Present" style={{ color: '#10b981' }}>{r.present}</td>
                  <td data-label="Late" style={{ color: '#f59e0b' }}>{r.late}</td>
                  <td data-label="Remote" style={{ color: '#3b82f6' }}>{r.remote}</td>
                  <td data-label="Half-day">{r.halfDay}</td>
                  <td data-label="Absent" style={{ color: '#ef4444' }}>{r.absent}</td>
                  <td data-label="Holiday">{r.holiday ?? 0}</td>
                  <td data-label="Total Hours"><strong>{r.totalHours}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <h3 style={{ marginTop: 0 }}>🌴 Leave days per month per person ({year})</h3>
        {leaveErr ? (
          <div className="empty">{leaveErr}</div>
        ) : !leaveData?.rows?.length ? (
          <div className="empty">No approved leave recorded for {year}</div>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Employee</th>
                    {MONTH_NAMES.map((m, i) => <th key={m} title={`${m} ${year}`}>{m}</th>)}
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {leaveData.rows.map(r => (
                    <tr key={r.employeeId}>
                      <td data-label="Employee"><strong>{r.name}</strong></td>
                      {MONTH_NAMES.map((m, i) => {
                        const key = `${year}-${String(i + 1).padStart(2, '0')}`;
                        const v = r.byMonth?.[key];
                        return <td key={m} data-label={m}
                          title="sick / off day (personal) / annual / other">{cellText(v) || '—'}</td>;
                      })}
                      <td data-label="Total"><strong>{cellText(r.total)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ color: '#64748b', fontSize: 13, margin: '10px 0 0' }}>
              Approved leave only. Off days = personal days; “other” covers maternity/paternity/unpaid leave.
            </p>
          </>
        )}
      </div>
    </div>
  );
};

export default Reports;
