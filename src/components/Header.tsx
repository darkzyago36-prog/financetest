import React, { useState, useRef, useEffect } from 'react';
import { NotificationItem, ScreenId, UserProfile } from '../types/finance';
import { BrandLogo, Icon, SafeAvatar } from './Icon';
import { NAV_ITEMS } from './Sidebar';

interface HeaderProps {
  activeScreen: ScreenId;
  availableMonths: string[];
  selectedMonth: string;
  onSelectMonthByIndex: (index: number) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onResetCurrentMonth: () => void;
  onOpenNewTransaction: () => void;
  onNavigate: (screen: ScreenId) => void;
  onSignOut: () => void;
  userProfile: UserProfile;
  notifications: NotificationItem[];
  onMarkAllRead: () => void;
  forceMobilePreview: boolean;
  onToggleMobilePreview: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeScreen,
  availableMonths,
  selectedMonth,
  onSelectMonthByIndex,
  onPrevMonth,
  onNextMonth,
  onResetCurrentMonth,
  onOpenNewTransaction,
  onNavigate,
  onSignOut,
  userProfile,
  notifications,
  onMarkAllRead,
  forceMobilePreview,
  onToggleMobilePreview,
}) => {
  const [notifOpen, setNotifOpen] = useState(false);
  const [mobileMonthOpen, setMobileMonthOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  const unreadCount = notifications.filter((n) => !n.read).length;
  const activeScreenLabel = NAV_ITEMS.find((i) => i.id === activeScreen)?.label ?? 'Dashboard';

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
        setMobileMonthOpen(false);
        setProfileMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const renderNotificationsPopover = () => (
    <div className="absolute right-0 top-12 w-80 sm:w-84 bg-surface-container-lowest rounded-2xl shadow-xl border border-surface-container p-3 z-50 space-y-2.5">
      <div className="flex items-center justify-between px-1">
        <span className="text-sm font-bold text-on-surface">Notificações</span>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={onMarkAllRead}
            className="text-xs font-semibold text-primary hover:underline cursor-pointer"
          >
            Marcar como lidas
          </button>
        )}
      </div>
      {notifications.length === 0 ? (
        <p className="text-xs text-secondary py-4 text-center">
          Nenhuma notificação pendente no momento.
        </p>
      ) : (
        <div className="space-y-1.5 max-h-72 overflow-y-auto">
          {notifications.map((n) => (
            <div
              key={n.id}
              className={`p-2.5 rounded-xl flex items-start gap-2.5 transition-colors ${
                n.read ? 'bg-surface-container-lowest' : 'bg-surface-container-low'
              }`}
            >
              <div
                className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                  n.tone === 'warning'
                    ? 'bg-amber-100 text-amber-700'
                    : n.tone === 'info'
                    ? 'bg-tertiary-fixed text-tertiary'
                    : 'bg-primary-fixed/40 text-primary'
                }`}
              >
                <Icon name={n.icon} className="text-base" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-on-surface leading-snug">{n.title}</p>
                <p className="text-xs text-secondary mt-0.5 leading-relaxed">{n.description}</p>
                <span className="text-[10px] text-outline mt-1 block">{n.time}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderProfileMenu = () => (
    <div className="absolute right-0 top-12 w-56 bg-surface-container-lowest rounded-2xl shadow-xl border border-surface-container p-1.5 z-50 space-y-1">
      <div className="px-3 py-2 border-b border-surface-container">
        <p className="text-xs font-bold text-on-surface truncate">{userProfile.name}</p>
        <p className="text-[11px] text-secondary truncate">{userProfile.email}</p>
      </div>
      <button
        type="button"
        onClick={() => {
          setProfileMenuOpen(false);
          onNavigate('configuracoes');
        }}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-on-surface hover:bg-surface-container-low cursor-pointer"
      >
        <Icon name="settings" className="text-base text-secondary" />
        <span>Configurações da Conta</span>
      </button>
      <button
        type="button"
        onClick={() => {
          setProfileMenuOpen(false);
          onSignOut();
        }}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-error hover:bg-error-container/50 cursor-pointer"
      >
        <Icon name="logout" className="text-base" />
        <span>Sair da Conta</span>
      </button>
    </div>
  );

  return (
    <div ref={popoverRef}>
      {/* Desktop Top Header */}
      {!forceMobilePreview && (
        <header className="hidden lg:flex fixed top-0 left-64 right-0 h-16 bg-surface-container-lowest/90 backdrop-blur-xl border-b border-surface-container z-30 items-center justify-between px-gutter">
          {/* Left: Month Navigation */}
          <div className="flex items-center gap-space-md">
            <div className="flex items-center bg-surface-container-low rounded-xl p-1 gap-1">
              <button
                type="button"
                onClick={onPrevMonth}
                aria-label="Mês Anterior"
                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-surface-container text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
              >
                <Icon name="chevron_left" className="text-lg" />
              </button>
              <div className="flex items-center gap-1.5 px-space-sm text-[14px] font-semibold text-on-surface whitespace-nowrap">
                <Icon name="calendar_today" className="text-base text-primary" />
                <span>{selectedMonth}</span>
              </div>
              <button
                type="button"
                onClick={onNextMonth}
                aria-label="Próximo Mês"
                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-surface-container text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
              >
                <Icon name="chevron_right" className="text-lg" />
              </button>
              <button
                type="button"
                onClick={onResetCurrentMonth}
                className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-surface-container-lowest text-on-surface hover:bg-surface-container transition-colors shadow-2xs cursor-pointer whitespace-nowrap"
              >
                Mês Atual
              </button>
            </div>

            {activeScreen === 'movimentacoes' && (
              <button
                type="button"
                onClick={onToggleMobilePreview}
                title="Alternar prévia do layout mobile de Movimentações"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface-container-low hover:bg-surface-container text-xs font-semibold text-secondary hover:text-on-surface transition-colors cursor-pointer whitespace-nowrap"
              >
                <Icon name="smartphone" className="text-base text-primary" />
                <span>Versão Mobile</span>
              </button>
            )}
          </div>

          {/* Right: Primary Action, Notifications & Profile */}
          <div className="flex items-center gap-space-md">
            <button
              type="button"
              onClick={onOpenNewTransaction}
              className="inline-flex items-center gap-1.5 bg-primary hover:bg-primary-container text-on-primary px-space-md py-2 rounded-xl text-[14px] font-semibold transition-all shadow-xs cursor-pointer whitespace-nowrap"
            >
              <Icon name="add" className="text-lg" />
              <span>Nova Movimentação</span>
            </button>

            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setNotifOpen((v) => !v);
                  setProfileMenuOpen(false);
                }}
                aria-label="Notificações"
                className="relative w-9 h-9 flex items-center justify-center rounded-xl hover:bg-surface-container-low text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
              >
                <Icon name="notifications" className="text-xl" />
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-error text-on-error text-[10px] font-bold tabular-nums">
                    {unreadCount}
                  </span>
                )}
              </button>

              {notifOpen && renderNotificationsPopover()}
            </div>

            <div className="h-6 w-px bg-surface-container" />

            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setProfileMenuOpen((v) => !v);
                  setNotifOpen(false);
                }}
                className="flex items-center gap-space-sm text-left hover:opacity-85 transition-opacity cursor-pointer"
              >
                <SafeAvatar
                  src={userProfile.avatarHeaderUrl}
                  name={userProfile.name}
                  className="w-8 h-8"
                />
                <div className="flex flex-col text-left max-w-[150px]">
                  <span className="text-[14px] font-semibold text-on-surface leading-tight truncate">
                    {userProfile.name}
                  </span>
                  <span className="text-[11px] font-medium text-secondary leading-tight truncate">
                    {userProfile.email || userProfile.plan}
                  </span>
                </div>
                <Icon name="expand_more" className="text-base text-secondary" />
              </button>
              {profileMenuOpen && renderProfileMenu()}
            </div>
          </div>
        </header>
      )}

      {/* Mobile Header */}
      <header
        className={`${
          forceMobilePreview
            ? 'flex max-w-[430px] mx-auto left-0 right-0'
            : 'lg:hidden flex left-0 right-0'
        } fixed top-0 z-40 h-16 bg-surface/90 backdrop-blur-xl border-b border-surface-container px-4 items-center justify-between gap-2`}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <BrandLogo compact />
          <div className="flex flex-col min-w-0">
            <span className="text-base text-on-surface font-bold truncate tracking-tight leading-tight">
              FinanCerto
            </span>
            <span className="text-xs text-on-surface-variant font-medium truncate leading-tight">
              {activeScreenLabel}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0 relative">
          {forceMobilePreview && (
            <button
              type="button"
              onClick={onToggleMobilePreview}
              className="px-2.5 py-1.5 rounded-full bg-primary text-on-primary text-xs font-semibold flex items-center gap-1 cursor-pointer"
            >
              <Icon name="desktop_windows" className="text-sm" />
              <span>Desktop</span>
            </button>
          )}

          {/* Mobile Month Selector Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setMobileMonthOpen((v) => !v);
                setNotifOpen(false);
                setProfileMenuOpen(false);
              }}
              className="h-9 px-3 rounded-full bg-surface-container flex items-center gap-1 text-on-surface hover:bg-surface-container-high transition-colors cursor-pointer"
            >
              <span className="text-xs font-semibold whitespace-nowrap">
                {selectedMonth.replace(', ', '/').slice(0, 8)}
              </span>
              <Icon name="expand_more" className="text-base text-on-surface-variant" />
            </button>

            {mobileMonthOpen && (
              <div className="absolute right-0 top-11 w-48 max-h-64 overflow-y-auto bg-surface-container-lowest rounded-2xl shadow-xl border border-surface-container p-1.5 z-50 space-y-0.5">
                {availableMonths.map((m, idx) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      onSelectMonthByIndex(idx);
                      setMobileMonthOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2 rounded-xl text-xs transition-colors cursor-pointer ${
                      m === selectedMonth
                        ? 'bg-primary-container text-on-primary-container font-semibold'
                        : 'text-on-surface hover:bg-surface-container-low font-medium'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              setNotifOpen((v) => !v);
              setMobileMonthOpen(false);
              setProfileMenuOpen(false);
            }}
            aria-label="Notificações"
            className="w-9 h-9 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-surface-container transition-colors relative cursor-pointer"
          >
            <Icon name="notifications" className="text-[20px]" />
            {unreadCount > 0 && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-error ring-2 ring-surface" />
            )}
          </button>

          {notifOpen && renderNotificationsPopover()}

          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setProfileMenuOpen((v) => !v);
                setNotifOpen(false);
                setMobileMonthOpen(false);
              }}
              aria-label="Perfil"
              className="w-8 h-8 rounded-full bg-primary flex items-center justify-center ml-0.5 shrink-0 text-on-primary cursor-pointer"
            >
              <SafeAvatar
                src={userProfile.avatarHeaderUrl}
                name={userProfile.name}
                className="w-8 h-8 text-xs"
              />
            </button>
            {profileMenuOpen && renderProfileMenu()}
          </div>
        </div>
      </header>
    </div>
  );
};
