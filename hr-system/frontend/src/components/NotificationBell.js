import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/axios';

const POLL_MS = 30000;

const timeAgo = (iso) => {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
};

const NotificationBell = () => {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const boxRef = useRef(null);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    try {
      const [n, c] = await Promise.all([
        api.get('/notifications'),
        api.get('/notifications/unread-count')
      ]);
      setItems(n.data);
      setUnread(c.data.count);
    } catch { /* silent - badge is non-critical */ }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    const onClickOutside = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const markAll = async () => {
    await api.patch('/notifications/read-all');
    load();
  };

  const openItem = async (n) => {
    if (!n.read) {
      await api.patch(`/notifications/${n._id}/read`);
    }
    load();
    setOpen(false);
    if (n.link) navigate(n.link);
  };

  return (
    <div style={{ position: 'relative' }} ref={boxRef}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          background: 'none', border: 'none', cursor: 'pointer', fontSize: 20,
          position: 'relative', padding: '4px 8px', lineHeight: 1
        }}
        aria-label="Notifications"
      >
        🔔
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: -2, right: -2,
            background: '#ef4444', color: '#fff', borderRadius: 999,
            fontSize: 10, fontWeight: 700, minWidth: 16, height: 16,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '0 4px'
          }}>{unread > 9 ? '9+' : unread}</span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', right: 0, top: '110%', width: 340, maxHeight: 420,
          overflowY: 'auto', background: '#fff', borderRadius: 12,
          boxShadow: '0 12px 40px rgba(15,23,42,0.18)', border: '1px solid #e2e8f0', zIndex: 1200
        }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '12px 16px', borderBottom: '1px solid #f1f5f9'
          }}>
            <strong style={{ fontSize: 14 }}>Notifications</strong>
            {unread > 0 && (
              <button onClick={markAll} style={{
                border: 'none', background: 'none', color: '#2563eb',
                cursor: 'pointer', fontSize: 12
              }}>Mark all read</button>
            )}
          </div>
          {items.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
              No notifications yet
            </div>
          ) : items.map(n => (
            <div
              key={n._id}
              onClick={() => openItem(n)}
              style={{
                padding: '12px 16px', borderBottom: '1px solid #f8fafc', cursor: 'pointer',
                background: n.read ? '#fff' : '#eff6ff'
              }}
            >
              <div style={{ fontSize: 13, fontWeight: n.read ? 500 : 700 }}>{n.title}</div>
              <div style={{ fontSize: 12, color: '#475569', marginTop: 2 }}>{n.body}</div>
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>{timeAgo(n.createdAt)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
