import React from 'react';
import { useAuth } from '../context/AuthContext';
import NotificationBell from './NotificationBell';

const Navbar = ({ onMenu }) => {
  const { user, logout } = useAuth();
  return (
    <header className="navbar">
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
        <button className="menu-btn" onClick={onMenu} aria-label="Open menu">☰</button>
        <h1>Welcome back, {user?.name}</h1>
      </div>
      <div className="user-info">
        <NotificationBell />
        <span className="badge badge-blue">{user?.role}</span>
        <button className="btn btn-secondary btn-sm" onClick={logout}>Logout</button>
      </div>
    </header>
  );
};

export default Navbar;
