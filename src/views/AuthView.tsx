import React, { useCallback, useEffect, useState } from 'react';
import { BrandLogo, Icon } from '../components/Icon';
import { useAuth } from '../contexts/AuthContext';
import {
  EnvVarCheckStatus,
  isSupabaseConfigured,
  supabaseConfigDiagnostics,
} from '../lib/supabaseClient';
import {
  requestPasswordReset,
  resendSignupConfirmation,
  signInWithEmail,
  signUpWithEmail,
  SupabaseConnectivityReport,
  updateAuthenticatedPassword,
  verifySupabaseEndpointReachable,
} from '../services/authService';

type AuthMode = 'login' | 'register' | 'forgot' | 'recovery';

interface FeedbackState {
  tone: 'success' | 'error' | 'info';
  categoryLabelPT?: string;
  text: string;
  hintPT?: string;
}

function getEnvStatusBadgeStyle(status: EnvVarCheckStatus): {
  badgeClass: string;
  iconName: string;
} {
  switch (status) {
    case 'valid':
      return {
        badgeClass: 'bg-emerald-100 text-emerald-900 border-emerald-300',
        iconName: 'check_circle',
      };
    case 'secret_blocked':
      return {
        badgeClass: 'bg-red-100 text-red-900 border-red-300',
        iconName: 'gpp_bad',
      };
    case 'missing':
      return {
        badgeClass: 'bg-amber-100 text-amber-950 border-amber-300',
        iconName: 'help',
      };
    default:
      return {
        badgeClass: 'bg-amber-100 text-amber-950 border-amber-300',
        iconName: 'error',
      };
  }
}

