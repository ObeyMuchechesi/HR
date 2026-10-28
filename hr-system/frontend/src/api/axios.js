import axios from 'axios';

// In production the backend lives on its own origin (e.g. Vercel),
// so the full URL is injected at build time via REACT_APP_API_URL.
const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL || '/api'
});

api.interceptors.request.use((config) => {
  const user = JSON.parse(localStorage.getItem('hr_user') || 'null');
  if (user?.token) {
    config.headers.Authorization = `Bearer ${user.token}`;
  }
  return config;
});

// A 401 does not always mean the session died. Signing in or registering with
// wrong details returns 401 too, and bouncing the browser to /login for those
// reloads the page and throws away the error message the form wants to show.
// Only treat a 401 as an expired session when the request was not itself an
// auth attempt and there was a session to expire.
const AUTH_ATTEMPT = /\/auth\/(login|register)$/;

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const path = (err.config?.url || '').split('?')[0];
    const isAuthAttempt = AUTH_ATTEMPT.test(path);
    if (err.response?.status === 401 && !isAuthAttempt && localStorage.getItem('hr_user')) {
      localStorage.removeItem('hr_user');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;
