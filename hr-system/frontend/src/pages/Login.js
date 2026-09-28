import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const Login = () => {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    if (mode === 'login') {
      const res = await login(form.email, form.password);
      if (res.success) navigate('/');
      else setError(res.message);
    } else {
      try {
        await register(form.name, form.email, form.password);
        navigate('/');
      } catch (err) {
        setError(err.response?.data?.message || 'Registration failed');
      }
    }
    setLoading(false);
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <h2>{mode === 'login' ? 'Welcome back' : 'Create account'}</h2>
        <p>{mode === 'login' ? 'Sign in to your HR dashboard' : 'Create your employee account'}</p>
        {error && <div className="badge badge-red" style={{ display: 'block', marginBottom: 16, textAlign: 'center' }}>{error}</div>}
        <form onSubmit={handleSubmit}>
          {mode === 'register' && (
            <div className="form-group">
              <label>Full Name</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
          )}
          <div className="form-group">
            <label>Email</label>
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={6} />
          </div>
          {mode === 'register' && (
            <p style={{ fontSize: 12, color: '#64748b', marginBottom: 16 }}>
              New accounts start with the Employee role. An admin can upgrade your
              role from the dashboard afterwards.
            </p>
          )}
          <button className="btn btn-primary" disabled={loading}>
            {loading ? 'Please wait...' : mode === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </form>
        <p style={{ marginTop: 20, textAlign: 'center', fontSize: 14 }}>
          {mode === 'login' ? "Don't have an account? " : 'Already have one? '}
          <button onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}
            style={{ background: 'none', border: 'none', color: '#3b82f6', fontWeight: 500 }}>
            {mode === 'login' ? 'Register' : 'Sign in'}
          </button>
        </p>
        {mode === 'login' && (
          <p style={{ textAlign: 'center', fontSize: 12, color: '#94a3b8', marginTop: 12 }}>
            Registering for the first time? Your account starts as an Employee;
            an admin can promote it later.
          </p>
        )}
      </div>
    </div>
  );
};

export default Login;
