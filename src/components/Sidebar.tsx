import React, { useState } from 'react';
import { DataSourceMode, ScreenId, UserProfile } from '../types/finance';
import { BrandLogo, Icon, SafeAvatar } from './Icon';

interface SidebarProps {
  activeScreen: ScreenId;
  onNavigate: (screen: ScreenId) => void;
  onOpenNewTransaction: () => void;
  onSignOut: () => void;
  forceMobilePreview: boolean;
  dataSourceMode: DataSourceMode;
  totalRecordsCount: number;
  userProfile?: UserProfile;
}

interface NavItem {
  id: ScreenId;
  label: string;
  icon: string;
}

export const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { id: 'movimentacoes', label: 'Movimentações', icon: 'receipt_long' },
  { id: 'categorias', label: 'Categorias', icon: 'category' },
  { id: 'contas', label: 'Contas & Carteiras', icon: 'account_balance_wallet' },
  { id: 'metas', label: 'Metas', icon: 'track_changes' },
  { id: 'relatorios', label: 'Relatórios', icon: 'bar_chart' },
  { id: 'configuracoes', label: 'Configurações', icon: 'settings' },
];

export const Sidebar: React.FC<SidebarProps> = ({
  activeScreen,
  onNavigate,
  onOpenNewTransaction,
  onSignOut,
  forceMobilePreview,
  dataSourceMode,
  totalRecordsCount,
  userProfile,
}) => {
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [supportModalOpen, setSupportModalOpen] = useState(false);

  const capacityPct =
    totalRecordsCount === 0
      ? 0
      : Math.min(100, Math.max(8, Math.round((totalRecordsCount / 250) * 100)));

  return (
    <>
      {/* Desktop Sidebar */}
      {!forceMobilePreview && (
        <aside className="hidden lg:flex fixed left-0 top-0 h-full w-64 bg-surface-container-lowest border-r border-surface-container z-40 flex-col justify-between">
          <div className="flex flex-col flex-1 overflow-y-auto">
            {/* Brand Zone */}
            <button
              type="button"
              onClick={() => onNavigate('dashboard')}
              className="h-16 px-gutter flex items-center gap-space-sm text-left cursor-pointer hover:opacity-90 transition-opacity"
            >
              <BrandLogo />
              <span className="text-[18px] leading-6 text-on-surface tracking-tight font-bold whitespace-nowrap">
                FinanCerto
              </span>
            </button>

            {/* Primary Nav */}
            <nav className="px-space-md py-space-sm space-y-1 flex-1" aria-label="Navegação Principal">
              {NAV_ITEMS.map((item) => {
                const isActive = activeScreen === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onNavigate(item.id)}
                    aria-current={isActive ? 'page' : undefined}
                    className={`w-full flex items-center gap-space-sm px-space-md py-2.5 rounded-xl text-[14px] leading-5 transition-all cursor-pointer whitespace-nowrap ${
                      isActive
                        ? 'bg-primary-container text-on-primary-container font-semibold shadow-xs'
                        : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface font-medium'
                    }`}
                  >
                    <Icon name={item.icon} className="text-[20px]" filled={isActive} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Bottom User Identity, Storage, Support & Logout */}
          <div className="p-space-md space-y-1.5 bg-surface-container-lowest border-t border-surface-container/60">
            {userProfile && (
              <button
                type="button"
                onClick={() => onNavigate('configuracoes')}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl hover:bg-surface-container-low transition-colors text-left cursor-pointer mb-1"
                title="Gerenciar Perfil e Conta"
              >
                <SafeAvatar
                  src={userProfile.avatarHeaderUrl}
                  name={userProfile.name}
                  className="w-8 h-8 text-xs shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-on-surface truncate leading-tight">
                    {userProfile.name}
                  </p>
                  <p className="text-[11px] text-secondary truncate leading-tight">
                    {userProfile.email}
                  </p>
                </div>
                <Icon name="chevron_right" className="text-sm text-outline-variant shrink-0" />
              </button>
            )}
            <div className="bg-surface-container-low rounded-xl p-space-md mb-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-on-surface-variant flex items-center gap-1.5">
                  <Icon
                    name={dataSourceMode === 'supabase' ? 'cloud_done' : 'database'}
                    className="text-sm text-primary"
                  />
                  {dataSourceMode === 'supabase' ? 'Supabase Ativo' : 'Dados Locais'}
                </span>
                <span className="text-xs text-on-surface font-bold tabular-nums">
                  {totalRecordsCount} reg.
                </span>
              </div>
              <div className="w-full h-1.5 bg-surface-container rounded-full overflow-hidden mb-1.5">
                <div
                  className="h-full bg-primary rounded-full transition-all"
                  style={{ width: `${capacityPct}%` }}
                />
              </div>
              <p className="text-xs text-secondary">
                {dataSourceMode === 'supabase'
                  ? 'Protegido por RLS por usuário'
                  : 'Sessão local'}
              </p>
            </div>

            <button
              type="button"
              onClick={() => setSupportModalOpen(true)}
              className="w-full flex items-center justify-between px-space-md py-2 rounded-xl text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface transition-all cursor-pointer"
            >
              <span className="flex items-center gap-space-sm text-[14px] font-medium">
                <Icon name="support_agent" className="text-lg" />
                Ajuda &amp; Suporte
              </span>
              <Icon name="chevron_right" className="text-sm text-outline-variant" />
            </button>

            <button
              type="button"
              onClick={onSignOut}
              className="w-full flex items-center justify-between px-space-md py-2 rounded-xl text-error hover:bg-error-container/50 transition-all cursor-pointer"
            >
              <span className="flex items-center gap-space-sm text-[14px] font-semibold">
                <Icon name="logout" className="text-lg" />
                Sair da Conta
              </span>
            </button>
          </div>
        </aside>
      )}

      {/* Mobile Bottom Tab Bar */}
      <nav
        aria-label="Navegação Mobile"
        className={`${
          forceMobilePreview
            ? 'flex max-w-[430px] mx-auto left-0 right-0'
            : 'lg:hidden flex left-0 right-0'
        } fixed bottom-0 z-40 bg-surface-container-lowest/95 backdrop-blur-xl border-t border-surface-container shadow-[0_-1px_12px_rgba(0,0,0,0.05)]`}
      >
        <div className="relative flex justify-around items-center h-16 w-full px-1">
          <button
            type="button"
            onClick={() => {
              setMobileMoreOpen(false);
              onNavigate('dashboard');
            }}
            className={`flex flex-col items-center justify-center min-w-[56px] min-h-[44px] p-1 transition-colors cursor-pointer ${
              activeScreen === 'dashboard' ? 'text-primary font-semibold' : 'text-on-surface-variant'
            }`}
          >
            <Icon name="dashboard" className="text-[22px]" filled={activeScreen === 'dashboard'} />
            <span className="text-[11px] mt-0.5">Início</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setMobileMoreOpen(false);
              onNavigate('movimentacoes');
            }}
            className={`flex flex-col items-center justify-center min-w-[56px] min-h-[44px] p-1 transition-colors cursor-pointer ${
              activeScreen === 'movimentacoes'
                ? 'text-primary font-semibold'
                : 'text-on-surface-variant'
            }`}
          >
            <Icon
              name="receipt_long"
              className="text-[22px]"
              filled={activeScreen === 'movimentacoes'}
            />
            <span className="text-[11px] mt-0.5">Extrato</span>
          </button>

          <div className="relative flex items-center justify-center min-w-[56px] min-h-[44px]">
            <button
              type="button"
              onClick={onOpenNewTransaction}
              aria-label="Adicionar Transação"
              className="w-12 h-12 -mt-5 rounded-full bg-primary text-on-primary shadow-lg shadow-primary/30 flex items-center justify-center hover:bg-primary-container active:scale-95 transition-all cursor-pointer"
            >
              <Icon name="add" className="text-[26px]" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              setMobileMoreOpen(false);
              onNavigate('metas');
            }}
            className={`flex flex-col items-center justify-center min-w-[56px] min-h-[44px] p-1 transition-colors cursor-pointer ${
              activeScreen === 'metas' ? 'text-primary font-semibold' : 'text-on-surface-variant'
            }`}
          >
            <Icon name="track_changes" className="text-[22px]" filled={activeScreen === 'metas'} />
            <span className="text-[11px] mt-0.5">Metas</span>
          </button>

          <button
            type="button"
            onClick={() => setMobileMoreOpen((v) => !v)}
            className={`flex flex-col items-center justify-center min-w-[56px] min-h-[44px] p-1 transition-colors cursor-pointer ${
              ['categorias', 'contas', 'relatorios', 'configuracoes'].includes(activeScreen) ||
              mobileMoreOpen
                ? 'text-primary font-semibold'
                : 'text-on-surface-variant'
            }`}
          >
            <Icon name="menu" className="text-[22px]" />
            <span className="text-[11px] mt-0.5">Mais</span>
          </button>
        </div>
      </nav>

      {/* Mobile "Mais" Drawer */}
      {mobileMoreOpen && (
        <div
          className="fixed inset-0 z-50 bg-inverse-surface/40 backdrop-blur-xs flex items-end justify-center"
          onClick={() => setMobileMoreOpen(false)}
        >
          <div
            className="w-full max-w-[430px] bg-surface-container-lowest rounded-t-3xl p-space-lg shadow-2xl space-y-space-sm pb-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-12 h-1.5 bg-outline-variant rounded-full mx-auto mb-2" />
            <div className="flex items-center justify-between pb-2">
              <span className="text-base font-bold text-on-surface">Mais Módulos FinanCerto</span>
              <button
                type="button"
                onClick={() => setMobileMoreOpen(false)}
                className="w-8 h-8 rounded-full bg-surface-container flex items-center justify-center text-on-surface-variant"
              >
                <Icon name="close" className="text-lg" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              {NAV_ITEMS.map((item) => {
                const active = activeScreen === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      onNavigate(item.id);
                      setMobileMoreOpen(false);
                    }}
                    className={`flex items-center gap-2.5 p-3 rounded-xl text-left transition-all cursor-pointer ${
                      active
                        ? 'bg-primary-container text-on-primary-container font-semibold'
                        : 'bg-surface-container-low text-on-surface hover:bg-surface-container font-medium'
                    }`}
                  >
                    <Icon name={item.icon} className="text-xl" />
                    <span className="text-sm truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="pt-2 border-t border-surface-container">
              <button
                type="button"
                onClick={() => {
                  setMobileMoreOpen(false);
                  onSignOut();
                }}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-error-container/60 text-error text-sm font-bold cursor-pointer"
              >
                <Icon name="logout" className="text-lg" />
                <span>Sair da Conta</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Ajuda & Suporte Modal */}
      {supportModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-inverse-surface/40 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setSupportModalOpen(false)}
        >
          <div
            className="bg-surface-container-lowest rounded-2xl max-w-md w-full p-space-lg shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-primary-fixed/40 text-primary flex items-center justify-center">
                  <Icon name="support_agent" className="text-2xl" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-on-surface">Central de Ajuda FinanCerto</h3>
                  <p className="text-xs text-secondary">Guia rápido de operação e atalhos</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSupportModalOpen(false)}
                className="w-8 h-8 rounded-lg hover:bg-surface-container-low flex items-center justify-center text-secondary cursor-pointer"
              >
                <Icon name="close" className="text-lg" />
              </button>
            </div>

            <div className="space-y-2.5 text-sm">
              <div className="p-3 rounded-xl bg-surface-container-low">
                <p className="font-semibold text-on-surface">Atalho Rápido de Busca</p>
                <p className="text-xs text-secondary mt-0.5">
                  Na tela de Movimentações, pressione{' '}
                  <kbd className="px-1.5 py-0.5 bg-surface-container rounded font-mono text-[11px]">
                    /
                  </kbd>{' '}
                  para focar na busca instantânea.
                </p>
              </div>
              <div className="p-3 rounded-xl bg-surface-container-low">
                <p className="font-semibold text-on-surface">Segurança &amp; Privacidade (RLS)</p>
                <p className="text-xs text-secondary mt-0.5">
                  Todos os seus dados são isolados na sua conta através do Supabase Auth e políticas Row Level Security no PostgreSQL.
                </p>
              </div>
              <div className="p-3 rounded-xl bg-primary/8 text-on-surface flex items-center justify-between">
                <div>
                  <p className="font-semibold text-primary text-xs uppercase tracking-wider">
                    Sincronização em Nuvem (Supabase)
                  </p>
                  <p className="text-xs text-secondary mt-0.5">
                    Dados 100% persistidos no Supabase com exportação de extrato em CSV a qualquer momento.
                  </p>
                </div>
                <Icon name="cloud_done" className="text-primary text-xl" />
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={() => setSupportModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-primary text-on-primary text-sm font-semibold hover:bg-primary-container transition-colors cursor-pointer"
              >
                Entendi
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
