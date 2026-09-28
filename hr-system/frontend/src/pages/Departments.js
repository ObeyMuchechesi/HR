import React, { useEffect, useState } from 'react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';

const Departments = () => {
  const { user } = useAuth();
  const [departments, setDepartments] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: '', code: '', description: '', manager: '', budget: 0, location: '' });
  const [editing, setEditing] = useState(null);
  const canEdit = ['admin', 'hr'].includes(user?.role);

  const load = async () => {
    const { data } = await api.get('/departments');
    setDepartments(data);
    const { data: emps } = await api.get('/employees');
    setEmployees(emps);
  };

  useEffect(() => { load(); }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editing) await api.put(`/departments/${editing._id}`, form);
      else await api.post('/departments', form);
      setShowModal(false);
      load();
    } catch (err) {
      alert(err.response?.data?.message || 'Error');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this department?')) return;
    await api.delete(`/departments/${id}`);
    load();
  };

  return (
    <div>
      <div className="card-header">
        <h2>Departments ({departments.length})</h2>
        {canEdit && (
          <button className="btn btn-primary" onClick={() => {
            setEditing(null);
            setForm({ name: '', code: '', description: '', manager: '', budget: 0, location: '' });
            setShowModal(true);
          }}>+ Add Department</button>
        )}
      </div>

      <div className="card">
        {departments.length === 0 ? (
          <div className="empty">No departments yet</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Code</th><th>Name</th><th>Manager</th><th>Location</th>
                <th>Budget</th><th>Employees</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {departments.map(d => (
                <tr key={d._id}>
                  <td><span className="badge badge-blue">{d.code}</span></td>
                  <td><strong>{d.name}</strong></td>
                  <td>{d.manager ? `${d.manager.firstName} ${d.manager.lastName}` : '—'}</td>
                  <td>{d.location || '—'}</td>
                  <td>${(d.budget || 0).toLocaleString()}</td>
                  <td>{d.employeeCount || 0}</td>
                  <td>
                    <div className="actions">
                      {canEdit && <button className="btn btn-secondary btn-sm" onClick={() => {
                        setEditing(d);
                        setForm({
                          name: d.name, code: d.code, description: d.description || '',
                          manager: d.manager?._id || '', budget: d.budget || 0, location: d.location || ''
                        });
                        setShowModal(true);
                      }}>Edit</button>}
                      {user?.role === 'admin' && (
                        <button className="btn btn-danger btn-sm" onClick={() => handleDelete(d._id)}>Delete</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={(e) => e.target.className === 'modal-overlay' && setShowModal(false)}>
          <div className="modal">
            <h3>{editing ? 'Edit Department' : 'Add Department'}</h3>
            <form onSubmit={handleSubmit}>
              <div className="form-row">
                <div className="form-group">
                  <label>Name</label>
                  <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
                </div>
                <div className="form-group">
                  <label>Code</label>
                  <input value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} required />
                </div>
              </div>
              <div className="form-group">
                <label>Description</label>
                <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows="3" />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Manager</label>
                  <select value={form.manager} onChange={e => setForm({ ...form, manager: e.target.value })}>
                    <option value="">None</option>
                    {employees.map(e => <option key={e._id} value={e._id}>{e.firstName} {e.lastName}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Location</label>
                  <input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} />
                </div>
              </div>
              <div className="form-group">
                <label>Budget</label>
                <input type="number" value={form.budget} onChange={e => setForm({ ...form, budget: Number(e.target.value) })} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">{editing ? 'Update' : 'Create'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Departments;
