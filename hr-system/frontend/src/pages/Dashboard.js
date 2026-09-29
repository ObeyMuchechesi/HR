import React, { useEffect, useState } from 'react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

const POLL_MS = 30000;

const Dashboard = () => {
  const { user } = useAuth();
  const canAudit = ['admin', 'hr', 'manager'].includes(user?.role);
  const [stats, setStats] = useState({ total: 0, active: 0, onLeave: 0, byDepartment: [] });
  const [attendance, setAttendance] = useState({ present: 0, absent: 0, late: 0, remote: 0 });
  const [pendingLeaves, setPendingLeaves] = useState([]);
  const [audit, setAudit] = useState([]);
  const [updatedAt, setUpdatedAt] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [s, a, l] = await Promise.all([
          api.get('/employees/stats/dashboard'),
          api.get('/attendance/summary/today'),
          api.get('/leaves?status=Pending')
        ]);
        if (!alive) return;
        setStats(s.data);
        setAttendance(a.data);
        setPendingLeaves(l.data);
        setUpdatedAt(new Date());
      } catch { /* keep last good values */ }
    };
    load();
    const t = setInterval(load, POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, []);

  useEffect(() => {
    if (!canAudit) return;
    let alive = true;
    const load = () => api.get('/attendance/audit?limit=8')
      .then(r => { if (alive) setAudit(r.data); })
      .catch(() => {});
    load();
    const t = setInterval(load, POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, [canAudit]);

  const timeAgo = (iso) => {
    const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return new Date(iso).toLocaleDateString();
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>
        {updatedAt && <>Live · updated {updatedAt.toLocaleTimeString()}</>}
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="label">Total Employees</div>
          <div className="value">{stats.total}</div>
        </div>
        <div className="stat-card">
          <div className="label">Active</div>
          <div className="value" style={{ color: '#10b981' }}>{stats.active}</div>
        </div>
        <div className="stat-card">
          <div className="label">On Leave</div>
          <div className="value" style={{ color: '#f59e0b' }}>{stats.onLeave}</div>
        </div>
        <div className="stat-card">
          <div className="label">Pending Leave Requests</div>
          <div className="value" style={{ color: '#ef4444' }}>{pendingLeaves.length}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        <div className="card">
          <h2>Employees by Department</h2>
          {stats.byDepartment.length ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={stats.byDepartment}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="count" fill="#3b82f6" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="empty">No department data yet</div>}
        </div>

        <div className="card">
          <h2>Today's Attendance</h2>
          <div className="stats-grid" style={{ gridTemplateColumns: '1fr 1fr', marginBottom: 0 }}>
            <div className="stat-card">
              <div className="label">Present</div>
              <div className="value" style={{ color: '#10b981' }}>{attendance.present}</div>
            </div>
            <div className="stat-card">
              <div className="label">Late</div>
              <div className="value" style={{ color: '#f59e0b' }}>{attendance.late}</div>
            </div>
            <div className="stat-card">
              <div className="label">Remote</div>
              <div className="value" style={{ color: '#3b82f6' }}>{attendance.remote}</div>
            </div>
            <div className="stat-card">
              <div className="label">Absent</div>
              <div className="value" style={{ color: '#ef4444' }}>{attendance.absent}</div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: canAudit ? '1.4fr 1fr' : '1fr', gap: 24, marginTop: 24 }}>
        <div className="card">
          <h2>Pending Leave Requests</h2>
          {pendingLeaves.length === 0 ? (
            <div className="empty">No pending requests 🎉</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Type</th>
                  <th>From</th>
                  <th>To</th>
                  <th>Days</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {pendingLeaves.slice(0, 5).map(l => (
                  <tr key={l._id}>
                    <td>{l.employee?.firstName} {l.employee?.lastName}</td>
                    <td><span className="badge badge-blue">{l.leaveType}</span></td>
                    <td>{new Date(l.startDate).toLocaleDateString()}</td>
                    <td>{new Date(l.endDate).toLocaleDateString()}</td>
                    <td>{l.days}</td>
                    <td>{l.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {canAudit && (
          <div className="card">
            <h2>Recent Admin Activity</h2>
            {audit.length === 0 ? (
              <div className="empty">No admin activity yet</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {audit.map(a => (
                  <div key={a._id} style={{ borderBottom: '1px solid #f1f5f9', paddingBottom: 10 }}>
                    <div style={{ fontSize: 13 }}>
                      <strong>{a.actorName}</strong> · <span style={{ color: '#64748b' }}>{a.action.replace('attendance.', '')}</span> · {a.target}
                    </div>
                    <div style={{ fontSize: 12, color: '#94a3b8' }}>{a.details} · {timeAgo(a.createdAt)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;