export const AuthView: React.FC = () => {
  const {
    isPasswordRecovery,
    authNotice,
    clearAuthNotice,
    completePasswordRecovery,
  } = useAuth();

  const [mode, setMode] = useState<AuthMode>(isPasswordRecovery ? 'recovery' : 'login');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [resendingConfirmation, setResendingConfirmation] = useState(false);
  const [canResendConfirmation, setCanResendConfirmation] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);

  const [connectivityReport, setConnectivityReport] =
    useState<SupabaseConnectivityReport | null>(null);
  const [checkingConnectivity, setCheckingConnectivity] = useState(false);

  const runConnectivityCheck = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    setCheckingConnectivity(true);
    const report = await verifySupabaseEndpointReachable();
    setCheckingConnectivity(false);
    setConnectivityReport(report);
  }, []);

  useEffect(() => {
    if (isSupabaseConfigured) {
      void runConnectivityCheck();
    }
  }, [runConnectivityCheck]);

  useEffect(() => {
    if (isPasswordRecovery) {
      setMode('recovery');
    }
  }, [isPasswordRecovery]);

  useEffect(() => {
    if (authNotice) {
      setFeedback({
        tone: authNotice.tone,
        text: authNotice.message,
      });
    }
  }, [authNotice]);

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setFeedback(null);
    setCanResendConfirmation(false);
    clearAuthNotice();
    setPassword('');
    setConfirmPassword('');
  };

  const handleResendConfirmation = async () => {
    if (!email.trim() || resendingConfirmation) return;
    setResendingConfirmation(true);
    const res = await resendSignupConfirmation(email);
    setResendingConfirmation(false);
    setFeedback({
      tone: res.success ? 'success' : 'error',
      categoryLabelPT: res.errorCategoryLabelPT,
      text: res.messagePT,
      hintPT: res.diagnosticHintPT,
    });
    if (res.success) {
      setCanResendConfirmation(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    setCanResendConfirmation(false);
    clearAuthNotice();

    if (!isSupabaseConfigured) {
      setFeedback({
        tone: 'error',
        categoryLabelPT: 'Configuração Pendente',
        text: supabaseConfigDiagnostics.message,
        hintPT: supabaseConfigDiagnostics.checklist[0],
      });
      return;
    }

    if (mode === 'login') {
      setSubmitting(true);
      const res = await signInWithEmail(email, password);
      setSubmitting(false);
      if (!res.success) {
        setFeedback({
          tone: 'error',
          categoryLabelPT: res.errorCategoryLabelPT,
          text: res.messagePT,
          hintPT: res.diagnosticHintPT,
        });
        setCanResendConfirmation(Boolean(res.emailNotConfirmed));
      }
      return;
    }

    if (mode === 'register') {
      if (!fullName.trim()) {
        setFeedback({
          tone: 'error',
          categoryLabelPT: 'Dados Obrigatórios',
          text: 'Informe seu nome completo para criar o perfil.',
        });
        return;
      }
      if (password.length < 6) {
        setFeedback({
          tone: 'error',
          categoryLabelPT: 'Senha Inválida',
          text: 'A senha deve ter no mínimo 6 caracteres.',
        });
        return;
      }
      if (password !== confirmPassword) {
        setFeedback({
          tone: 'error',
          categoryLabelPT: 'Confirmação Divergente',
          text: 'As senhas informadas não coincidem.',
        });
        return;
      }

      setSubmitting(true);
      const res = await signUpWithEmail(fullName, email, password);
      setSubmitting(false);

      if (!res.success) {
        setFeedback({
          tone: 'error',
          categoryLabelPT: res.errorCategoryLabelPT,
          text: res.messagePT,
          hintPT: res.diagnosticHintPT,
        });
        return;
      }

      if (res.requiresEmailConfirmation) {
        setFeedback({
          tone: 'success',
          text: res.messagePT,
        });
        setCanResendConfirmation(true);
        setPassword('');
        setConfirmPassword('');
        setMode('login');
      }
      return;
    }

    if (mode === 'forgot') {
      setSubmitting(true);
      const res = await requestPasswordReset(email);
      setSubmitting(false);

      setFeedback({
        tone: res.success ? 'success' : 'error',
        categoryLabelPT: res.errorCategoryLabelPT,
        text: res.messagePT,
        hintPT: res.diagnosticHintPT,
      });
      return;
    }

    if (mode === 'recovery') {
      if (password.length < 6) {
        setFeedback({
          tone: 'error',
          categoryLabelPT: 'Senha Inválida',
          text: 'A nova senha deve conter pelo menos 6 caracteres.',
        });
        return;
      }
      if (password !== confirmPassword) {
        setFeedback({
          tone: 'error',
          categoryLabelPT: 'Confirmação Divergente',
          text: 'A confirmação de senha não confere.',
        });
        return;
      }

      setSubmitting(true);
      const res = await updateAuthenticatedPassword(password);
      setSubmitting(false);

      if (!res.success) {
        setFeedback({
          tone: 'error',
          categoryLabelPT: res.errorCategoryLabelPT,
          text: res.messagePT,
          hintPT: res.diagnosticHintPT,
        });
        return;
      }

      setFeedback({ tone: 'success', text: res.messagePT });
      completePasswordRecovery();
    }
  };

  const envItems = [
    supabaseConfigDiagnostics.envVars.url,
    supabaseConfigDiagnostics.envVars.anonKey,
  ];

  return (
    <div className="min-h-screen bg-background text-on-surface flex flex-col lg:flex-row">
      {/* Left Institutional Panel (Desktop) */}
      <aside className="hidden lg:flex lg:w-5/12 xl:w-1/2 bg-gradient-to-br from-primary via-primary-container to-on-primary-fixed text-on-primary p-12 flex-col justify-between relative overflow-hidden">
        <div className="absolute -right-20 -top-20 w-80 h-80 rounded-full bg-primary-fixed/15 blur-3xl pointer-events-none" />
        <div className="absolute -left-16 -bottom-16 w-72 h-72 rounded-full bg-primary-fixed-dim/15 blur-3xl pointer-events-none" />

        <div className="relative z-10 flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-white/15 backdrop-blur-md flex items-center justify-center shadow-sm">
            <Icon name="account_balance_wallet" className="text-2xl text-primary-fixed" filled />
          </div>
          <div>
            <span className="text-xl font-bold tracking-tight block leading-none">FinanCerto</span>
            <span className="text-xs text-on-primary/80 font-medium">
              Gestão Financeira Pessoal
            </span>
          </div>
        </div>

        <div className="relative z-10 max-w-lg space-y-6 my-auto py-8">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-white/15 text-primary-fixed text-xs font-semibold tracking-wide uppercase">
            <Icon name="verified_user" className="text-sm" />
            Dados Protegidos com RLS
          </span>
          <h1 className="text-4xl font-bold tracking-tight leading-tight">
            Controle suas receitas, despesas e metas em um único lugar seguro.
          </h1>
          <p className="text-sm text-on-primary/85 leading-relaxed">
            Acompanhe o saldo real das suas contas, categorize movimentações por período e visualize indicadores calculados diretamente do seu banco de dados.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            <div className="bg-black/15 backdrop-blur-xs rounded-xl p-4 space-y-1">
              <div className="flex items-center gap-2 text-primary-fixed font-semibold text-sm">
                <Icon name="receipt_long" className="text-lg" />
                <span>Extrato em Tempo Real</span>
              </div>
              <p className="text-xs text-on-primary/80 leading-relaxed">
                Criação, edição, exclusão e filtros por período e tipo sincronizados.
              </p>
            </div>
            <div className="bg-black/15 backdrop-blur-xs rounded-xl p-4 space-y-1">
              <div className="flex items-center gap-2 text-primary-fixed font-semibold text-sm">
                <Icon name="lock" className="text-lg" />
                <span>Isolamento por Usuário</span>
              </div>
              <p className="text-xs text-on-primary/80 leading-relaxed">
                Autenticação Supabase Auth com políticas Row Level Security ativas.
              </p>
            </div>
          </div>
        </div>

        <div className="relative z-10 flex items-center justify-between text-xs text-on-primary/75">
          <span>FinanCerto • Controle Financeiro Pessoal</span>
          <span>Criptografia TLS &amp; Supabase Auth</span>
        </div>
      </aside>

      {/* Right Authentication Form Area */}
      <main className="flex-1 flex flex-col items-center justify-center p-4 sm:p-8 lg:p-12">
        <div className="w-full max-w-md space-y-6">
          {/* Mobile Brand Header */}
          <div className="flex lg:hidden items-center justify-center gap-2.5 pb-2">
            <BrandLogo />
            <span className="text-xl font-bold text-on-surface tracking-tight">FinanCerto</span>
          </div>

          {/* Environment Configuration Diagnostic Alert */}
          {supabaseConfigDiagnostics.hasIssue && (
            <div className="bg-amber-50 border border-amber-300 text-amber-950 rounded-2xl p-4 space-y-3 shadow-xs">
              <div className="flex items-start gap-2.5">
                <Icon name="warning" className="text-xl text-amber-700 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <h2 className="text-sm font-bold">{supabaseConfigDiagnostics.title}</h2>
                  <p className="text-xs leading-relaxed text-amber-900">
                    {supabaseConfigDiagnostics.message}
                  </p>
                </div>
              </div>

              {/* Per-variable diagnostic status without exposing secret values */}
              <div className="space-y-1.5 pt-0.5">
                {envItems.map((item) => {
                  const style = getEnvStatusBadgeStyle(item.status);
                  return (
                    <div
                      key={item.name}
                      className="bg-white/80 border border-amber-200 rounded-xl px-3 py-2 space-y-0.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <code className="text-[11px] font-bold text-slate-900">{item.name}</code>
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-bold ${style.badgeClass}`}
                        >
                          <Icon name={style.iconName} className="text-xs" />
                          <span>{item.statusLabelPT}</span>
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-700 leading-snug">{item.detailPT}</p>
                    </div>
                  );
                })}
              </div>

              {supabaseConfigDiagnostics.checklist.length > 0 && (
                <div className="space-y-1 pt-0.5">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-amber-900">
                    Como corrigir:
                  </p>
                  <ul className="list-disc pl-5 space-y-1 text-xs text-amber-900">
                    {supabaseConfigDiagnostics.checklist.map((item, idx) => (
                      <li key={idx}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Live Connectivity Failure Alert (when env vars look syntactically valid, but endpoint fails) */}
          {isSupabaseConfigured && connectivityReport && !connectivityReport.reachable && (
            <div className="bg-error-container/80 border border-error/30 text-on-error-container rounded-2xl p-4 space-y-2.5 shadow-xs">
              <div className="flex items-start gap-2.5">
                <Icon name="cloud_off" className="text-xl text-error shrink-0 mt-0.5" />
                <div className="space-y-1 flex-1">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <h2 className="text-sm font-bold">
                      {connectivityReport.categoryLabelPT || 'Falha na Conexão com Supabase'}
                    </h2>
                    <button
                      type="button"
                      disabled={checkingConnectivity}
                      onClick={() => void runConnectivityCheck()}
                      className="inline-flex items-center gap-1 text-[11px] font-bold underline cursor-pointer disabled:opacity-60"
                    >
                      <Icon
                        name={checkingConnectivity ? 'progress_activity' : 'refresh'}
                        className={`text-xs ${checkingConnectivity ? 'animate-spin' : ''}`}
                      />
                      <span>{checkingConnectivity ? 'Verificando...' : 'Testar novamente'}</span>
                    </button>
                  </div>
                  <p className="text-xs leading-relaxed">{connectivityReport.messagePT}</p>
                  {connectivityReport.diagnosticHintPT && (
                    <p className="text-[11px] opacity-90 leading-relaxed pt-0.5">
                      {connectivityReport.diagnosticHintPT}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Main Auth Card */}
          <div className="bg-surface-container-lowest rounded-2xl shadow-md border border-surface-container p-6 sm:p-8 space-y-6">
            {/* Mode Switcher Tabs (Login / Cadastro) */}
            {(mode === 'login' || mode === 'register') && (
              <div className="grid grid-cols-2 p-1 bg-surface-container-low rounded-xl gap-1">
                <button
                  type="button"
                  onClick={() => switchMode('login')}
                  className={`py-2.5 rounded-lg text-sm font-bold transition-all cursor-pointer ${
                    mode === 'login'
                      ? 'bg-surface-container-lowest text-primary shadow-2xs'
                      : 'text-secondary hover:text-on-surface'
                  }`}
                >
                  Entrar
                </button>
                <button
                  type="button"
                  onClick={() => switchMode('register')}
                  className={`py-2.5 rounded-lg text-sm font-bold transition-all cursor-pointer ${
                    mode === 'register'
                      ? 'bg-surface-container-lowest text-primary shadow-2xs'
                      : 'text-secondary hover:text-on-surface'
                  }`}
                >
                  Criar Conta
                </button>
              </div>
            )}

            {/* Heading */}
            <div className="space-y-1">
              <h2 className="text-2xl font-bold text-on-surface tracking-tight">
                {mode === 'login' && 'Acesse sua conta'}
                {mode === 'register' && 'Crie sua conta gratuita'}
                {mode === 'forgot' && 'Recuperar senha'}
                {mode === 'recovery' && 'Definir nova senha'}
              </h2>
              <p className="text-xs text-secondary leading-relaxed">
                {mode === 'login' &&
                  'Informe seu e-mail e senha cadastrados para acessar seu painel financeiro.'}
                {mode === 'register' &&
                  'Seu perfil financeiro individual será criado automaticamente no banco de dados.'}
                {mode === 'forgot' &&
                  'Enviaremos um link seguro para você redefinir sua senha de acesso.'}
                {mode === 'recovery' &&
                  'Escolha uma nova senha segura para concluir a recuperação da sua conta.'}
              </p>
            </div>

            {/* Feedback Banner */}
            {feedback && (
              <div
                role="alert"
                className={`p-3.5 rounded-xl text-xs space-y-2 ${
                  feedback.tone === 'error'
                    ? 'bg-error-container text-on-error-container'
                    : feedback.tone === 'success'
                    ? 'bg-primary-fixed/40 text-on-primary-fixed'
                    : 'bg-surface-container-low text-on-surface'
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <Icon
                    name={
                      feedback.tone === 'error'
                        ? 'error'
                        : feedback.tone === 'success'
                        ? 'check_circle'
                        : 'info'
                    }
                    className={`text-lg shrink-0 mt-0.5 ${
                      feedback.tone === 'error' ? 'text-error' : 'text-primary'
                    }`}
                  />
                  <div className="space-y-1 flex-1">
                    {feedback.categoryLabelPT && (
                      <span className="inline-block text-[10px] font-extrabold uppercase tracking-wider opacity-85">
                        {feedback.categoryLabelPT}
                      </span>
                    )}
                    <p className="font-semibold leading-relaxed">{feedback.text}</p>
                    {feedback.hintPT && (
                      <p className="text-[11px] font-normal opacity-90 leading-relaxed">
                        {feedback.hintPT}
                      </p>
                    )}
                  </div>
                </div>
                {canResendConfirmation && email.trim() && (
                  <div className="pl-7">
                    <button
                      type="button"
                      disabled={resendingConfirmation}
                      onClick={() => void handleResendConfirmation()}
                      className="inline-flex items-center gap-1.5 text-xs font-bold text-primary hover:underline cursor-pointer disabled:opacity-60"
                    >
                      <Icon
                        name={resendingConfirmation ? 'progress_activity' : 'forward_to_inbox'}
                        className={`text-sm ${resendingConfirmation ? 'animate-spin' : ''}`}
                      />
                      <span>
                        {resendingConfirmation
                          ? 'Reenviando confirmação...'
                          : 'Reenviar e-mail de confirmação'}
                      </span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === 'register' && (
                <div className="space-y-1.5">
                  <label
                    htmlFor="auth-fullname"
                    className="block text-xs font-semibold text-on-surface"
                  >
                    Nome Completo *
                  </label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-secondary flex items-center">
                      <Icon name="person" className="text-lg" />
                    </span>
                    <input
                      id="auth-fullname"
                      type="text"
                      autoComplete="name"
                      required
                      disabled={submitting || !isSupabaseConfigured}
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Ex: Maria Oliveira"
                      className="w-full bg-surface-container-low text-on-surface rounded-xl pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25 disabled:opacity-60"
                    />
                  </div>
                </div>
              )}

              {mode !== 'recovery' && (
                <div className="space-y-1.5">
                  <label
                    htmlFor="auth-email"
                    className="block text-xs font-semibold text-on-surface"
                  >
                    E-mail *
                  </label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-secondary flex items-center">
                      <Icon name="mail" className="text-lg" />
                    </span>
                    <input
                      id="auth-email"
                      type="email"
                      autoComplete="email"
                      required
                      disabled={submitting || !isSupabaseConfigured}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="voce@exemplo.com"
                      className="w-full bg-surface-container-low text-on-surface rounded-xl pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25 disabled:opacity-60"
                    />
                  </div>
                </div>
              )}

              {(mode === 'login' || mode === 'register' || mode === 'recovery') && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="auth-password"
                      className="block text-xs font-semibold text-on-surface"
                    >
                      {mode === 'recovery' ? 'Nova Senha *' : 'Senha *'}
                    </label>
                    {mode === 'login' && (
                      <button
                        type="button"
                        onClick={() => switchMode('forgot')}
                        className="text-xs font-semibold text-primary hover:underline cursor-pointer"
                      >
                        Esqueci minha senha
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-secondary flex items-center">
                      <Icon name="lock" className="text-lg" />
                    </span>
                    <input
                      id="auth-password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                      required
                      minLength={6}
                      disabled={submitting || !isSupabaseConfigured}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Mínimo de 6 caracteres"
                      className="w-full bg-surface-container-low text-on-surface rounded-xl pl-10 pr-11 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25 disabled:opacity-60"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-secondary hover:text-on-surface p-1 cursor-pointer"
                    >
                      <Icon
                        name={showPassword ? 'visibility_off' : 'visibility'}
                        className="text-lg"
                      />
                    </button>
                  </div>
                </div>
              )}

              {(mode === 'register' || mode === 'recovery') && (
                <div className="space-y-1.5">
                  <label
                    htmlFor="auth-confirm-password"
                    className="block text-xs font-semibold text-on-surface"
                  >
                    Confirmar Senha *
                  </label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-secondary flex items-center">
                      <Icon name="verified_user" className="text-lg" />
                    </span>
                    <input
                      id="auth-confirm-password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      required
                      minLength={6}
                      disabled={submitting || !isSupabaseConfigured}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Repita a senha escolhida"
                      className="w-full bg-surface-container-low text-on-surface rounded-xl pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25 disabled:opacity-60"
                    />
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={submitting || !isSupabaseConfigured}
                className="w-full py-3 rounded-xl bg-primary hover:bg-primary-container disabled:opacity-60 disabled:cursor-not-allowed text-on-primary text-sm font-bold shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                {!isSupabaseConfigured ? (
                  <>
                    <Icon name="settings_alert" className="text-lg" />
                    <span>Aguardando configuração de VITE_SUPABASE_URL</span>
                  </>
                ) : submitting ? (
                  <>
                    <Icon name="progress_activity" className="text-lg animate-spin" />
                    <span>
                      {mode === 'login' && 'Entrando...'}
                      {mode === 'register' && 'Criando sua conta...'}
                      {mode === 'forgot' && 'Enviando link...'}
                      {mode === 'recovery' && 'Salvando nova senha...'}
                    </span>
                  </>
                ) : (
                  <>
                    <Icon
                      name={
                        mode === 'login'
                          ? 'login'
                          : mode === 'register'
                          ? 'person_add'
                          : mode === 'forgot'
                          ? 'send'
                          : 'check_circle'
                      }
                      className="text-lg"
                    />
                    <span>
                      {mode === 'login' && 'Entrar no FinanCerto'}
                      {mode === 'register' && 'Criar Conta'}
                      {mode === 'forgot' && 'Enviar Link de Recuperação'}
                      {mode === 'recovery' && 'Confirmar Nova Senha'}
                    </span>
                  </>
                )}
              </button>
            </form>

            {/* Footer Links */}
            {mode === 'forgot' && (
              <div className="pt-2 border-t border-surface-container text-center">
                <button
                  type="button"
                  onClick={() => switchMode('login')}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline cursor-pointer"
                >
                  <Icon name="arrow_back" className="text-sm" />
                  <span>Voltar para o login</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};
