import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { EmailOtpType, Session, User } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import { signOutUser, translateAuthErrorPT } from '../services/authService';

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  loading: boolean;
  isPasswordRecovery: boolean;
  authNotice: { tone: 'info' | 'error' | 'success'; message: string } | null;
  clearAuthNotice: () => void;
  completePasswordRecovery: () => void;
  handleSessionExpired: (customMessage?: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function cleanAuthUrlParams(): void {
  if (typeof window === 'undefined') return;
  const cleanSearch = new URLSearchParams(window.location.search);
  for (const key of [
    'code',
    'token_hash',
    'type',
    'error',
    'error_code',
    'error_description',
  ]) {
    cleanSearch.delete(key);
  }
  const qs = cleanSearch.toString();
  const nextUrl = `${window.location.pathname}${qs ? `?${qs}` : ''}`;
  window.history.replaceState(null, '', nextUrl);
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(isSupabaseConfigured);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);
  const [authNotice, setAuthNotice] = useState<{
    tone: 'info' | 'error' | 'success';
    message: string;
  } | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setLoading(false);
      return;
    }

    const sbClient = supabase;
    let active = true;

    const hashParams = new URLSearchParams(
      window.location.hash.startsWith('#') ? window.location.hash.slice(1) : ''
    );
    const searchParams = new URLSearchParams(window.location.search);

    // 1. Intercept URL auth errors (e.g., expired recovery/confirmation link) and translate to PT
    const urlError =
      hashParams.get('error_description') ||
      hashParams.get('error_code') ||
      hashParams.get('error') ||
      searchParams.get('error_description') ||
      searchParams.get('error_code') ||
      searchParams.get('error');

    if (urlError) {
      setAuthNotice({
        tone: 'error',
        message: translateAuthErrorPT({
          code: hashParams.get('error_code') || searchParams.get('error_code') || '',
          message: urlError,
        }),
      });
      cleanAuthUrlParams();
    }

    // 2. Detect password recovery flow in hash or query parameters
    const urlType = hashParams.get('type') || searchParams.get('type');
    if (urlType === 'recovery') {
      setIsPasswordRecovery(true);
    }

    const tokenHash = searchParams.get('token_hash');

    const initializeAuthSession = async () => {
      try {
        // Support custom Supabase email templates using ?token_hash=...&type=recovery|signup|email
        if (tokenHash && urlType) {
          const { data: otpData, error: otpError } = await sbClient.auth.verifyOtp({
            token_hash: tokenHash,
            type: urlType as EmailOtpType,
          });
          cleanAuthUrlParams();
          if (!active) return;

          if (otpError) {
            setAuthNotice({
              tone: 'error',
              message: translateAuthErrorPT(otpError),
            });
            setIsPasswordRecovery(false);
            setSession(null);
            setUser(null);
            setLoading(false);
            return;
          }

          if (urlType === 'recovery') {
            setIsPasswordRecovery(true);
          } else if (urlType === 'signup' || urlType === 'email') {
            setAuthNotice({
              tone: 'success',
              message: 'E-mail confirmado com sucesso! Sua conta já está ativa.',
            });
          }

          setSession(otpData.session);
          setUser(otpData.user ?? otpData.session?.user ?? null);
          setLoading(false);
          return;
        }

        // Standard session check + server-side user verification against revoked/expired tokens
        const { data, error } = await sbClient.auth.getSession();
        if (!active) return;

        if (error) {
          setAuthNotice({
            tone: 'error',
            message: translateAuthErrorPT(error),
          });
          setSession(null);
          setUser(null);
          setLoading(false);
          return;
        }

        if (data.session) {
          const { data: userCheck, error: userErr } = await sbClient.auth.getUser();
          if (!active) return;

          if (userErr || !userCheck.user) {
            await sbClient.auth.signOut().catch(() => undefined);
            setSession(null);
            setUser(null);
            setAuthNotice({
              tone: 'error',
              message: 'Sua sessão anterior expirou. Faça login novamente para continuar.',
            });
          } else {
            setSession(data.session);
            setUser(userCheck.user);
          }
        } else {
          setSession(null);
          setUser(null);
        }
      } catch (err) {
        if (!active) return;
        setAuthNotice({
          tone: 'error',
          message: translateAuthErrorPT(err),
        });
        setSession(null);
        setUser(null);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void initializeAuthSession();

    const {
      data: { subscription },
    } = sbClient.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;

      if (event === 'PASSWORD_RECOVERY') {
        setIsPasswordRecovery(true);
        cleanAuthUrlParams();
      } else if (event === 'SIGNED_OUT') {
        setIsPasswordRecovery(false);
        setSession(null);
        setUser(null);
        setLoading(false);
        return;
      }

      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      setLoading(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const clearAuthNotice = useCallback(() => {
    setAuthNotice(null);
  }, []);

  const completePasswordRecovery = useCallback(() => {
    setIsPasswordRecovery(false);
    cleanAuthUrlParams();
  }, []);

  const handleSessionExpired = useCallback(async (customMessage?: string) => {
    if (supabase) {
      try {
        await supabase.auth.signOut();
      } catch {
        // Ignora erro de rede ao limpar sessão expirada localmente
      }
    }
    setIsPasswordRecovery(false);
    setSession(null);
    setUser(null);
    setAuthNotice({
      tone: 'error',
      message:
        customMessage || 'Sua sessão expirou por segurança. Faça login novamente para continuar.',
    });
  }, []);

  const signOut = useCallback(async () => {
    const result = await signOutUser();
    setSession(null);
    setUser(null);
    setIsPasswordRecovery(false);
    setAuthNotice({
      tone: result.success ? 'success' : 'error',
      message: result.messagePT,
    });
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        isPasswordRecovery,
        authNotice,
        clearAuthNotice,
        completePasswordRecovery,
        handleSessionExpired,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth deve ser utilizado dentro de um AuthProvider.');
  }
  return ctx;
}
