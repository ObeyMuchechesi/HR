import React from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const Sidebar = ({ open, onClose }) => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isReports = ['admin', 'hr', 'manager'].includes(user?.role);
  const links = [
    { to: '/', label: 'Dashboard', icon: '📊' },
    { to: '/employees', label: 'Employees', icon: '👥' },
    { to: '/departments', label: 'Departments', icon: '🏢' },
    { to: '/leaves', label: 'Leave Requests', icon: '🌴' },
    { to: '/attendance', label: 'Attendance', icon: '🕐' },
    { to: '/payroll', label: 'Payroll', icon: '💰' },
    ...(isReports ? [{ to: '/reports', label: 'Reports', icon: '📈' }] : []),
    ...(isAdmin ? [{ to: '/users', label: 'Users & Roles', icon: '🔑' }] : [])
  ];

  return (
    <aside className={`sidebar ${open ? 'open' : ''}`}>
      <div className="brand">🏢 HR System</div>
      <nav>
        {links.map((link) => (
          <NavLink key={link.to} to={link.to} end={link.to === '/'}>
            <span>{link.icon}</span>
            <span>{link.label}</span>
          </NavLink>
        ))}
      </nav>
      <div style={{ padding: '16px 24px', fontSize: 12, color: '#64748b', borderTop: '1px solid #1e293b' }}>
        Signed in as <strong style={{ color: '#cbd5e1' }}>{user?.name}</strong>
        <div style={{ textTransform: 'capitalize', marginTop: 4 }}>{user?.role}</div>
      </div>
    </aside>
  );
};

export default Sidebar;
