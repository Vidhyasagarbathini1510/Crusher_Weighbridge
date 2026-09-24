// Holds the JWT + user across the app, persisted to localStorage.
import React, { createContext, useContext, useState } from 'react';
import { api } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // Clear any legacy persistent tokens from localStorage so reopening the app requires login
  try {
    localStorage.removeItem('noris_token');
    localStorage.removeItem('noris_user');
  } catch (_) {}

  const [token, setToken] = useState(() => {
    try {
      return sessionStorage.getItem('noris_token') || null;
    } catch {
      return null;
    }
  });
  const [user, setUser] = useState(() => {
    try {
      const saved = sessionStorage.getItem('noris_user');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  async function login(username, password) {
    const data = await api.login(username, password);
    try {
      sessionStorage.setItem('noris_token', data.token);
      sessionStorage.setItem('noris_user', JSON.stringify(data.user));
    } catch (_) {}
    setToken(data.token);
    setUser(data.user);
    return data.user;
  }

  function logout() {
    api.logout().catch(() => {}); // best-effort audit log
    try {
      sessionStorage.removeItem('noris_token');
      sessionStorage.removeItem('noris_user');
      localStorage.removeItem('noris_token');
      localStorage.removeItem('noris_user');
    } catch (_) {}
    setToken(null);
    setUser(null);
  }

  const role = user?.role || (user ? 'operator' : null);
  const isAdmin = role === 'admin';
  const isOperator = role === 'operator';

  return (
    <AuthContext.Provider value={{ token, user, role, isAdmin, isOperator, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
