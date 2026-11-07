import React, { useState, useEffect, useMemo, useRef } from 'react';
import { formatBRL } from '../data/initialData';
import { getClientSecurityPosture } from '../lib/supabaseClient';
import {
  updateAuthenticatedPassword,
  validatePasswordChange,
} from '../services/authService';
import {
  runLiveSecurityAndRlsAudit,
  SecurityAuditReport,
  SUPABASE_RLS_DIAGNOSTIC_SQL,
  SUPABASE_RLS_REMEDIATION_SQL,
} from '../services/securityAuditService';
import {
  AccountItem,
  ActiveSession,
  DataSourceMode,
  ScreenId,
  UserProfile,
} from '../types/finance';
import { Icon, SafeAvatar } from '../components/Icon';

export interface SaveProfileResult {
  ok: boolean;
  profile?: UserProfile;
  messagePT: string;
}

interface ConfiguracoesViewProps {
  userProfile: UserProfile;
  accounts: AccountItem[];
  dataSourceMode: DataSourceMode;
  isLoading?: boolean;
  onUpdateProfile: (profile: UserProfile) => Promise<SaveProfileResult>;
  onRefreshProfile?: () => Promise<void> | void;
  onExportCsv: () => void;
  onSignOut: () => Promise<void> | void;
  onNavigate: (screen: ScreenId) => void;
  onNotify: (msg: string, tone?: 'success' | 'error') => void;
}

type SettingsTabId =
  | 'perfil'
  | 'seguranca'
  | 'preferencias'
  | 'notificacoes'
  | 'openfinance';

const SETTINGS_TABS: { id: SettingsTabId; label: string; icon: string }[] = [
  { id: 'perfil', label: 'Perfil & Dados Pessoais', icon: 'person' },
  { id: 'seguranca', label: 'Segurança & Senha', icon: 'security' },
  { id: 'preferencias', label: 'Preferências & Moeda', icon: 'tune' },
  { id: 'notificacoes', label: 'Notificações & Alertas', icon: 'notifications_active' },
  { id: 'openfinance', label: 'Supabase & RLS', icon: 'hub' },
];

function readImageAsCompressedDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Selecione um arquivo de imagem válido (PNG, JPG ou WebP).'));
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      reject(new Error('A imagem deve ter no máximo 4 MB.'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo selecionado.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Formato de imagem inválido.'));
      img.onload = () => {
        const maxSide = 160;
        const scale = Math.min(1, maxSide / Math.max(img.width || 1, img.height || 1));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(String(reader.result || ''));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}

export const ConfiguracoesView: React.FC<ConfiguracoesViewProps> = ({
  userProfile,
  accounts,
  dataSourceMode,
  isLoading = false,
  onUpdateProfile,
  onRefreshProfile,
  onExportCsv,
  onSignOut,
  onNavigate,
  onNotify,
}) => {
  const [activeTab, setActiveTab] = useState<SettingsTabId>('perfil');
  const [draft, setDraft] = useState<UserProfile>(userProfile);
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Inline feedback banner for Profile updates (`public.profiles`)
  const [profileFeedback, setProfileFeedback] = useState<{
    tone: 'success' | 'error';
    message: string;
  } | null>(null);

  // Notification toggles for Notificações tab
  const [whatsappAlerts, setWhatsappAlerts] = useState(true);
  const [weeklyDigest, setWeeklyDigest] = useState(true);

  // Password Change state (inline & accessible from both Perfil and Segurança tabs)
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const passwordSectionRef = useRef<HTMLElement>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [updatingPassword, setUpdatingPassword] = useState(false);
  const [passwordFeedback, setPasswordFeedback] = useState<{
    tone: 'success' | 'error';
    message: string;
  } | null>(null);

  // Real Live Security & RLS Audit state (never pre-populated with fake results)
  const clientPosture = useMemo(() => getClientSecurityPosture(), []);
  const [auditReport, setAuditReport] = useState<SecurityAuditReport | null>(null);
  const [runningAudit, setRunningAudit] = useState(false);
  const [showDiagnosticSql, setShowDiagnosticSql] = useState(false);
  const [showRemediationSql, setShowRemediationSql] = useState(false);

  const handleRunSecurityAudit = async () => {
    if (runningAudit) return;
    setRunningAudit(true);
    try {
      const report = await runLiveSecurityAndRlsAudit();
      setAuditReport(report);
      if (report.overallStatus === 'passed') {
        onNotify('Auditoria RLS concluída: todas as 5 tabelas aprovadas!', 'success');
      } else if (report.overallStatus === 'warning') {
        onNotify('Auditoria concluída com avisos para conferência no SQL Editor.', 'error');
      } else {
        onNotify('Auditoria identificou pontos de segurança que exigem atenção.', 'error');
      }
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Não foi possível concluir a auditoria de segurança.';
      onNotify(msg, 'error');
    } finally {
      setRunningAudit(false);
    }
  };

  const handleCopySql = async (sqlText: string, label: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(sqlText);
        onNotify(`${label} copiado para a área de transferência!`, 'success');
      } else {
        onNotify('Selecione o bloco SQL abaixo para copiar.', 'success');
      }
    } catch {
      onNotify('Abra o bloco SQL abaixo e copie manualmente.', 'error');
    }
  };

  const sessions = useMemo<ActiveSession[]>(() => {
    const isMobile =
      typeof navigator !== 'undefined' && /Mobi|Android|iPhone/i.test(navigator.userAgent);
    return [
      {
        id: 'current-auth-session',
        device: isMobile
          ? 'Navegador Mobile (Este dispositivo)'
          : 'Navegador Web (Este dispositivo)',
        versionOrBadge: 'Sessão Autenticada Ativa',
        locationAndIp: userProfile.email
          ? `Autenticado como ${userProfile.email}`
          : 'Sessão protegida via Supabase Auth',
        icon: isMobile ? 'smartphone' : 'laptop_mac',
        isCurrent: true,
      },
    ];
  }, [userProfile.email]);

  useEffect(() => {
    setDraft(userProfile);
  }, [userProfile]);

  const hasUnsavedChanges = useMemo(() => {
    return (
      draft.name.trim() !== userProfile.name.trim() ||
      draft.phone.trim() !== userProfile.phone.trim() ||
      draft.occupation.trim() !== userProfile.occupation.trim() ||
      draft.currency !== userProfile.currency ||
      draft.fiscalMonthStart !== userProfile.fiscalMonthStart ||
      draft.dateFormat !== userProfile.dateFormat ||
      draft.budgetCeilingAlert !== userProfile.budgetCeilingAlert ||
      draft.twoFactorEnabled !== userProfile.twoFactorEnabled ||
      draft.avatarPortraitUrl !== userProfile.avatarPortraitUrl
    );
  }, [draft, userProfile]);

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setProfileFeedback(null);

    const trimmedName = draft.name.trim().replace(/\s+/g, ' ');
    if (!trimmedName) {
      const msg = 'Informe seu nome completo para salvar o perfil.';
      setProfileFeedback({ tone: 'error', message: msg });
      onNotify(msg, 'error');
      return;
    }
    if (trimmedName.length < 2) {
      const msg = 'O nome completo deve ter pelo menos 2 caracteres.';
      setProfileFeedback({ tone: 'error', message: msg });
      onNotify(msg, 'error');
      return;
    }
    if (trimmedName.length > 120) {
      const msg = 'O nome completo deve ter no máximo 120 caracteres.';
      setProfileFeedback({ tone: 'error', message: msg });
      onNotify(msg, 'error');
      return;
    }

    setSaving(true);
    try {
      const result = await onUpdateProfile({
        ...draft,
        name: trimmedName,
        email: userProfile.email,
      });

      if (result.ok) {
        if (result.profile) {
          setDraft(result.profile);
        }
        setProfileFeedback({
          tone: 'success',
          message: result.messagePT,
        });
      } else {
        setProfileFeedback({
          tone: 'error',
          message: result.messagePT,
        });
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    setDraft(userProfile);
    setProfileFeedback(null);
    onNotify('Alterações não salvas foram descartadas.');
  };

  const handleRefreshClick = async () => {
    if (!onRefreshProfile || refreshing) return;
    setRefreshing(true);
    setProfileFeedback(null);
    try {
      await onRefreshProfile();
    } finally {
      setRefreshing(false);
    }
  };

  const handleFocusPasswordSection = () => {
    if (activeTab !== 'perfil' && activeTab !== 'seguranca') {
      setActiveTab('seguranca');
    }
    setTimeout(() => {
      passwordSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      passwordInputRef.current?.focus();
    }, 60);
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordFeedback(null);

    const validation = validatePasswordChange(newPassword, confirmNewPassword);
    if (!validation.valid) {
      setPasswordFeedback({ tone: 'error', message: validation.messagePT });
      onNotify(validation.messagePT, 'error');
      return;
    }

    setUpdatingPassword(true);
    try {
      const res = await updateAuthenticatedPassword(newPassword, confirmNewPassword);
      if (!res.success) {
        setPasswordFeedback({ tone: 'error', message: res.messagePT });
        onNotify(res.messagePT, 'error');
        return;
      }

      setNewPassword('');
      setConfirmNewPassword('');
      setShowNewPassword(false);
      setShowConfirmPassword(false);
      setPasswordFeedback({ tone: 'success', message: res.messagePT });
      onNotify(res.messagePT, 'success');
    } finally {
      setUpdatingPassword(false);
    }
  };

  const handleSignOutClick = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await onSignOut();
    } finally {
      setSigningOut(false);
    }
  };

  const showAllOr = (...tabs: SettingsTabId[]) =>
    activeTab === 'perfil' || tabs.includes(activeTab);

  const isSupabaseConnected = dataSourceMode === 'supabase';
  const passwordMinLengthMet = newPassword.length >= 6 && newPassword.trim().length > 0;
  const passwordsMatch =
    confirmNewPassword.length > 0 && newPassword === confirmNewPassword;

  return (
    <div className="flex flex-col w-full space-y-space-lg">
      {/* Header Area */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-space-md">
        <div>
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary mb-1">
            <Icon name="manage_accounts" className="text-sm text-primary" />
            <span>Painel de Controle</span>
          </div>
          <h1 className="text-[32px] leading-10 font-bold text-on-surface tracking-tight">
            Configurações de Perfil
          </h1>
          <p className="text-sm text-on-surface-variant max-w-2xl mt-0.5">
            Gerencie seu nome completo no Supabase, senha de acesso, preferências e sessão autenticada.
          </p>
        </div>

        {/* Honest Data Persistence Badge + Sync Button */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2 bg-surface-container-low px-space-md py-2 rounded-xl text-xs">
            <Icon
              name={isSupabaseConnected ? 'cloud_done' : 'database'}
              className="text-base text-primary"
            />
            <span className="text-on-surface font-semibold">
              {isSupabaseConnected
                ? 'Conectado ao Supabase'
                : 'Armazenamento Local Ativo'}
            </span>
            <span className="text-outline-variant">•</span>
            <span className="text-secondary">
              {isSupabaseConnected
                ? 'Tabela public.profiles + RLS'
                : 'Configuração Supabase pendente'}
            </span>
          </div>

          {onRefreshProfile && (
            <button
              type="button"
              onClick={handleRefreshClick}
              disabled={refreshing || isLoading}
              title="Recarregar dados reais do perfil no Supabase"
              className="inline-flex items-center gap-1.5 bg-surface-container-lowest hover:bg-surface-container-low text-on-surface px-3.5 py-2 rounded-xl text-xs font-semibold shadow-2xs transition-colors cursor-pointer disabled:opacity-60"
            >
              <Icon
                name="sync"
                className={`text-base text-primary ${
                  refreshing || isLoading ? 'animate-spin' : ''
                }`}
              />
              <span>Sincronizar</span>
            </button>
          )}
        </div>
      </div>

      {/* Internal Tabs Navigation */}
      <div className="bg-surface-container-lowest rounded-xl p-1.5 shadow-xs flex items-center gap-1 overflow-x-auto">
        {SETTINGS_TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex items-center gap-2 px-space-md py-2.5 rounded-lg text-sm whitespace-nowrap transition-all cursor-pointer ${
                isActive
                  ? 'bg-primary-container text-on-primary-container font-semibold shadow-2xs'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low font-medium'
              }`}
            >
              <Icon name={tab.icon} className="text-base" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Main Content Layout */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-space-lg items-start">
        {/* Left Column (8 Cols) */}
        <div className="xl:col-span-8 space-y-space-lg">
          {/* Section 1: Authenticated User Identity Header Card */}
          {showAllOr('seguranca') && (
            <section className="bg-surface-container-lowest rounded-xl p-space-lg shadow-xs relative overflow-hidden">
              <div className="absolute -top-16 -right-16 w-56 h-56 bg-primary-fixed-dim/20 rounded-full blur-3xl pointer-events-none" />
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-space-md relative z-10">
                <div className="flex items-center gap-space-md min-w-0">
                  <SafeAvatar
                    src={draft.avatarPortraitUrl || userProfile.avatarPortraitUrl}
                    name={userProfile.name}
                    className="w-20 h-20 text-xl shrink-0"
                  />
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-lg text-on-surface font-bold truncate">
                        {userProfile.name}
                      </h2>
                      <span className="inline-flex items-center gap-1 text-xs text-primary font-semibold bg-primary/10 px-2.5 py-0.5 rounded-full">
                        <Icon name="verified" className="text-sm" />
                        Conta Autenticada
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 text-sm text-on-surface-variant">
                      <Icon name="mail" className="text-base text-primary shrink-0" />
                      <span className="font-medium truncate">
                        {userProfile.email || 'E-mail não disponível'}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap text-xs text-secondary pt-0.5">
                      <span>Membro desde {userProfile.memberSince}</span>
                      <span>•</span>
                      <span className="inline-flex items-center gap-1 text-on-surface-variant">
                        <Icon name="shield_lock" className="text-sm text-primary" />
                        Protegido por RLS (somente você acessa seu perfil)
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-start sm:self-center flex-wrap">
                  <label className="px-3.5 py-2 rounded-xl bg-surface-container-low hover:bg-surface-container text-on-surface text-xs font-semibold transition-all inline-flex items-center gap-1.5 shadow-2xs cursor-pointer whitespace-nowrap">
                    <Icon name="upload" className="text-base" />
                    <span>Foto</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (!file) return;
                        try {
                          const dataUrl = await readImageAsCompressedDataUrl(file);
                          setDraft((d) => ({
                            ...d,
                            avatarPortraitUrl: dataUrl,
                            avatarHeaderUrl: dataUrl,
                          }));
                          setProfileFeedback(null);
                          onNotify(
                            'Foto carregada! Clique em "Salvar Alterações" para aplicar no perfil.',
                            'success'
                          );
                        } catch (err) {
                          const msg =
                            err instanceof Error
                              ? err.message
                              : 'Não foi possível carregar a imagem.';
                          onNotify(msg, 'error');
                        }
                      }}
                    />
                  </label>

                  {draft.avatarPortraitUrl && (
                    <button
                      type="button"
                      onClick={() => {
                        setDraft((d) => ({
                          ...d,
                          avatarPortraitUrl: '',
                          avatarHeaderUrl: '',
                        }));
                        onNotify(
                          'Foto removida do rascunho. Clique em "Salvar Alterações" para confirmar.'
                        );
                      }}
                      className="px-3 py-2 rounded-xl bg-surface-container-low hover:bg-surface-container text-secondary hover:text-on-surface text-xs font-semibold transition-all inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                    >
                      <Icon name="close" className="text-sm" />
                      <span>Remover foto</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={handleSignOutClick}
                    disabled={signingOut}
                    className="px-3.5 py-2 rounded-xl bg-error-container/50 hover:bg-error-container text-on-error-container text-xs font-semibold transition-all inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap disabled:opacity-60"
                  >
                    <Icon
                      name={signingOut ? 'progress_activity' : 'logout'}
                      className={`text-base ${signingOut ? 'animate-spin' : ''}`}
                    />
                    <span>{signingOut ? 'Saindo...' : 'Sair da Conta'}</span>
                  </button>
                </div>
              </div>
            </section>
          )}

          {/* Dedicated Supabase & RLS Live Security Audit Section */}
          {activeTab === 'openfinance' && (
            <section className="bg-surface-container-lowest rounded-xl p-space-lg shadow-xs space-y-space-md">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="space-y-0.5">
                  <h3 className="text-lg text-on-surface font-bold flex items-center gap-2">
                    <Icon name="shield_lock" className="text-primary text-xl" />
                    <span>Auditoria Real de Autenticação &amp; RLS</span>
                  </h3>
                  <p className="text-xs text-secondary">
                    Verificação real (sem simulação) das chaves do frontend, sessão JWT e políticas
                    Row Level Security nas 5 tabelas do Supabase.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleRunSecurityAudit}
                  disabled={runningAudit || !isSupabaseConnected}
                  className="px-4 py-2 rounded-xl bg-primary hover:bg-primary-container text-on-primary text-xs font-bold transition-all shadow-2xs inline-flex items-center gap-2 cursor-pointer disabled:opacity-60"
                >
                  <Icon
                    name={runningAudit ? 'progress_activity' : 'policy'}
                    className={`text-base ${runningAudit ? 'animate-spin' : ''}`}
                  />
                  <span>
                    {runningAudit
                      ? 'Auditando Tabelas no Supabase...'
                      : 'Executar Auditoria Real no Supabase'}
                  </span>
                </button>
              </div>

              {/* Real Client Bundle & Key Posture (Inspected Live from Runtime Env) */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-surface-container-low rounded-xl p-3.5 space-y-1">
                  <div className="flex items-center justify-between text-xs font-semibold text-secondary">
                    <span>Chave no Frontend</span>
                    <Icon
                      name={!clientPosture.hasSecretKeyExposed ? 'verified_user' : 'error'}
                      className={`text-base ${
                        !clientPosture.hasSecretKeyExposed ? 'text-primary' : 'text-error'
                      }`}
                    />
                  </div>
                  <p className="text-xs font-bold text-on-surface">
                    {!clientPosture.hasSecretKeyExposed
                      ? clientPosture.publicKeyKind
                      : 'ALERTA: Chave secreta detectada'}
                  </p>
                  <p className="text-[11px] text-secondary">
                    Papel JWT: <code className="font-mono">{clientPosture.jwtRole || 'n/d'}</code>{' '}
                    (sem service_role)
                  </p>
                </div>

                <div className="bg-surface-container-low rounded-xl p-3.5 space-y-1">
                  <div className="flex items-center justify-between text-xs font-semibold text-secondary">
                    <span>Transporte &amp; Projeto</span>
                    <Icon
                      name={
                        clientPosture.httpsEnforced && clientPosture.projectRefMatched
                          ? 'lock'
                          : 'warning'
                      }
                      className={`text-base ${
                        clientPosture.httpsEnforced && clientPosture.projectRefMatched
                          ? 'text-primary'
                          : 'text-error'
                      }`}
                    />
                  </div>
                  <p className="text-xs font-bold text-on-surface">
                    {clientPosture.httpsEnforced ? 'HTTPS Obrigatório Ativo' : 'URL não verificada'}
                  </p>
                  <p className="text-[11px] text-secondary">
                    {clientPosture.projectRefMatched
                      ? 'URL e chave anon do mesmo projeto'
                      : 'Divergência entre URL e chave'}
                  </p>
                </div>

                <div className="bg-surface-container-low rounded-xl p-3.5 space-y-1">
                  <div className="flex items-center justify-between text-xs font-semibold text-secondary">
                    <span>Escopo no Frontend</span>
                    <Icon name="filter_alt" className="text-base text-primary" />
                  </div>
                  <p className="text-xs font-bold text-on-surface">
                    100% Filtrado por auth.uid()
                  </p>
                  <p className="text-[11px] text-secondary">
                    Consultas e chaves estrangeiras validadas por usuário
                  </p>
                </div>
              </div>

              {/* Live Audit Results Table */}
              {!auditReport ? (
                <div className="bg-surface-container-low/70 rounded-xl p-space-md border border-surface-container space-y-2">
                  <p className="text-xs font-semibold text-on-surface flex items-center gap-1.5">
                    <Icon name="info" className="text-base text-primary" />
                    <span>Como funciona o teste real de segurança:</span>
                  </p>
                  <p className="text-xs text-secondary leading-relaxed">
                    Clique em <strong>Executar Auditoria Real no Supabase</strong> acima para testar
                    ao vivo no banco: (1) bloqueio de leitura anônima sem token, (2) isolamento de{' '}
                    <code className="font-mono text-on-surface">SELECT</code> sem filtro no cliente,
                    (3) bloqueio de <code className="font-mono text-on-surface">INSERT</code> com{' '}
                    <code className="font-mono text-on-surface">user_id</code>/<code className="font-mono text-on-surface">id</code>{' '}
                    de outro usuário (<code className="font-mono text-on-surface">WITH CHECK</code>{' '}
                    código <code className="font-mono text-on-surface">42501</code>), e (4) bloqueio
                    de <code className="font-mono text-on-surface">UPDATE</code> e{' '}
                    <code className="font-mono text-on-surface">DELETE</code> em registros de terceiros.
                    Nenhum dado seu é alterado ou apagado.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div
                    role="status"
                    className={`p-3.5 rounded-xl text-xs font-semibold flex items-start gap-2.5 border ${
                      auditReport.overallStatus === 'passed'
                        ? 'bg-primary-fixed/35 text-primary border-primary/20'
                        : auditReport.overallStatus === 'warning'
                        ? 'bg-surface-container-low text-on-surface border-outline-variant'
                        : 'bg-error-container/60 text-on-error-container border-error/25'
                    }`}
                  >
                    <Icon
                      name={
                        auditReport.overallStatus === 'passed'
                          ? 'verified'
                          : auditReport.overallStatus === 'warning'
                          ? 'info'
                          : 'error'
                      }
                      className="text-lg shrink-0 mt-0.5"
                    />
                    <div className="space-y-1">
                      <p>{auditReport.summaryPT}</p>
                      <p className="text-[11px] opacity-85 font-normal">
                        Usuário validado no servidor Auth:{' '}
                        <code className="font-mono">{auditReport.authenticatedEmail}</code> (UID:{' '}
                        <code className="font-mono">{auditReport.authenticatedUserId}</code>)
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2.5">
                    {auditReport.tables.map((tbl) => (
                      <div
                        key={tbl.table}
                        className="bg-surface-container-low rounded-xl p-3.5 border border-surface-container space-y-2"
                      >
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-2">
                            <Icon
                              name={
                                tbl.status === 'passed'
                                  ? 'check_circle'
                                  : tbl.status === 'warning'
                                  ? 'help'
                                  : 'cancel'
                              }
                              className={`text-base ${
                                tbl.status === 'passed'
                                  ? 'text-primary'
                                  : tbl.status === 'warning'
                                  ? 'text-secondary'
                                  : 'text-error'
                              }`}
                            />
                            <span className="text-xs font-bold text-on-surface font-mono">
                              public.{tbl.table}
                            </span>
                            <span className="text-[11px] text-secondary">
                              (coluna: {tbl.ownerColumn} • {tbl.ownRowCount}{' '}
                              {tbl.ownRowCount === 1 ? 'registro seu' : 'registros seus'})
                            </span>
                          </div>
                          <span
                            className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${
                              tbl.status === 'passed'
                                ? 'bg-primary/15 text-primary'
                                : tbl.status === 'warning'
                                ? 'bg-surface-container text-secondary'
                                : 'bg-error-container text-on-error-container'
                            }`}
                          >
                            {tbl.status === 'passed'
                              ? 'RLS Verificado'
                              : tbl.status === 'warning'
                              ? 'Conferir SQL'
                              : 'Ajuste Necessário'}
                          </span>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 text-[11px] text-secondary">
                          <div>
                            <strong className="text-on-surface">SELECT Anônimo:</strong>{' '}
                            {tbl.anonSelectBlocked.detailPT}
                          </div>
                          <div>
                            <strong className="text-on-surface">SELECT Autenticado:</strong>{' '}
                            {tbl.ownSelectIsolated.detailPT}
                          </div>
                          <div>
                            <strong className="text-on-surface">INSERT Outro Usuário:</strong>{' '}
                            {tbl.crossUserInsertBlocked.detailPT}
                          </div>
                          <div>
                            <strong className="text-on-surface">UPDATE / DELETE Externo:</strong>{' '}
                            {tbl.crossUserUpdateBlocked.passed && tbl.crossUserDeleteBlocked.passed
                              ? '0 linhas de terceiros afetadas (bloqueado).'
                              : `${tbl.crossUserUpdateBlocked.detailPT} | ${tbl.crossUserDeleteBlocked.detailPT}`}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* SQL Editor Verification & Optional Remediation Helpers */}
              <div className="pt-2 border-t border-surface-container space-y-2.5">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-on-surface">
                    Consultas para o SQL Editor do Supabase:
                  </span>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => setShowDiagnosticSql((v) => !v)}
                      className="px-3 py-1.5 rounded-lg bg-surface-container-low hover:bg-surface-container text-on-surface text-xs font-semibold cursor-pointer inline-flex items-center gap-1"
                    >
                      <Icon name="terminal" className="text-sm text-primary" />
                      <span>{showDiagnosticSql ? 'Ocultar SQL de Auditoria' : 'Ver SQL de Auditoria'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowRemediationSql((v) => !v)}
                      className="px-3 py-1.5 rounded-lg bg-surface-container-low hover:bg-surface-container text-secondary hover:text-on-surface text-xs font-semibold cursor-pointer inline-flex items-center gap-1"
                    >
                      <Icon name="build" className="text-sm text-primary" />
                      <span>{showRemediationSql ? 'Ocultar SQL Corretivo' : 'SQL Corretivo RLS'}</span>
                    </button>
                  </div>
                </div>

                {showDiagnosticSql && (
                  <div className="bg-surface-container-low rounded-xl p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold text-secondary">
                        Consulta somente leitura (pg_class + pg_policies):
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          void handleCopySql(SUPABASE_RLS_DIAGNOSTIC_SQL, 'SQL de auditoria')
                        }
                        className="text-xs font-bold text-primary hover:underline cursor-pointer inline-flex items-center gap-1"
                      >
                        <Icon name="content_copy" className="text-sm" />
                        <span>Copiar SQL</span>
                      </button>
                    </div>
                    <pre className="text-[11px] font-mono text-on-surface overflow-x-auto whitespace-pre-wrap bg-surface-container-lowest p-3 rounded-lg border border-surface-container max-h-56">
                      {SUPABASE_RLS_DIAGNOSTIC_SQL}
                    </pre>
                  </div>
                )}

                {showRemediationSql && (
                  <div className="bg-surface-container-low rounded-xl p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold text-secondary">
                        Aplicar somente se alguma tabela acusar ausência de política RLS:
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          void handleCopySql(SUPABASE_RLS_REMEDIATION_SQL, 'SQL corretivo de RLS')
                        }
                        className="text-xs font-bold text-primary hover:underline cursor-pointer inline-flex items-center gap-1"
                      >
                        <Icon name="content_copy" className="text-sm" />
                        <span>Copiar SQL Corretivo</span>
                      </button>
                    </div>
                    <pre className="text-[11px] font-mono text-on-surface overflow-x-auto whitespace-pre-wrap bg-surface-container-lowest p-3 rounded-lg border border-surface-container max-h-56">
                      {SUPABASE_RLS_REMEDIATION_SQL}
                    </pre>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Section 2: Personal Information Form (`public.profiles`) */}
          {activeTab === 'perfil' && (
            <form
              onSubmit={handleSave}
              className="bg-surface-container-lowest rounded-xl p-space-lg shadow-xs space-y-space-md"
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="space-y-0.5">
                  <h3 className="text-lg text-on-surface font-bold flex items-center gap-2">
                    <Icon name="badge" className="text-primary text-xl" />
                    <span>Dados Pessoais &amp; Perfil</span>
                  </h3>
                  <p className="text-xs text-secondary">
                    Edite seu nome completo. As alterações são salvas em{' '}
                    <code className="font-mono text-on-surface">public.profiles</code> no Supabase.
                  </p>
                </div>
                <span className="text-xs text-secondary font-medium">
                  * Campo obrigatório
                </span>
              </div>

              {profileFeedback && (
                <div
                  role="alert"
                  className={`p-3.5 rounded-xl text-xs font-semibold flex items-start justify-between gap-3 ${
                    profileFeedback.tone === 'success'
                      ? 'bg-primary-fixed/40 text-primary border border-primary/20'
                      : 'bg-error-container/60 text-on-error-container border border-error/20'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <Icon
                      name={profileFeedback.tone === 'success' ? 'check_circle' : 'error'}
                      className="text-base shrink-0 mt-0.5"
                    />
                    <span>{profileFeedback.message}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setProfileFeedback(null)}
                    className="opacity-75 hover:opacity-100 cursor-pointer shrink-0"
                    aria-label="Fechar mensagem"
                  >
                    <Icon name="close" className="text-sm" />
                  </button>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-space-md">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="profile-full-name"
                      className="block text-xs font-semibold text-on-surface-variant"
                    >
                      Nome Completo *
                    </label>
                    <span className="text-[11px] text-secondary">
                      Salvo em public.profiles
                    </span>
                  </div>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-outline flex items-center">
                      <Icon name="person" className="text-lg" />
                    </span>
                    <input
                      id="profile-full-name"
                      type="text"
                      required
                      minLength={2}
                      maxLength={120}
                      value={draft.name}
                      onChange={(e) => {
                        setDraft({ ...draft, name: e.target.value });
                        if (profileFeedback) setProfileFeedback(null);
                      }}
                      placeholder="Digite seu nome completo"
                      className="w-full bg-surface-container-low/70 text-on-surface text-sm pl-10 pr-space-md py-2.5 rounded-xl border border-transparent focus:border-primary/40 focus:outline-none focus:bg-surface-container-low transition-all"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="profile-auth-email"
                      className="block text-xs font-semibold text-on-surface-variant"
                    >
                      E-mail da Conta (Supabase Auth)
                    </label>
                    <span className="inline-flex items-center gap-1 text-primary text-xs font-semibold">
                      <Icon name="lock" className="text-xs" /> Autenticado
                    </span>
                  </div>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-outline flex items-center">
                      <Icon name="mail" className="text-lg" />
                    </span>
                    <input
                      id="profile-auth-email"
                      type="email"
                      readOnly
                      value={userProfile.email}
                      title="E-mail autenticado pelo Supabase Auth"
                      className="w-full bg-surface-container-low/40 text-on-surface-variant text-sm pl-10 pr-space-md py-2.5 rounded-xl border border-surface-container cursor-default focus:outline-none"
                    />
                  </div>
                  <p className="text-[11px] text-secondary">
                    Identificação oficial da sua conta autenticada no Supabase Auth.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="profile-phone"
                    className="block text-xs font-semibold text-on-surface-variant"
                  >
                    Telefone / WhatsApp (opcional)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-outline flex items-center">
                      <Icon name="phone_iphone" className="text-lg" />
                    </span>
                    <input
                      id="profile-phone"
                      type="tel"
                      value={draft.phone}
                      onChange={(e) => {
                        setDraft({ ...draft, phone: e.target.value });
                        if (profileFeedback) setProfileFeedback(null);
                      }}
                      placeholder="(00) 00000-0000"
                      className="w-full bg-surface-container-low/70 text-on-surface text-sm pl-10 pr-space-md py-2.5 rounded-xl border border-transparent focus:border-primary/40 focus:outline-none focus:bg-surface-container-low transition-all tabular-nums"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="profile-occupation"
                    className="block text-xs font-semibold text-on-surface-variant"
                  >
                    Profissão / Ocupação (opcional)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-outline flex items-center">
                      <Icon name="work" className="text-lg" />
                    </span>
                    <input
                      id="profile-occupation"
                      type="text"
                      value={draft.occupation}
                      onChange={(e) => {
                        setDraft({ ...draft, occupation: e.target.value });
                        if (profileFeedback) setProfileFeedback(null);
                      }}
                      placeholder="Ex.: Analista, Autônomo, Empresário..."
                      className="w-full bg-surface-container-low/70 text-on-surface text-sm pl-10 pr-space-md py-2.5 rounded-xl border border-transparent focus:border-primary/40 focus:outline-none focus:bg-surface-container-low transition-all"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-2 border-t border-surface-container flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <span className="text-xs text-secondary flex items-center gap-1.5">
                  <Icon
                    name={hasUnsavedChanges ? 'edit_note' : 'cloud_done'}
                    className="text-base text-primary"
                  />
                  {hasUnsavedChanges
                    ? 'Você possui alterações prontas para salvar no Supabase.'
                    : 'Dados sincronizados com seu perfil no Supabase.'}
                </span>

                <div className="flex items-center gap-2 self-end sm:self-auto">
                  {hasUnsavedChanges && (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={handleDiscard}
                      className="px-4 py-2 rounded-xl bg-surface-container-low hover:bg-surface-container text-on-surface text-xs font-semibold transition-all cursor-pointer disabled:opacity-50"
                    >
                      Descartar
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-5 py-2.5 rounded-xl bg-primary hover:bg-primary-container text-on-primary text-xs sm:text-sm font-bold transition-all shadow-2xs inline-flex items-center gap-2 cursor-pointer whitespace-nowrap disabled:opacity-60"
                  >
                    <Icon
                      name={saving ? 'progress_activity' : 'check'}
                      className={`text-base ${saving ? 'animate-spin' : ''}`}
                    />
                    <span>{saving ? 'Salvando no Supabase...' : 'Salvar Nome & Perfil'}</span>
                  </button>
                </div>
              </div>
            </form>
          )}

          {/* Section 3: Security & Password Change (`Supabase Auth`) */}
          {showAllOr('seguranca') && (
            <section
              ref={passwordSectionRef}
              className="bg-surface-container-lowest rounded-xl p-space-lg shadow-xs space-y-space-md"
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="space-y-0.5">
                  <h3 className="text-lg text-on-surface font-bold flex items-center gap-2">
                    <Icon name="shield_person" className="text-primary text-xl" />
                    <span>Segurança &amp; Alteração de Senha</span>
                  </h3>
                  <p className="text-xs text-secondary">
                    Atualize sua senha de acesso diretamente no Supabase Auth com validação imediata.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleFocusPasswordSection}
                  className="px-3.5 py-1.5 rounded-xl bg-surface-container-low hover:bg-surface-container text-on-surface text-xs font-semibold transition-all inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Icon name="key" className="text-sm text-primary" />
                  <span>Redefinir Senha</span>
                </button>
              </div>

              {/* Password Change Form */}
              <form
                onSubmit={handlePasswordSubmit}
                className="bg-surface-container-low/60 rounded-xl p-space-md space-y-4 border border-surface-container"
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                      <Icon name="lock_reset" className="text-lg" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-on-surface">Alterar Senha da Conta</h4>
                      <p className="text-xs text-secondary">
                        Defina uma nova senha segura e confirme antes de salvar.
                      </p>
                    </div>
                  </div>
                </div>

                {passwordFeedback && (
                  <div
                    role="alert"
                    className={`p-3 rounded-xl text-xs font-semibold flex items-start justify-between gap-3 ${
                      passwordFeedback.tone === 'success'
                        ? 'bg-primary-fixed/40 text-primary border border-primary/20'
                        : 'bg-error-container/60 text-on-error-container border border-error/20'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <Icon
                        name={passwordFeedback.tone === 'success' ? 'check_circle' : 'error'}
                        className="text-base shrink-0 mt-0.5"
                      />
                      <span>{passwordFeedback.message}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPasswordFeedback(null)}
                      className="opacity-75 hover:opacity-100 cursor-pointer shrink-0"
                      aria-label="Fechar aviso de senha"
                    >
                      <Icon name="close" className="text-sm" />
                    </button>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-space-md">
                  <div className="space-y-1.5">
                    <label
                      htmlFor="new-password-input"
                      className="block text-xs font-semibold text-on-surface-variant"
                    >
                      Nova Senha *
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-outline flex items-center">
                        <Icon name="lock" className="text-lg" />
                      </span>
                      <input
                        ref={passwordInputRef}
                        id="new-password-input"
                        type={showNewPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        value={newPassword}
                        onChange={(e) => {
                          setNewPassword(e.target.value);
                          if (passwordFeedback) setPasswordFeedback(null);
                        }}
                        placeholder="Mínimo de 6 caracteres"
                        className="w-full bg-surface-container-lowest text-on-surface text-sm pl-10 pr-10 py-2.5 rounded-xl border border-surface-container focus:border-primary/40 focus:outline-none transition-all"
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPassword((v) => !v)}
                        aria-label={showNewPassword ? 'Ocultar nova senha' : 'Mostrar nova senha'}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-secondary hover:text-on-surface p-1 cursor-pointer"
                      >
                        <Icon
                          name={showNewPassword ? 'visibility_off' : 'visibility'}
                          className="text-base"
                        />
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label
                      htmlFor="confirm-password-input"
                      className="block text-xs font-semibold text-on-surface-variant"
                    >
                      Confirmar Nova Senha *
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-outline flex items-center">
                        <Icon name="verified_user" className="text-lg" />
                      </span>
                      <input
                        id="confirm-password-input"
                        type={showConfirmPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        value={confirmNewPassword}
                        onChange={(e) => {
                          setConfirmNewPassword(e.target.value);
                          if (passwordFeedback) setPasswordFeedback(null);
                        }}
                        placeholder="Repita a nova senha"
                        className="w-full bg-surface-container-lowest text-on-surface text-sm pl-10 pr-10 py-2.5 rounded-xl border border-surface-container focus:border-primary/40 focus:outline-none transition-all"
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword((v) => !v)}
                        aria-label={
                          showConfirmPassword
                            ? 'Ocultar confirmação de senha'
                            : 'Mostrar confirmação de senha'
                        }
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-secondary hover:text-on-surface p-1 cursor-pointer"
                      >
                        <Icon
                          name={showConfirmPassword ? 'visibility_off' : 'visibility'}
                          className="text-base"
                        />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Live Password Validation Indicators & Submit */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                  <div className="flex items-center gap-3 flex-wrap text-xs">
                    <span
                      className={`inline-flex items-center gap-1 font-medium ${
                        newPassword.length === 0
                          ? 'text-secondary'
                          : passwordMinLengthMet
                          ? 'text-primary font-semibold'
                          : 'text-error font-semibold'
                      }`}
                    >
                      <Icon
                        name={passwordMinLengthMet ? 'check_circle' : 'radio_button_unchecked'}
                        className="text-sm"
                      />
                      Mínimo de 6 caracteres
                    </span>

                    <span
                      className={`inline-flex items-center gap-1 font-medium ${
                        confirmNewPassword.length === 0
                          ? 'text-secondary'
                          : passwordsMatch
                          ? 'text-primary font-semibold'
                          : 'text-error font-semibold'
                      }`}
                    >
                      <Icon
                        name={
                          confirmNewPassword.length === 0
                            ? 'radio_button_unchecked'
                            : passwordsMatch
                            ? 'check_circle'
                            : 'cancel'
                        }
                        className="text-sm"
                      />
                      {confirmNewPassword.length > 0 && !passwordsMatch
                        ? 'As senhas não coincidem'
                        : 'Confirmação coincide'}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-auto">
                    {(newPassword.length > 0 || confirmNewPassword.length > 0) && (
                      <button
                        type="button"
                        disabled={updatingPassword}
                        onClick={() => {
                          setNewPassword('');
                          setConfirmNewPassword('');
                          setPasswordFeedback(null);
                        }}
                        className="px-3.5 py-2 rounded-xl text-xs font-semibold text-secondary hover:bg-surface-container cursor-pointer"
                      >
                        Limpar
                      </button>
                    )}
                    <button
                      type="submit"
                      disabled={updatingPassword}
                      className="px-4 py-2.5 rounded-xl bg-primary hover:bg-primary-container text-on-primary text-xs sm:text-sm font-bold transition-all shadow-2xs cursor-pointer inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-60"
                    >
                      <Icon
                        name={updatingPassword ? 'progress_activity' : 'lock_reset'}
                        className={`text-base ${updatingPassword ? 'animate-spin' : ''}`}
                      />
                      <span>{updatingPassword ? 'Atualizando Senha...' : 'Atualizar Senha'}</span>
                    </button>
                  </div>
                </div>
              </form>

              {/* Active Authenticated Session */}
              <div className="space-y-2 pt-1">
                <h4 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">
                  Sessão Autenticada Atual
                </h4>
                <div className="space-y-2">
                  {sessions.map((s) => (
                    <div
                      key={s.id}
                      className="bg-surface-container-low p-space-md rounded-xl flex items-center justify-between gap-space-md"
                    >
                      <div className="flex items-center gap-space-md min-w-0">
                        <div className="w-9 h-9 rounded-lg bg-surface-container-lowest flex items-center justify-center shadow-2xs text-primary shrink-0">
                          <Icon name={s.icon} className="text-xl" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm text-on-surface font-semibold">
                              {s.device}
                            </span>
                            <span className="text-xs text-primary font-semibold">
                              · {s.versionOrBadge}
                            </span>
                          </div>
                          <p className="text-xs text-secondary truncate">{s.locationAndIp}</p>
                        </div>
                      </div>

                      <Icon
                        name="verified_user"
                        className="text-primary text-xl shrink-0"
                        title="Sessão verificada pelo Supabase Auth"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* Section 4: Financial App Preferences */}
          {showAllOr('preferencias', 'notificacoes') && (
            <section className="bg-surface-container-lowest rounded-xl p-space-lg shadow-xs space-y-space-md">
              <div className="space-y-0.5">
                <h3 className="text-lg text-on-surface font-bold flex items-center gap-2">
                  <Icon name="account_balance_wallet" className="text-primary text-xl" />
                  <span>Preferências Financeiras &amp; Alertas</span>
                </h3>
                <p className="text-xs text-secondary">
                  Defina convenções numéricas, períodos fiscais e parâmetros de alerta de gastos.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-space-md pt-1">
                <div className="bg-surface-container-low p-space-md rounded-xl space-y-2">
                  <div className="flex items-center justify-between text-secondary">
                    <span className="text-xs font-semibold">Moeda Padrão</span>
                    <Icon name="payments" className="text-base" />
                  </div>
                  <select
                    value={draft.currency}
                    onChange={(e) => setDraft({ ...draft, currency: e.target.value })}
                    className="w-full bg-surface-container-lowest text-on-surface text-xs font-semibold py-2 px-2.5 rounded-lg shadow-2xs focus:outline-none cursor-pointer"
                  >
                    <option>Real Brasileiro (BRL - R$)</option>
                    <option>Dólar Americano (USD - $)</option>
                    <option>Euro (EUR - €)</option>
                  </select>
                  <p className="text-[11px] text-secondary">
                    Convenção monetária aplicada nos relatórios.
                  </p>
                </div>

                <div className="bg-surface-container-low p-space-md rounded-xl space-y-2">
                  <div className="flex items-center justify-between text-secondary">
                    <span className="text-xs font-semibold">Início do Mês Fiscal</span>
                    <Icon name="event_repeat" className="text-base" />
                  </div>
                  <select
                    value={draft.fiscalMonthStart}
                    onChange={(e) => setDraft({ ...draft, fiscalMonthStart: e.target.value })}
                    className="w-full bg-surface-container-lowest text-on-surface text-xs font-semibold py-2 px-2.5 rounded-lg shadow-2xs focus:outline-none cursor-pointer"
                  >
                    <option>Dia 01 (Padrão)</option>
                    <option>Dia 05 (Quinto dia útil)</option>
                    <option>Dia 10 (Salário/Pró-labore)</option>
                    <option>Dia 25 (Fechamento cartão)</option>
                  </select>
                  <p className="text-[11px] text-secondary">
                    Determina o ciclo de cálculos dos orçamentos mensais.
                  </p>
                </div>

                <div className="bg-surface-container-low p-space-md rounded-xl space-y-2">
                  <div className="flex items-center justify-between text-secondary">
                    <span className="text-xs font-semibold">Formato de Data</span>
                    <Icon name="calendar_month" className="text-base" />
                  </div>
                  <select
                    value={draft.dateFormat}
                    onChange={(e) => setDraft({ ...draft, dateFormat: e.target.value })}
                    className="w-full bg-surface-container-lowest text-on-surface text-xs font-semibold py-2 px-2.5 rounded-lg shadow-2xs focus:outline-none cursor-pointer"
                  >
                    <option>DD/MM/AAAA (Brasil)</option>
                    <option>AAAA-MM-DD (ISO 8601)</option>
                    <option>MM/DD/AAAA (EUA)</option>
                  </select>
                  <p className="text-[11px] text-secondary">
                    Exibição uniforme em extratos e conciliações.
                  </p>
                </div>
              </div>

              {/* Budget Ceiling Toggle */}
              <div className="bg-surface-container-low/70 rounded-xl p-space-md flex items-center justify-between gap-space-md">
                <div className="flex items-start gap-space-md">
                  <div className="w-10 h-10 rounded-xl bg-primary-container/20 text-primary flex items-center justify-center shrink-0">
                    <Icon name="speed" className="text-xl" />
                  </div>
                  <div>
                    <h4 className="text-sm text-on-surface font-bold">
                      Teto de Gastos / Alerta Orçamentário Antecipado
                    </h4>
                    <p className="text-xs text-secondary">
                      Alertar quando qualquer categoria atingir{' '}
                      <strong>80% do teto estipulado</strong>.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={draft.budgetCeilingAlert}
                  onClick={() =>
                    setDraft({ ...draft, budgetCeilingAlert: !draft.budgetCeilingAlert })
                  }
                  className={`relative w-11 h-6 rounded-full transition-colors shrink-0 cursor-pointer ${
                    draft.budgetCeilingAlert ? 'bg-primary' : 'bg-secondary-container'
                  }`}
                >
                  <span
                    className={`absolute top-[2px] left-[2px] bg-white rounded-full h-5 w-5 transition-transform ${
                      draft.budgetCeilingAlert ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {activeTab === 'notificacoes' && (
                <div className="space-y-2.5 pt-1">
                  <div className="bg-surface-container-low/70 rounded-xl p-space-md flex items-center justify-between gap-4">
                    <div>
                      <h4 className="text-sm text-on-surface font-bold">
                        Resumo Diário de Vencimentos
                      </h4>
                      <p className="text-xs text-secondary">
                        Destaque visual das movimentações pendentes no painel de notificações.
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={whatsappAlerts}
                      onClick={() => setWhatsappAlerts((v) => !v)}
                      className={`relative w-11 h-6 rounded-full transition-colors shrink-0 cursor-pointer ${
                        whatsappAlerts ? 'bg-primary' : 'bg-secondary-container'
                      }`}
                    >
                      <span
                        className={`absolute top-[2px] left-[2px] bg-white rounded-full h-5 w-5 transition-transform ${
                          whatsappAlerts ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>

                  <div className="bg-surface-container-low/70 rounded-xl p-space-md flex items-center justify-between gap-4">
                    <div>
                      <h4 className="text-sm text-on-surface font-bold">
                        Alertas de Progresso de Metas
                      </h4>
                      <p className="text-xs text-secondary">
                        Acompanhamento de evolução das metas financeiras cadastradas.
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={weeklyDigest}
                      onClick={() => setWeeklyDigest((v) => !v)}
                      className={`relative w-11 h-6 rounded-full transition-colors shrink-0 cursor-pointer ${
                        weeklyDigest ? 'bg-primary' : 'bg-secondary-container'
                      }`}
                    >
                      <span
                        className={`absolute top-[2px] left-[2px] bg-white rounded-full h-5 w-5 transition-transform ${
                          weeklyDigest ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Section 5: Data Portability & Account Logout */}
          <section className="bg-surface-container-lowest rounded-xl p-space-lg shadow-xs flex flex-col sm:flex-row items-center justify-between gap-space-md">
            <div className="space-y-1 text-center sm:text-left">
              <div className="flex items-center gap-2 justify-center sm:justify-start">
                <Icon name="logout" className="text-primary text-lg" />
                <h4 className="text-sm text-on-surface font-bold">
                  Portabilidade &amp; Encerramento de Sessão
                </h4>
              </div>
              <p className="text-xs text-secondary">
                Seus dados são sincronizados e protegidos diretamente no Supabase. Exporte em CSV ou encerre a sessão com segurança.
              </p>
            </div>

            <div className="flex items-center gap-2 flex-wrap justify-center sm:justify-end">
              <button
                type="button"
                onClick={onExportCsv}
                className="px-3.5 py-2 rounded-xl bg-surface-container-low hover:bg-surface-container text-on-surface text-xs font-semibold transition-all inline-flex items-center gap-1.5 shadow-2xs cursor-pointer whitespace-nowrap"
              >
                <Icon name="table_chart" className="text-base text-primary" />
                <span>Exportar Extrato CSV</span>
              </button>
              <button
                type="button"
                onClick={handleSignOutClick}
                disabled={signingOut}
                className="px-4 py-2 rounded-xl bg-error-container/50 hover:bg-error-container text-on-error-container text-xs font-bold transition-all inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap disabled:opacity-60"
              >
                <Icon
                  name={signingOut ? 'progress_activity' : 'logout'}
                  className={`text-base ${signingOut ? 'animate-spin' : ''}`}
                />
                <span>{signingOut ? 'Encerrando...' : 'Sair da Conta'}</span>
              </button>
            </div>
          </section>

          {/* Bottom Save Bar */}
          <div className="bg-surface-container-lowest rounded-xl p-space-md shadow-xs flex flex-col sm:flex-row items-center justify-between gap-space-md">
            <div className="flex items-center gap-2 text-secondary">
              <Icon name="info" className="text-lg text-primary" />
              <span className="text-xs">
                {isSupabaseConnected
                  ? 'As alterações de perfil são salvas diretamente na tabela public.profiles do Supabase.'
                  : 'Conecte o Supabase para sincronizar suas alterações na nuvem.'}
              </span>
            </div>
            <div className="flex items-center gap-space-sm">
              <button
                type="button"
                disabled={saving || !hasUnsavedChanges}
                onClick={handleDiscard}
                className="px-space-lg py-2.5 rounded-xl bg-surface-container-low hover:bg-surface-container text-on-surface text-sm font-semibold transition-all cursor-pointer disabled:opacity-50"
              >
                Descartar
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving}
                className="px-space-xl py-2.5 rounded-xl bg-primary hover:bg-primary-container text-on-primary text-sm font-bold transition-all shadow-sm inline-flex items-center gap-2 cursor-pointer whitespace-nowrap disabled:opacity-60"
              >
                <Icon
                  name={saving ? 'progress_activity' : 'check'}
                  className={`text-lg ${saving ? 'animate-spin' : ''}`}
                />
                <span>{saving ? 'Salvando...' : 'Salvar Alterações'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Real Authenticated Account Summary & System Status (4 Cols) */}
        <div className="xl:col-span-4 space-y-space-lg">
          {/* Real Authenticated Profile Summary Card (Zero Fictional Data) */}
          <div className="bg-gradient-to-br from-primary to-primary-container text-on-primary rounded-xl p-space-lg shadow-md relative overflow-hidden">
            <div className="absolute -right-6 -bottom-6 w-36 h-36 bg-primary-fixed-dim/20 rounded-full blur-2xl pointer-events-none" />
            <div className="flex items-center justify-between mb-space-md relative z-10">
              <span className="text-xs font-bold tracking-wider uppercase text-on-primary/90">
                Resumo da Conta
              </span>
              <Icon name="verified_user" className="text-2xl text-primary-fixed" />
            </div>
            <h3 className="text-xl font-bold leading-tight mb-1 relative z-10 truncate">
              {userProfile.name}
            </h3>
            <p className="text-xs text-on-primary/85 mb-space-lg relative z-10 leading-relaxed truncate">
              {userProfile.email}
            </p>
            <div className="bg-black/15 rounded-xl p-space-md mb-space-md space-y-2 relative z-10 text-xs tabular-nums">
              <div className="flex justify-between gap-2">
                <span>Membro desde</span>
                <span className="font-semibold text-right">{userProfile.memberSince}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span>Contas cadastradas</span>
                <span className="font-semibold">
                  {accounts.length} {accounts.length === 1 ? 'conta' : 'contas'}
                </span>
              </div>
              <div className="flex justify-between gap-2 text-on-primary/90">
                <span>Segurança</span>
                <span className="font-semibold">
                  {isSupabaseConnected ? 'Supabase Auth + RLS' : 'Modo Local'}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={handleFocusPasswordSection}
              className="w-full py-2.5 rounded-xl bg-on-primary text-primary text-sm font-bold hover:bg-surface-container-high transition-all shadow-2xs cursor-pointer inline-flex items-center justify-center gap-1.5"
            >
              <Icon name="key" className="text-base" />
              <span>Alterar Senha de Acesso</span>
            </button>
          </div>

          {/* Account Security & RLS Diagnostics (Honest Live Client + Audit State) */}
          <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-xs space-y-space-md">
            <div className="flex items-center justify-between">
              <h4 className="text-sm text-on-surface font-bold flex items-center gap-1.5">
                <Icon name="verified" className="text-primary text-lg" />
                <span>Segurança &amp; Privacidade</span>
              </h4>
              <span className="text-xs text-primary font-bold tabular-nums">
                {auditReport
                  ? auditReport.overallStatus === 'passed'
                    ? 'RLS Verificado'
                    : 'Revisar RLS'
                  : isSupabaseConnected
                  ? 'Conectado'
                  : 'Local'}
              </span>
            </div>

            <div className="space-y-2 pt-1 text-xs">
              <div className="flex items-center gap-2 text-on-surface">
                <Icon
                  name={!clientPosture.hasSecretKeyExposed ? 'check_circle' : 'error'}
                  className={`text-base shrink-0 ${
                    !clientPosture.hasSecretKeyExposed ? 'text-primary' : 'text-error'
                  }`}
                />
                <span>
                  {!clientPosture.hasSecretKeyExposed
                    ? `${clientPosture.publicKeyKind} (sem service_role)`
                    : 'Chave secreta detectada e bloqueada'}
                </span>
              </div>
              <div className="flex items-center gap-2 text-on-surface">
                <Icon name="check_circle" className="text-base text-primary shrink-0" />
                <span>Consultas filtradas por auth.uid() no cliente</span>
              </div>
              <div className="flex items-center gap-2 text-on-surface">
                <Icon
                  name={
                    auditReport?.overallStatus === 'passed'
                      ? 'check_circle'
                      : auditReport
                      ? 'warning'
                      : 'radio_button_unchecked'
                  }
                  className={`text-base shrink-0 ${
                    auditReport?.overallStatus === 'passed'
                      ? 'text-primary'
                      : auditReport
                      ? 'text-error'
                      : 'text-outline'
                  }`}
                />
                <span>
                  {auditReport
                    ? auditReport.overallStatus === 'passed'
                      ? '5 tabelas auditadas com RLS ativo'
                      : 'Auditoria executada: confira os detalhes'
                    : 'Auditoria RLS ao vivo pronta para execução'}
                </span>
              </div>
              <div className="flex items-center gap-2 text-secondary">
                <Icon
                  name={isSupabaseConnected ? 'check_circle' : 'radio_button_unchecked'}
                  className={`text-base shrink-0 ${
                    isSupabaseConnected ? 'text-primary' : 'text-outline'
                  }`}
                />
                <span>
                  {isSupabaseConnected
                    ? 'Sessão autenticada pelo Supabase Auth'
                    : 'Variáveis VITE_SUPABASE_* pendentes'}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setActiveTab('openfinance')}
              className="w-full py-2 rounded-xl bg-surface-container-low hover:bg-surface-container text-on-surface text-xs font-semibold transition-all inline-flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Icon name="policy" className="text-sm text-primary" />
              <span>Abrir Auditoria Supabase &amp; RLS</span>
            </button>
          </div>

          {/* Registered Accounts Live Card */}
          <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-xs space-y-space-md">
            <div className="flex items-center justify-between">
              <h4 className="text-sm text-on-surface font-bold flex items-center gap-1.5">
                <Icon name="account_balance" className="text-primary text-lg" />
                <span>Contas Cadastradas</span>
              </h4>
              <span className="text-xs text-primary font-semibold tabular-nums">
                {accounts.length} {accounts.length === 1 ? 'Ativa' : 'Ativas'}
              </span>
            </div>

            {accounts.length === 0 ? (
              <div className="p-4 rounded-xl bg-surface-container-low text-center space-y-1">
                <p className="text-xs font-semibold text-on-surface">
                  Nenhuma conta cadastrada ainda
                </p>
                <p className="text-[11px] text-secondary">
                  Crie suas contas e carteiras para acompanhar seus saldos reais.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {accounts.slice(0, 4).map((acc) => (
                  <div
                    key={acc.id}
                    className="flex items-center justify-between p-2.5 rounded-xl bg-surface-container-low"
                  >
                    <div className="min-w-0 pr-2">
                      <p className="text-xs font-semibold text-on-surface truncate">{acc.name}</p>
                      <p className="text-[11px] text-secondary truncate">{acc.badgeText}</p>
                    </div>
                    <span className="text-xs text-primary font-semibold tabular-nums shrink-0">
                      {formatBRL(acc.balance)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={() => onNavigate('contas')}
              className="w-full py-2 rounded-xl bg-surface-container-low hover:bg-surface-container text-on-surface text-xs font-semibold transition-all inline-flex items-center justify-center gap-1 cursor-pointer"
            >
              <Icon name="account_balance_wallet" className="text-sm" />
              <span>Gerenciar Contas &amp; Carteiras</span>
            </button>
          </div>

          {/* Quick Tips Card */}
          <div className="bg-surface-container-low rounded-xl p-space-md space-y-2">
            <div className="flex items-center gap-2 text-primary text-xs font-bold">
              <Icon name="lightbulb" className="text-base" />
              <span>Dica de Segurança</span>
            </div>
            <p className="text-xs text-secondary leading-relaxed">
              Ao usar um computador compartilhado, utilize sempre o botão{' '}
              <strong>Sair da Conta</strong> ao finalizar o acesso para encerrar imediatamente sua
              sessão no Supabase Auth.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
