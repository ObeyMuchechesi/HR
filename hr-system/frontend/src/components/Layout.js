import React, { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import Navbar from './Navbar';

const Layout = () => {
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();

  // Close the drawer whenever the route changes
  useEffect(() => { setMenuOpen(false); }, [pathname]);

  return (
    <div className="layout">
      <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
      <div className={`backdrop ${menuOpen ? 'show' : ''}`} onClick={() => setMenuOpen(false)} />
      <div className="main">
        <Navbar onMenu={() => setMenuOpen(true)} />
        <div className="content">
          <Outlet />
        </div>
      </div>
    </div>
  );
};

export default Layout;
