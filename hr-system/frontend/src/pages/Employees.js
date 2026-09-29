import React, { useEffect, useState } from 'react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';

const emptyForm = {
  employeeId: '', firstName: '', lastName: '', email: '', phone: '',
  department: '', position: '', employmentType: 'Full-time',
  hireDate: new Date().toISOString().slice(0, 10), salary: 0,
  status: 'Active', gender: 'Male', address: ''
};

const Employees = () => {
  const { user } = useAuth();
  const [employees, setEmployees] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [search, setSearch] = useState('');
  const canEdit = ['admin', 'hr'].includes(user?.role);

  const load = async () => {
    const { data } = await api.get('/employees', { params: { search } });
    setEmployees(data);
  };

  useEffect(() => {
    api.get('/departments').then(r => setDepartments(r.data));
  }, []);

  useEffect(() => { load(); }, [search]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm, employeeId: `EMP-${Date.now().toString().slice(-5)}` });
    setShowModal(true);
  };

  const openEdit = (emp) => {
    setEditing(emp);
    setForm({
      ...emptyForm,
      ...emp,
      department: emp.department?._id || '',
      hireDate: emp.hireDate ? emp.hireDate.slice(0, 10) : ''
    });
    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      // Strip read-only/model fields so PUT doesn't try to modify _id, timestamps, etc.
      const { _id, id, createdAt, updatedAt, __v, fullName, leaveBalance, ...payload } = form;
      if (editing) await api.put(`/employees/${editing._id}`, payload);
      else await api.post('/employees', payload);
      setShowModal(false);
      load();
    } catch (err) {
      alert(err.response?.data?.message || 'Error');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this employee?')) return;
    await api.delete(`/employees/${id}`);
    load();
  };

  return (
    <div>
      <div className="card-header">
        <h2>Employees ({employees.length})</h2>
        <div style={{ display: 'flex', gap: 12 }}>
          <input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)}
            style={{ padding: '10px 16px', borderRadius: 10, border: '1px solid #cbd5e1', fontSize: 14 }} />
          {canEdit && <button className="btn btn-primary" onClick={openCreate}>+ Add Employee</button>}
        </div>
      </div>

      <div className="card">
        {employees.length === 0 ? (
          <div className="empty">No employees found</div>
        ) : (
          <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Email</th>
                <th>Department</th>
                <th>Position</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {employees.map(e => (
                <tr key={e._id}>
                  <td data-label="ID">{e.employeeId}</td>
                  <td data-label="Name"><strong>{e.firstName} {e.lastName}</strong></td>
                  <td data-label="Email">{e.email}</td>
                  <td data-label="Department">{e.department?.name || '—'}</td>
                  <td data-label="Position">{e.position}</td>
                  <td data-label="Status">
                    <span className={`badge ${
                      e.status === 'Active' ? 'badge-green' :
                      e.status === 'On Leave' ? 'badge-amber' : 'badge-red'
                    }`}>{e.status}</span>
                  </td>
                  <td data-label="Actions">
                    <div className="actions">
                      {canEdit && <button className="btn btn-secondary btn-sm" onClick={() => openEdit(e)}>Edit</button>}
                      {canEdit && <button className="btn btn-danger btn-sm" onClick={() => handleDelete(e._id)}>Delete</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={(e) => e.target.className === 'modal-overlay' && setShowModal(false)}>
          <div className="modal">
            <h3>{editing ? 'Edit Employee' : 'Add Employee'}</h3>
            <form onSubmit={handleSubmit}>
              <div className="form-row">
                <div className="form-group">
                  <label>Employee ID</label>
                  <input value={form.employeeId} onChange={e => setForm({ ...form, employeeId: e.target.value })} required />
                </div>
                <div className="form-group">
                  <label>Email</label>
                  <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>First Name</label>
                  <input value={form.firstName} onChange={e => setForm({ ...form, firstName: e.target.value })} required />
                </div>
                <div className="form-group">
                  <label>Last Name</label>
                  <input value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })} required />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Phone</label>
                  <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Gender</label>
                  <select value={form.gender} onChange={e => setForm({ ...form, gender: e.target.value })}>
                    <option>Male</option><option>Female</option><option>Other</option>
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Department</label>
                  <select value={form.department} onChange={e => setForm({ ...form, department: e.target.value })}>
                    <option value="">Select...</option>
                    {departments.map(d => <option key={d._id} value={d._id}>{d.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Position</label>
                  <input value={form.position} onChange={e => setForm({ ...form, position: e.target.value })} required />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Employment Type</label>
                  <select value={form.employmentType} onChange={e => setForm({ ...form, employmentType: e.target.value })}>
                    <option>Full-time</option><option>Part-time</option><option>Contract</option><option>Intern</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Status</label>
                  <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
                    <option>Active</option><option>On Leave</option><option>Terminated</option><option>Resigned</option>
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Hire Date</label>
                  <input type="date" value={form.hireDate} onChange={e => setForm({ ...form, hireDate: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Salary</label>
                  <input type="number" value={form.salary} onChange={e => setForm({ ...form, salary: Number(e.target.value) })} />
                </div>
              </div>
              <div className="form-group">
                <label>Address</label>
                <input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
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

export default Employees;
