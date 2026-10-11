import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import type { ReactNode } from 'react';

interface AuthUser {
  id: number;
  name: string;
  roleName: string;
}

interface AuthContextType {
  user: AuthUser | null;
  permissions: Record<string, boolean>;
  isLoading: boolean;
  login: (pin: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  hasPermission: (key: string) => boolean;
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [permissions, setPermissions] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState(true);

  const refreshSession = useCallback(async () => {
    try {
      const session = await window.electronAPI.invoke('auth:session') as {
        userId: number;
        name: string;
        roleName: string;
        permissions: Record<string, boolean>;
      } | null;
      if (session) {
        setUser({ id: session.userId, name: session.name, roleName: session.roleName });
        setPermissions(session.permissions);
      }
    } catch {
      setUser(null);
      setPermissions({});
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  const login = useCallback(async (pin: string) => {
    console.log('[FRONTEND] login called, pin length:', pin.length, 'pin:', pin);
    try {
      const result = await window.electronAPI.invoke('auth:login', pin) as {
        success: boolean;
        user?: { id: number; name: string; roleName: string };
        permissions?: Record<string, boolean>;
        error?: string;
      };
      console.log('[FRONTEND] login result:', result);
      if (result.success && result.user && result.permissions) {
        setUser(result.user);
        setPermissions(result.permissions);
        return { success: true };
      }
      return { success: false, error: result.error };
    } catch (err: any) {
      console.log('[FRONTEND] login error:', err);
      return { success: false, error: err?.message || 'Login failed' };
    }
  }, []);

  const logout = useCallback(async () => {
    await window.electronAPI.invoke('auth:logout');
    setUser(null);
    setPermissions({});
  }, []);

  const hasPermission = useCallback(
    (key: string) => {
      return permissions[key] === true;
    },
    [permissions]
  );

  return (
    <AuthContext.Provider value={{ user, permissions, isLoading, login, logout, hasPermission, refreshSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
