import React, { useEffect, useState } from 'react';
import api from '../api/axios';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

const Dashboard = () => {
  const [stats, setStats] = useState({ total: 0, active: 0, onLeave: 0, byDepartment: [] });
  const [attendance, setAttendance] = useState({ present: 0, absent: 0, late: 0, remote: 0 });
  const [pendingLeaves, setPendingLeaves] = useState([]);

  useEffect(() => {
    api.get('/employees/stats/dashboard').then(r => setStats(r.data)).catch(() => {});
    api.get('/attendance/summary/today').then(r => setAttendance(r.data)).catch(() => {});
    api.get('/leaves?status=Pending').then(r => setPendingLeaves(r.data)).catch(() => {});
  }, []);

  return (
    <div>
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

      <div className="card" style={{ marginTop: 24 }}>
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
    </div>
  );
};

export default Dashboard;
