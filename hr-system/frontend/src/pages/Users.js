import React, { useEffect, useState } from 'react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';

const ROLES = ['admin', 'hr', 'manager', 'employee'];

const roleBadge = (role) => {
  const map = { admin: 'badge-red', hr: 'badge-blue', manager: 'badge-amber', employee: 'badge-gray' };
  return map[role] || 'badge-gray';
};

const Users = () => {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const { data } = await api.get('/auth/users');
      setUsers(data);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load users');
    }
  };

  useEffect(() => { load(); }, []);

  const changeRole = async (target, role) => {
    setError('');
    try {
      await api.put('/auth/role', { userId: target._id, role });
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update role');
    }
  };

  const filtered = users.filter(u =>
    !search ||
    u.name?.toLowerCase().includes(search.toLowerCase()) ||
    u.email?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div className="card-header">
        <h2>User Accounts ({users.length})</h2>
        <input placeholder="Search users..." value={search} onChange={e => setSearch(e.target.value)}
          style={{ padding: '10px 16px', borderRadius: 10, border: '1px solid #cbd5e1', fontSize: 14 }} />
      </div>

      {error && <div className="badge badge-red" style={{ display: 'block', marginBottom: 16, padding: '10px 16px' }}>{error}</div>}

      <div className="card">
        {filtered.length === 0 ? (
          <div className="empty">No user accounts found</div>
        ) : (
          <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Linked Employee</th>
                <th>Joined</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(u => (
                <tr key={u._id}>
                  <td data-label="Name"><strong>{u.name}{currentUser?._id === u._id ? ' (you)' : ''}</strong></td>
                  <td data-label="Email">{u.email}</td>
                  <td data-label="Role"><span className={`badge ${roleBadge(u.role)}`} style={{ textTransform: 'capitalize' }}>{u.role}</span></td>
                  <td data-label="Linked Employee">
                    {u.employee
                      ? `${u.employee.firstName} ${u.employee.lastName} (${u.employee.employeeId})`
                      : <span style={{ color: '#94a3b8' }}>—</span>}
                  </td>
                  <td data-label="Joined">{new Date(u.createdAt).toLocaleDateString()}</td>
                  <td data-label="Change Role">
                    <select
                      value={u.role}
                      disabled={currentUser?._id === u._id}
                      onChange={(e) => changeRole(u, e.target.value)}
                      style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13 }}
                      title={currentUser?._id === u._id ? "You can't change your own role" : 'Change role'}
                    >
                      {ROLES.map(r => <option key={r} value={r} style={{ textTransform: 'capitalize' }}>{r}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      <p style={{ fontSize: 13, color: '#64748b' }}>
        Roles: <strong>admin</strong> (full access) · <strong>hr</strong> (manage people, leave, payroll) ·{' '}
        <strong>manager</strong> (approve leave) · <strong>employee</strong> (own data only).
        You cannot change your own role.
      </p>
    </div>
  );
};

export default Users;
