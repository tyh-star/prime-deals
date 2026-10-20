import { useQueryClient } from '@tanstack/react-query';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { setUnauthorizedHandler, tokenStore } from '../api/client';
import { api } from '../api/endpoints';
import type { AuthResponse, Role, User } from '../api/types';

interface AuthState {
  user: User | null;
  /** True until a stored token has been checked against the server. */
  loading: boolean;
  signIn: (auth: AuthResponse) => void;
  signOut: () => Promise<void>;
  hasRole: (...roles: Role[]) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(() => !!tokenStore.get());

  const clear = useCallback(() => {
    tokenStore.set(null);
    setUser(null);
    queryClient.clear();
  }, [queryClient]);

  useEffect(() => {
    setUnauthorizedHandler(clear);
    if (!tokenStore.get()) return;
    api
      .me()
      .then(setUser)
      .catch(clear)
      .finally(() => setLoading(false));
  }, [clear]);

  const signIn = useCallback(
    (auth: AuthResponse) => {
      queryClient.clear();
      tokenStore.set(auth.accessToken);
      setUser(auth.user);
    },
    [queryClient],
  );

  const signOut = useCallback(async () => {
    await api.logout().catch(() => undefined);
    clear();
  }, [clear]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      signIn,
      signOut,
      hasRole: (...roles) => !!user && roles.includes(user.role),
    }),
    [user, loading, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
