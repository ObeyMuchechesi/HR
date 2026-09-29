import React from 'react';
import { useAuth } from '../context/AuthContext';
import NotificationBell from './NotificationBell';

const Navbar = () => {
  const { user, logout } = useAuth();
  return (
    <header className="navbar">
      <h1>Welcome back, {user?.name}</h1>
      <div className="user-info">
        <NotificationBell />
        <span className="badge badge-blue">{user?.role}</span>
        <button className="btn btn-secondary btn-sm" onClick={logout}>Logout</button>
      </div>
    </header>
  );
};

export default Navbar;
