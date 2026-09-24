// utils/AuthContext.tsx
import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { User, DEFAULT_USERS } from '../constants/data';

const API_BASE_URL = 'https://aquaguard.kokartsolutions.in/water-purifier-backend/public/api';

interface AuthContextValue {
  currentUser: User | null;
  users: User[];
  token: string | null;
  companyId: string | null;
  login: (username: string, password: string, role: string) => Promise<{ success: boolean; error?: string; user?: User }>;
  logout: () => void;
  addUser: (user: any) => Promise<User | null>;
  updateUser: (user: User) => void;
  deleteUser: (id: string) => void;
  fetchUsers: () => Promise<void>;
  ready: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const USERS_KEY = 'aquaGuardUsers_v2';
const SESSION_KEY = 'aquaGuardSession_v2';
const TOKEN_KEY = 'aquaGuardToken_v2';
const COMPANY_ID_KEY = 'aquaGuardCompanyId_v2';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>(DEFAULT_USERS);
  const [token, setToken] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [savedUsers, savedSession, savedToken, savedCompanyId] = await Promise.all([
          AsyncStorage.getItem(USERS_KEY),
          AsyncStorage.getItem(SESSION_KEY),
          AsyncStorage.getItem(TOKEN_KEY),
          AsyncStorage.getItem(COMPANY_ID_KEY),
        ]);
        if (savedUsers) setUsers(JSON.parse(savedUsers));
        if (savedSession) setCurrentUser(JSON.parse(savedSession));
        if (savedToken) setToken(savedToken);
        if (savedCompanyId) {
          setCompanyId(savedCompanyId);
          // Initial fetch if we have companyId
          fetchUsersInternal(savedCompanyId);
        }
      } catch (e) {
        console.warn('Auth hydration error:', e);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const fetchUsersInternal = async (cid: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/users?company_id=${cid}`);
      const data = await response.json();
      if (Array.isArray(data)) {
        const mappedUsers: User[] = data.map(u => ({
          id: String(u.id),
          name: u.name || '',
          username: u.username || '',
          password: '', // Password is not returned by API
          role: u.role || 'technician',
          phone: u.phone || '',
          area: u.area || '',
          avatar: u.avatar || '🔧',
          isActive: u.is_active === 1 || u.is_active === true,
        }));
        setUsers(mappedUsers);
        AsyncStorage.setItem(USERS_KEY, JSON.stringify(mappedUsers)).catch(console.warn);
      }
    } catch (e) {
      console.error('Failed to fetch users:', e);
    }
  };

  const fetchUsers = async () => {
    if (companyId) {
      await fetchUsersInternal(companyId);
    }
  };

  const login = async (username: string, password: string, role: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, role }),
      });
      const data = await response.json();

      if (data.success) {
        const apiUser = data.user;
        const sessionUser: User = {
          id: String(apiUser.id),
          name: apiUser.name || '',
          username: apiUser.username || '',
          password: password, // Keep password for session if needed
          role: apiUser.role || 'admin',
          phone: apiUser.phone || '',
          area: apiUser.area || '',
          avatar: apiUser.avatar || '👨‍💼',
          isActive: true,
        };

        const cid = String(data.company_id);
        setCurrentUser(sessionUser);
        setToken(data.token);
        setCompanyId(cid);

        await Promise.all([
          AsyncStorage.setItem(SESSION_KEY, JSON.stringify(sessionUser)),
          AsyncStorage.setItem(TOKEN_KEY, data.token),
          AsyncStorage.setItem(COMPANY_ID_KEY, cid),
        ]);

        // Refresh users list for this company
        fetchUsersInternal(cid);

        return { success: true, user: sessionUser };
      } else {
        return { success: false, error: data.message || 'Invalid credentials' };
      }
    } catch (e) {
      return { success: false, error: 'Network error. Please check your connection.' };
    }
  };

  const logout = async () => {
    setCurrentUser(null);
    setToken(null);
    setCompanyId(null);
    await Promise.all([
      AsyncStorage.removeItem(SESSION_KEY),
      AsyncStorage.removeItem(TOKEN_KEY),
      AsyncStorage.removeItem(COMPANY_ID_KEY),
    ]);
  };

  const addUser = async (userData: any): Promise<User | null> => {
    try {
      const response = await fetch(`${API_BASE_URL}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...userData,
          company_id: companyId,
        }),
      });
      const data = await response.json();

      if (data.success) {
        const newUser: User = {
          id: String(data.user.id),
          name: data.user.name || userData.name,
          username: data.user.username,
          password: userData.password,
          role: data.user.role,
          phone: data.user.phone || userData.phone,
          area: data.user.area || userData.area,
          avatar: data.user.avatar || userData.avatar || '🔧',
          isActive: true,
        };
        const updatedUsers = [...users, newUser];
        setUsers(updatedUsers);
        AsyncStorage.setItem(USERS_KEY, JSON.stringify(updatedUsers)).catch(console.warn);
        return newUser;
      }
      return null;
    } catch (e) {
      console.error('Add user error:', e);
      return null;
    }
  };

  const updateUser = (updated: User) => {
    const updatedUsers = users.map((u) => (u.id === updated.id ? updated : u));
    setUsers(updatedUsers);
    AsyncStorage.setItem(USERS_KEY, JSON.stringify(updatedUsers)).catch(console.warn);
  };

  const deleteUser = (id: string) => {
    const updatedUsers = users.filter((u) => u.id !== id);
    setUsers(updatedUsers);
    AsyncStorage.setItem(USERS_KEY, JSON.stringify(updatedUsers)).catch(console.warn);
  };

  if (!ready) return null;

  return (
    <AuthContext.Provider value={{
      currentUser, users, token, companyId, login, logout, addUser, updateUser, deleteUser, fetchUsers, ready
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

