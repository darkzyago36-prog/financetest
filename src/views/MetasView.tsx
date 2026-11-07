import React, { useMemo, useState } from 'react';
import { formatBRL, getTodayIso, MONTHS_CATALOG } from '../data/initialData';
import {
  computeMonthlySeries,
  computeMonthsRemaining,
  filterTransactionsByMonthKey,
  findNextMilestoneGoal,
} from '../services/analyticsService';
import { formatGoalDateBR, parseGoalAmountInput } from '../services/financeService';
import { AccountItem, GoalItem, GoalStatus, Transaction } from '../types/finance';
import { Icon } from '../components/Icon';

export interface SaveGoalResult {
  ok: boolean;
  errorMessage?: string;
}

interface MetasViewProps {
  goals: GoalItem[];
  accounts: AccountItem[];
  transactions: Transaction[];
  availableMonthKeys?: string[];
  selectedMonth: string;
  selectedMonthKey: string;
  isLoading?: boolean;
  onRefresh?: () => Promise<void> | void;
  onSaveGoal: (goal: Omit<GoalItem, 'id'>, existingId?: string) => Promise<SaveGoalResult>;
  onUpdateGoalProgress: (
    id: string,
    newCurrentAmount: number,
    accountDebit?: {
      amount: number;
      sourceAccountId: string;
      dateIso: string;
    }
  ) => Promise<SaveGoalResult>;
  onTogglePauseGoal: (id: string) => Promise<void> | void;
  onDeleteGoal: (goal: GoalItem) => void;
  onNotify: (msg: string) => void;
}

const GOAL_ICONS = ['flag', 'shield_with_heart', 'flight', 'directions_car', 'home', 'school'];

function getDefaultGoalDateIso(): string {
  const dt = new Date();
  dt.setFullYear(dt.getFullYear() + 1);
  const yr = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yr}-${mm}-${dd}`;
}

function formatNumberInputBR(val: number): string {
  if (!Number.isFinite(val)) return '0';
  return Number.isInteger(val)
    ? String(val)
    : val.toFixed(2).replace('.', ',');
}

function formatPctBR(pct: number): string {
  if (!Number.isFinite(pct) || pct <= 0) return '0,0%';
  return `${pct.toFixed(1).replace('.', ',')}%`;
}

export const MetasView: React.FC<MetasViewProps> = ({
  goals,
  accounts,
  transactions,
  availableMonthKeys,
  selectedMonth,
  selectedMonthKey,
  isLoading = false,
  onRefresh,
  onSaveGoal,
  onUpdateGoalProgress,
  onTogglePauseGoal,
  onDeleteGoal,
}) => {
  const [statusFilter, setStatusFilter] = useState<'all' | GoalStatus>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  // Simulator State (interactive calculator only — never persisted automatically)
  const [simTarget, setSimTarget] = useState(15000);
  const [simMonths, setSimMonths] = useState(12);

  // Create / Edit Goal Modal
  const [goalModalOpen, setGoalModalOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<GoalItem | null>(null);
  const [isSavingGoal, setIsSavingGoal] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formCat, setFormCat] = useState('Planejamento Financeiro');
  const [formPriority, setFormPriority] = useState('Alta Prioridade');
  const [formTarget, setFormTarget] = useState('');
  const [formCurrent, setFormCurrent] = useState('0');
  const [formDate, setFormDate] = useState(getDefaultGoalDateIso);
  const [formAccount, setFormAccount] = useState(accounts[0]?.name || 'Carteira Geral');
  const [formIcon, setFormIcon] = useState('flag');

  const liquidAccounts = useMemo(
    () => accounts.filter((a) => ['checking', 'savings', 'business', 'investment'].includes(a.type)),
    [accounts]
  );

  // Progress Update Modal ("Somar valor" or "Definir valor acumulado")
  const [progressTarget, setProgressTarget] = useState<GoalItem | null>(null);
  const [progressMode, setProgressMode] = useState<'add' | 'set'>('add');
  const [progressInput, setProgressInput] = useState('');
  const [aporteAccountId, setAporteAccountId] = useState('');
  const [aporteDate, setAporteDate] = useState(getTodayIso);
  const [progressError, setProgressError] = useState<string | null>(null);

  const activeGoals = goals.filter((g) => g.status === 'active');
  const completedGoals = goals.filter((g) => g.status === 'completed');
  const pausedGoals = goals.filter((g) => g.status === 'paused');

  const totalSavedAll = goals.reduce((acc, g) => acc + g.currentAmount, 0);
  const totalTargetAll = goals.reduce((acc, g) => acc + g.targetAmount, 0);
  const globalPctNum = totalTargetAll > 0 ? (totalSavedAll / totalTargetAll) * 100 : 0;
  const globalPctLabel = formatPctBR(globalPctNum);
  const monthlyNeededTotal = activeGoals.reduce((acc, g) => acc + g.monthlyContribution, 0);

  const nextMilestone = useMemo(() => findNextMilestoneGoal(goals), [goals]);
  const nextMilestonePct =
    nextMilestone && nextMilestone.targetAmount > 0
      ? Math.min(100, Math.round((nextMilestone.currentAmount / nextMilestone.targetAmount) * 100))
      : 0;
  const nextMilestoneMonths = nextMilestone?.targetDateIso
    ? computeMonthsRemaining(nextMilestone.targetDateIso)
    : 0;

  // Dynamic monthly surplus from current month transactions
  const monthSurplus = useMemo(() => {
    const mTx = filterTransactionsByMonthKey(transactions, selectedMonthKey);
    const inc = mTx.filter((t) => t.type === 'receita').reduce((s, t) => s + t.amount, 0);
    const exp = mTx.filter((t) => t.type === 'despesa').reduce((s, t) => s + t.amount, 0);
    return Math.max(0, inc - exp);
  }, [transactions, selectedMonthKey]);

  // Dynamic 5-month savings evolution sparkline
  const sparklineData = useMemo(() => {
    const baseKeys =
      availableMonthKeys && availableMonthKeys.length > 0
        ? availableMonthKeys
        : MONTHS_CATALOG.map((m) => m.key);
    const activeIdx = baseKeys.indexOf(selectedMonthKey);
    const endIdx = activeIdx >= 0 ? activeIdx + 1 : baseKeys.length;
    const keys = baseKeys.slice(Math.max(0, endIdx - 5), endIdx);
    const series = computeMonthlySeries(transactions, keys, selectedMonthKey);
    const values = series.map((s) => Math.max(0, s.net));
    const maxV = Math.max(1000, ...values);
    const coords = series.map((pt, idx) => {
      const x = Math.round((idx / Math.max(1, series.length - 1)) * 280) + 10;
      const y = Math.round(70 - (Math.max(0, pt.net) / maxV) * 55);
      return { x, y, label: pt.monthLabel.slice(0, 3), net: pt.net, isCurrent: pt.isCurrent };
    });
    const last3Sum = series.slice(-3).reduce((sum, s) => sum + Math.max(0, s.net), 0);
    const linePath = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x} ${c.y}`).join(' ');
    const areaPath =
      coords.length > 0
        ? `${linePath} L ${coords[coords.length - 1].x} 80 L ${coords[0].x} 80 Z`
        : '';
    return { coords, linePath, areaPath, last3Sum };
  }, [transactions, selectedMonthKey, availableMonthKeys]);

  const filteredGoals = goals.filter((g) => {
    if (statusFilter === 'all') return true;
    return g.status === statusFilter;
  });

  // Compound monthly contribution needed with 0.8% a.m. yield
  const monthlyRate = 0.008;
  const simMonthlyNeeded =
    simMonths > 0
      ? simMonths === 1
        ? simTarget
        : (simTarget * monthlyRate) / (Math.pow(1 + monthlyRate, simMonths) - 1)
      : 0;

  const handleManualRefresh = async () => {
    if (!onRefresh || isSyncing || isLoading) return;
    setIsSyncing(true);
    try {
      await onRefresh();
    } finally {
      setIsSyncing(false);
    }
  };

  const openCreateModal = (prefillName = '', prefillTarget = '') => {
    setEditingGoal(null);
    setFormError(null);
    setFormName(prefillName);
    setFormCat('Segurança Financeira');
    setFormPriority('Alta Prioridade');
    setFormTarget(prefillTarget);
    setFormCurrent('0');
    setFormDate(getDefaultGoalDateIso());
    setFormAccount(liquidAccounts[0]?.name || 'Carteira Geral');
    setFormIcon('flag');
    setGoalModalOpen(true);
  };

  const openEditModal = (goal: GoalItem) => {
    setEditingGoal(goal);
    setFormError(null);
    setFormName(goal.name);
    setFormCat(goal.category);
    setFormPriority(
      goal.priorityBadge === '100% Conquistado!' ? 'Alta Prioridade' : goal.priorityBadge
    );
    setFormTarget(formatNumberInputBR(goal.targetAmount));
    setFormCurrent(formatNumberInputBR(goal.currentAmount));
    setFormDate(goal.targetDateIso || getDefaultGoalDateIso());
    setFormAccount(goal.linkedAccount || liquidAccounts[0]?.name || 'Carteira Geral');
    setFormIcon(goal.icon || 'flag');
    setOpenDropdownId(null);
    setGoalModalOpen(true);
  };

  const openProgressModal = (goal: GoalItem, initialMode: 'add' | 'set' = 'add') => {
    setProgressTarget(goal);
    setProgressMode(initialMode);
    setProgressInput(initialMode === 'set' ? formatNumberInputBR(goal.currentAmount) : '');
    setAporteAccountId('');
    setAporteDate(getTodayIso());
    setProgressError(null);
    setOpenDropdownId(null);
  };

  const handleSwitchProgressMode = (nextMode: 'add' | 'set') => {
    setProgressMode(nextMode);
    setProgressError(null);
    if (nextMode === 'set' && progressTarget) {
      setProgressInput(formatNumberInputBR(progressTarget.currentAmount));
    } else {
      setProgressInput('');
    }
  };

  // Live preview inside Create/Edit modal
  const formPreview = useMemo(() => {
    const parsedT = parseGoalAmountInput(formTarget, false);
    const parsedC = parseGoalAmountInput(formCurrent, true);
    const validT = Number.isFinite(parsedT) && parsedT > 0 ? parsedT : 0;
    const validC = Number.isFinite(parsedC) && parsedC >= 0 ? parsedC : 0;
    const pct = validT > 0 ? (validC / validT) * 100 : 0;
    const barPct = Math.min(100, Math.max(0, pct));
    return { validT, validC, pct, barPct };
  }, [formTarget, formCurrent]);

  // Live preview inside Progress modal
  const progressPreview = useMemo(() => {
    if (!progressTarget) return null;
    const rawVal = parseGoalAmountInput(progressInput, false);
    const isInputValid =
      progressMode === 'add'
        ? Number.isFinite(rawVal) && rawVal > 0
        : Number.isFinite(rawVal) && rawVal >= 0;

    const nextAmount = isInputValid
      ? progressMode === 'add'
        ? Number((progressTarget.currentAmount + rawVal).toFixed(2))
        : rawVal
      : progressTarget.currentAmount;

    const pct =
      progressTarget.targetAmount > 0
        ? (nextAmount / progressTarget.targetAmount) * 100
        : 0;
    const barPct = Math.min(100, Math.max(0, pct));
    const remaining = Math.max(0, Number((progressTarget.targetAmount - nextAmount).toFixed(2)));

    return {
      isInputValid,
      rawVal,
      nextAmount,
      pct,
      barPct,
      remaining,
      isCompleted: nextAmount >= progressTarget.targetAmount,
    };
  }, [progressTarget, progressMode, progressInput]);

  const handleSaveGoalForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSavingGoal) return;
    setFormError(null);

    const cleanName = formName.trim().replace(/\s+/g, ' ');
    if (!cleanName) {
      setFormError('Informe o nome da meta financeira.');
      return;
    }

    const tVal = parseGoalAmountInput(formTarget, false);
    if (!Number.isFinite(tVal) || tVal <= 0) {
      setFormError('O valor desejado da meta deve ser maior que zero.');
      return;
    }

    const cVal = parseGoalAmountInput(formCurrent, true);
    if (!Number.isFinite(cVal) || cVal < 0) {
      setFormError('O valor já acumulado deve ser igual ou maior que zero.');
      return;
    }

    const cleanDate = formDate.trim();
    if (!cleanDate || !/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
      setFormError('Informe uma data limite válida para a meta.');
      return;
    }

    const completed = cVal >= tVal;
    const monthsRem = computeMonthsRemaining(cleanDate);

    setIsSavingGoal(true);
    try {
      const res = await onSaveGoal(
        {
          name: cleanName,
          category: formCat,
          priorityBadge: completed ? '100% Conquistado!' : formPriority,
          icon: formIcon,
          theme: editingGoal?.theme || 'primary',
          currentAmount: cVal,
          targetAmount: tVal,
          targetDateLabel: formatGoalDateBR(cleanDate),
          targetDateIso: cleanDate,
          monthsRemainingLabel: completed
            ? 'Meta concluída'
            : `Restam ${monthsRem} ${monthsRem === 1 ? 'mês' : 'meses'}`,
          monthlyContribution: completed ? 0 : Math.ceil(Math.max(0, tVal - cVal) / monthsRem),
          paceStatus: completed ? 'completed' : 'ideal',
          status: completed
            ? 'completed'
            : editingGoal?.status === 'paused'
            ? 'paused'
            : 'active',
          linkedAccount: formAccount,
          completedDateLabel: completed ? `Concluído em ${selectedMonth}` : undefined,
        },
        editingGoal?.id
      );
      if (res.ok) {
        setGoalModalOpen(false);
        setEditingGoal(null);
        setFormError(null);
      } else if (res.errorMessage) {
        setFormError(res.errorMessage);
      }
    } finally {
      setIsSavingGoal(false);
    }
  };

  const handleProgressSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!progressTarget || isSavingGoal) return;
    setProgressError(null);

    const parsedVal = parseGoalAmountInput(progressInput, false);
    if (progressMode === 'add') {
      if (!Number.isFinite(parsedVal) || parsedVal <= 0) {
        setProgressError('Informe um valor de aporte maior que zero.');
        return;
      }
    } else {
      if (!Number.isFinite(parsedVal) || parsedVal < 0) {
        setProgressError('O valor acumulado deve ser igual ou maior que zero.');
        return;
      }
    }

    const nextCurrentAmount =
      progressMode === 'add'
        ? Number((progressTarget.currentAmount + parsedVal).toFixed(2))
        : parsedVal;

    if (nextCurrentAmount < 0) {
      setProgressError('O valor acumulado deve ser igual ou maior que zero.');
      return;
    }

    setIsSavingGoal(true);
    try {
      const accountDebit =
        progressMode === 'add' && aporteAccountId
          ? {
              amount: parsedVal,
              sourceAccountId: aporteAccountId,
              dateIso: aporteDate || getTodayIso(),
            }
          : undefined;

      const res = await onUpdateGoalProgress(
        progressTarget.id,
        nextCurrentAmount,
        accountDebit
      );
      if (res.ok) {
        setProgressTarget(null);
        setProgressInput('');
        setProgressError(null);
      } else if (res.errorMessage) {
        setProgressError(res.errorMessage);
      }
    } finally {
      setIsSavingGoal(false);
    }
  };

  return (
    <div className="flex flex-col w-full" onClick={() => setOpenDropdownId(null)}>
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-space-md mb-space-lg">
        <div className="space-y-1">
          <div className="flex items-center gap-1 text-secondary text-xs">
            <span>Planejamento</span>
            <Icon name="chevron_right" className="text-xs text-outline-variant" />
            <span className="text-primary font-semibold">Metas Financeiras</span>
          </div>
          <h1 className="text-[32px] leading-10 font-bold text-on-surface tracking-tight">
            Metas Financeiras
          </h1>
          <p className="text-sm text-secondary">
            Planeje objetivos, acompanhe o percentual conquistado e atualize seus valores acumulados em tempo real.
          </p>
        </div>

        <div className="flex items-center gap-space-sm flex-wrap">
          {onRefresh && (
            <button
              type="button"
              onClick={() => void handleManualRefresh()}
              disabled={isLoading || isSyncing}
              className="inline-flex items-center gap-2 bg-surface-container-lowest hover:bg-surface-container text-on-surface px-space-md py-2 rounded-xl text-sm font-medium transition-all shadow-2xs cursor-pointer disabled:opacity-60 whitespace-nowrap"
            >
              <Icon
                name="refresh"
                className={`text-lg text-primary ${isLoading || isSyncing ? 'animate-spin' : ''}`}
              />
              <span>{isLoading || isSyncing ? 'Sincronizando...' : 'Sincronizar'}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => openCreateModal()}
            className="inline-flex items-center gap-2 bg-primary hover:bg-primary-container text-on-primary px-space-lg py-2 rounded-xl text-sm font-semibold transition-all shadow-xs active:scale-95 cursor-pointer whitespace-nowrap"
          >
            <Icon name="flag" className="text-lg" filled />
            <span>Nova Meta</span>
          </button>
        </div>
      </div>

      {/* KPI Metrics Banner */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-space-md mb-space-lg">
        <div className="bg-surface-container-lowest p-space-lg rounded-xl shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-space-sm">
            <span className="text-xs text-secondary uppercase tracking-wider font-semibold">
              Total Acumulado
            </span>
            <div className="w-9 h-9 rounded-full bg-primary-fixed/30 flex items-center justify-center text-primary">
              <Icon name="account_balance" className="text-xl" filled />
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-3xl text-on-surface font-bold tracking-tight tabular-nums">
              {formatBRL(totalSavedAll)}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-secondary tabular-nums">
              <span className="text-primary font-bold">{globalPctLabel}</span>
              <span>· de {formatBRL(totalTargetAll)}</span>
            </div>
          </div>
          <div className="w-full h-1.5 bg-surface-container rounded-full overflow-hidden mt-space-md">
            <div
              className="h-full bg-primary rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, Math.max(0, globalPctNum))}%` }}
            />
          </div>
        </div>

        <div className="bg-surface-container-lowest p-space-lg rounded-xl shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-space-sm">
            <span className="text-xs text-secondary uppercase tracking-wider font-semibold">
              Metas Ativas
            </span>
            <div className="w-9 h-9 rounded-full bg-tertiary-fixed/40 flex items-center justify-center text-tertiary">
              <Icon name="track_changes" className="text-xl" />
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-3xl text-on-surface font-bold tracking-tight tabular-nums">
              {activeGoals.length}{' '}
              <span className="text-sm text-secondary font-normal">ativas</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-secondary">
              <span className="font-semibold text-on-surface-variant">
                +{completedGoals.length}{' '}
                {completedGoals.length === 1 ? 'concluída' : 'concluídas'}
              </span>
              <span>· {pausedGoals.length} pausadas</span>
            </div>
          </div>
          <div className="w-full h-1.5 bg-surface-container rounded-full overflow-hidden mt-space-md">
            <div
              className="h-full bg-tertiary rounded-full"
              style={{
                width: `${
                  goals.length > 0
                    ? Math.round(
                        ((activeGoals.length + completedGoals.length) / goals.length) * 100
                      )
                    : 0
                }%`,
              }}
            />
          </div>
        </div>

        <div className="bg-surface-container-lowest p-space-lg rounded-xl shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-space-sm">
            <span className="text-xs text-secondary uppercase tracking-wider font-semibold">
              Aporte Mensal Alvo
            </span>
            <div className="w-9 h-9 rounded-full bg-secondary-container/60 flex items-center justify-center text-on-secondary-container">
              <Icon name="payments" className="text-xl" />
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-3xl text-on-surface font-bold tracking-tight tabular-nums">
              {formatBRL(monthlyNeededTotal)}
              <span className="text-xs text-secondary font-normal">/mês</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-secondary">
              <Icon
                name={monthSurplus >= monthlyNeededTotal ? 'check_circle' : 'info'}
                className={`text-sm ${
                  monthSurplus >= monthlyNeededTotal ? 'text-primary' : 'text-amber-700'
                }`}
              />
              <span>
                {monthSurplus >= monthlyNeededTotal
                  ? 'Coberto pela sobra do mês'
                  : 'Soma p/ cumprir prazos'}
              </span>
            </div>
          </div>
          <div className="w-full h-1.5 bg-surface-container rounded-full overflow-hidden mt-space-md">
            <div
              className="h-full bg-primary rounded-full"
              style={{
                width: `${
                  monthlyNeededTotal > 0
                    ? Math.min(100, Math.round((monthSurplus / monthlyNeededTotal) * 100))
                    : 100
                }%`,
              }}
            />
          </div>
        </div>

        <div className="bg-surface-container-lowest p-space-lg rounded-xl shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-space-sm">
            <span className="text-xs text-secondary uppercase tracking-wider font-semibold">
              Próximo Marco
            </span>
            <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center text-amber-700">
              <Icon name={nextMilestone?.icon || 'flag'} className="text-xl" />
            </div>
          </div>
          {nextMilestone ? (
            <>
              <div className="space-y-1">
                <div className="text-lg text-on-surface font-bold truncate">
                  {nextMilestone.name}
                </div>
                <div className="flex items-center gap-1.5 text-xs text-secondary tabular-nums">
                  <span className="text-amber-700 font-semibold">
                    Faltam {nextMilestoneMonths} {nextMilestoneMonths === 1 ? 'mês' : 'meses'}
                  </span>
                  <span>· {nextMilestonePct}% atingido</span>
                </div>
              </div>
              <div className="w-full h-1.5 bg-surface-container rounded-full overflow-hidden mt-space-md">
                <div
                  className="h-full bg-amber-500 rounded-full"
                  style={{ width: `${nextMilestonePct}%` }}
                />
              </div>
            </>
          ) : (
            <div className="text-xs text-secondary py-2">
              Nenhuma meta em andamento cadastrada.
            </div>
          )}
        </div>
      </section>

      {/* Filter Tabs & View Mode Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-space-md mb-space-lg">
        <div className="flex items-center gap-1.5 p-1 bg-surface-container-low rounded-xl overflow-x-auto self-start max-w-full">
          {(
            [
              { id: 'all', label: `Todas as Metas (${goals.length})` },
              { id: 'active', label: `Em Andamento (${activeGoals.length})` },
              { id: 'completed', label: `Concluídas (${completedGoals.length})` },
              { id: 'paused', label: `Pausadas (${pausedGoals.length})` },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id)}
              className={`px-space-md py-1.5 rounded-lg text-sm transition-all whitespace-nowrap cursor-pointer ${
                statusFilter === tab.id
                  ? 'font-semibold bg-surface-container-lowest text-on-surface shadow-2xs'
                  : 'font-medium text-secondary hover:text-on-surface'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-secondary hidden md:inline">Visualização:</span>
          <div className="flex items-center bg-surface-container-low p-1 rounded-xl">
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              title="Grade de Cartões"
              className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors cursor-pointer ${
                viewMode === 'grid'
                  ? 'bg-surface-container-lowest text-primary shadow-2xs'
                  : 'text-secondary hover:text-on-surface'
              }`}
            >
              <Icon name="grid_view" className="text-lg" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('table')}
              title="Tabela Detalhada"
              className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors cursor-pointer ${
                viewMode === 'table'
                  ? 'bg-surface-container-lowest text-primary shadow-2xs'
                  : 'text-secondary hover:text-on-surface'
              }`}
            >
              <Icon name="table_rows" className="text-lg" />
            </button>
          </div>
        </div>
      </div>

      {/* Empty State OR Active View */}
      {goals.length === 0 ? (
        <div className="bg-surface-container-lowest rounded-xl p-space-xl shadow-xs text-center max-w-2xl mx-auto my-space-lg">
          <div className="w-20 h-20 mx-auto mb-space-md rounded-full bg-primary-fixed/30 text-primary flex items-center justify-center">
            <Icon name="savings" className="text-[42px]" filled />
          </div>
          <h2 className="text-2xl text-on-surface font-bold mb-1 tracking-tight">
            Nenhuma meta criada ainda
          </h2>
          <p className="text-sm text-secondary max-w-md mx-auto mb-space-lg">
            Dar um destino claro ao seu dinheiro é o segredo para construir patrimônio sem estresse. Comece cadastrando sua reserva de emergência ou seu próximo sonho!
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-space-sm max-w-lg mx-auto mb-space-lg text-left">
            <div className="bg-surface-container-low p-space-md rounded-xl space-y-1">
              <Icon name="verified_user" className="text-primary text-xl" />
              <div className="text-sm font-bold text-on-surface">1. Defina o Alvo</div>
              <div className="text-xs text-secondary">Escolha valor e prazo limite.</div>
            </div>
            <div className="bg-surface-container-low p-space-md rounded-xl space-y-1">
              <Icon name="savings" className="text-primary text-xl" />
              <div className="text-sm font-bold text-on-surface">2. Aporte Livre</div>
              <div className="text-xs text-secondary">Guarde quando e quanto puder.</div>
            </div>
            <div className="bg-surface-container-low p-space-md rounded-xl space-y-1">
              <Icon name="trending_up" className="text-primary text-xl" />
              <div className="text-sm font-bold text-on-surface">3. Conquiste</div>
              <div className="text-xs text-secondary">Acompanhe seu ritmo em tempo real.</div>
            </div>
          </div>
          <div className="flex items-center justify-center gap-space-sm flex-wrap">
            <button
              type="button"
              onClick={() => openCreateModal()}
              className="inline-flex items-center gap-2 bg-primary hover:bg-primary-container text-on-primary px-space-lg py-2.5 rounded-xl text-sm font-semibold transition-all shadow-xs cursor-pointer"
            >
              <Icon name="add_task" className="text-lg" />
              <span>Criar Minha Primeira Meta</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-space-lg items-start">
          {/* Left 8 cols */}
          <div className="xl:col-span-8 flex flex-col gap-space-md">
            {filteredGoals.length === 0 ? (
              <div className="bg-surface-container-lowest rounded-xl p-space-xl shadow-xs text-center">
                <Icon name="filter_alt_off" className="text-3xl text-secondary mb-2" />
                <p className="text-sm font-semibold text-on-surface mb-1">
                  Nenhuma meta encontrada neste filtro
                </p>
                <p className="text-xs text-secondary mb-space-md">
                  Altere o filtro acima ou cadastre uma nova meta financeira.
                </p>
                <button
                  type="button"
                  onClick={() => setStatusFilter('all')}
                  className="px-space-md py-1.5 rounded-xl bg-surface-container-low hover:bg-surface-container text-xs font-semibold text-primary cursor-pointer"
                >
                  Mostrar todas as metas
                </button>
              </div>
            ) : viewMode === 'grid' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-space-md">
                {filteredGoals.map((goal) => {
                  const isCompleted = goal.status === 'completed';
                  const rawPct =
                    goal.targetAmount > 0
                      ? Number(((goal.currentAmount / goal.targetAmount) * 100).toFixed(1))
                      : 0;
                  const barWidthPct = Math.min(100, Math.max(0, rawPct));
                  const remaining = Math.max(0, goal.targetAmount - goal.currentAmount);
                  const surplusOverTarget = Math.max(0, goal.currentAmount - goal.targetAmount);

                  const iconStyle = isCompleted
                    ? 'bg-primary text-on-primary'
                    : goal.theme === 'tertiary'
                    ? 'bg-tertiary-fixed/50 text-tertiary'
                    : goal.theme === 'amber'
                    ? 'bg-amber-100 text-amber-800'
                    : goal.theme === 'secondary'
                    ? 'bg-secondary-container text-on-secondary-container'
                    : 'bg-primary-fixed/40 text-primary';

                  const barColor =
                    goal.theme === 'tertiary'
                      ? 'bg-tertiary'
                      : goal.theme === 'amber'
                      ? 'bg-amber-500'
                      : 'bg-primary';

                  return (
                    <article
                      key={goal.id}
                      className="bg-surface-container-lowest p-space-lg rounded-xl shadow-xs hover:shadow-md transition-all flex flex-col justify-between"
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2 mb-space-md">
                          <div className="flex items-center gap-space-sm min-w-0">
                            <div
                              className={`w-12 h-12 rounded-xl ${iconStyle} flex items-center justify-center shrink-0`}
                            >
                              <Icon name={goal.icon} className="text-2xl" filled />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <h3 className="text-lg text-on-surface font-bold leading-tight truncate">
                                  {goal.name}
                                </h3>
                                {isCompleted && (
                                  <Icon
                                    name="emoji_events"
                                    className="text-base text-primary shrink-0"
                                    filled
                                  />
                                )}
                              </div>
                              <div className="flex items-center gap-1.5 mt-0.5 text-xs text-secondary flex-wrap">
                                <span>{goal.category}</span>
                                <span>·</span>
                                <span
                                  className={`font-semibold ${
                                    isCompleted ? 'text-primary' : 'text-on-surface-variant'
                                  }`}
                                >
                                  {goal.status === 'paused' ? 'Pausada' : goal.priorityBadge}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div
                            className="flex items-center gap-1 shrink-0"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={() => onDeleteGoal(goal)}
                              title="Excluir meta"
                              className="w-8 h-8 rounded-lg flex items-center justify-center text-secondary hover:bg-error-container hover:text-error transition-colors cursor-pointer"
                            >
                              <Icon name="delete" className="text-base" />
                            </button>
                            <div className="relative">
                              <button
                                type="button"
                                onClick={() =>
                                  setOpenDropdownId((prev) => (prev === goal.id ? null : goal.id))
                                }
                                title="Mais opções"
                                className="w-8 h-8 rounded-lg flex items-center justify-center text-secondary hover:bg-surface-container hover:text-on-surface transition-colors cursor-pointer"
                              >
                                <Icon name="more_vert" className="text-lg" />
                              </button>
                              {openDropdownId === goal.id && (
                                <div className="absolute right-0 top-9 w-48 bg-surface-container-lowest border border-surface-container rounded-xl shadow-xl p-1 z-30 space-y-0.5">
                                  <button
                                    type="button"
                                    onClick={() => openProgressModal(goal, 'add')}
                                    className="w-full text-left px-3 py-1.5 rounded-lg text-xs font-medium text-on-surface hover:bg-surface-container-low flex items-center gap-2 cursor-pointer"
                                  >
                                    <Icon name="add_circle" className="text-sm text-primary" />
                                    Somar Aporte (+R$)
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => openProgressModal(goal, 'set')}
                                    className="w-full text-left px-3 py-1.5 rounded-lg text-xs font-medium text-on-surface hover:bg-surface-container-low flex items-center gap-2 cursor-pointer"
                                  >
                                    <Icon name="tune" className="text-sm text-primary" />
                                    Definir Valor Acumulado
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => openEditModal(goal)}
                                    className="w-full text-left px-3 py-1.5 rounded-lg text-xs font-medium text-on-surface hover:bg-surface-container-low flex items-center gap-2 cursor-pointer"
                                  >
                                    <Icon name="edit" className="text-sm text-secondary" />
                                    Editar Meta
                                  </button>
                                  {!isCompleted && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        void onTogglePauseGoal(goal.id);
                                        setOpenDropdownId(null);
                                      }}
                                      className="w-full text-left px-3 py-1.5 rounded-lg text-xs font-medium text-secondary hover:bg-surface-container-low flex items-center gap-2 cursor-pointer"
                                    >
                                      <Icon
                                        name={goal.status === 'paused' ? 'play_arrow' : 'pause'}
                                        className="text-sm text-secondary"
                                      />
                                      {goal.status === 'paused' ? 'Retomar Meta' : 'Pausar Meta'}
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOpenDropdownId(null);
                                      onDeleteGoal(goal);
                                    }}
                                    className="w-full text-left px-3 py-1.5 rounded-lg text-xs font-medium text-error hover:bg-error-container flex items-center gap-2 cursor-pointer"
                                  >
                                    <Icon name="delete" className="text-sm text-error" />
                                    Excluir Meta
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Values & Progress Box (Reais + Percentual + Barra Visual) */}
                        <div
                          className={`rounded-xl p-space-md mb-space-md ${
                            isCompleted ? 'bg-primary-fixed/15' : 'bg-surface-container-low'
                          }`}
                        >
                          <div className="flex items-baseline justify-between text-xs">
                            <span
                              className={
                                isCompleted ? 'text-primary font-semibold' : 'text-secondary'
                              }
                            >
                              {isCompleted ? 'Objetivo Alcançado!' : 'Valor Acumulado'}
                            </span>
                            <span className="text-secondary font-medium tabular-nums">
                              Meta: {formatBRL(goal.targetAmount)}
                            </span>
                          </div>
                          <div className="flex items-baseline justify-between mt-1 tabular-nums">
                            <div
                              className={`text-2xl font-bold ${
                                isCompleted ? 'text-primary' : 'text-on-surface'
                              }`}
                            >
                              {formatBRL(goal.currentAmount)}
                            </div>
                            <div
                              className={`text-sm font-bold ${
                                goal.theme === 'amber'
                                  ? 'text-amber-700'
                                  : goal.theme === 'tertiary'
                                  ? 'text-tertiary'
                                  : 'text-primary'
                              }`}
                            >
                              {formatPctBR(rawPct)}
                            </div>
                          </div>
                          <div
                            className="w-full h-2.5 bg-surface-container rounded-full overflow-hidden mt-2"
                            role="progressbar"
                            aria-valuenow={Math.round(rawPct)}
                            aria-valuemin={0}
                            aria-valuemax={100}
                          >
                            <div
                              className={`h-full ${barColor} rounded-full transition-all duration-300`}
                              style={{ width: `${barWidthPct}%` }}
                            />
                          </div>
                          <div className="flex justify-between items-center text-xs text-secondary mt-2 tabular-nums">
                            {isCompleted ? (
                              <>
                                <span className="text-primary font-medium flex items-center gap-1">
                                  <Icon name="verified" className="text-sm" />
                                  {goal.completedDateLabel || 'Concluído'}
                                </span>
                                <span className="font-semibold text-primary">
                                  {surplusOverTarget > 0
                                    ? `+${formatBRL(surplusOverTarget)} acima da meta`
                                    : 'R$ 0,00 restante'}
                                </span>
                              </>
                            ) : (
                              <>
                                <span>Faltam {formatBRL(remaining)}</span>
                                <span className="font-medium text-on-surface">
                                  {goal.monthsRemainingLabel}
                                </span>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Metadata rows */}
                        <div className="space-y-1.5 text-xs text-secondary mb-space-md">
                          <div className="flex items-center justify-between">
                            <span>Data limite:</span>
                            <span className="font-semibold text-on-surface tabular-nums">
                              {goal.targetDateLabel}
                            </span>
                          </div>
                          <div className="flex items-center justify-between tabular-nums">
                            <span>{isCompleted ? 'Total acumulado:' : 'Aporte mensal sugerido:'}</span>
                            <span className="font-semibold text-on-surface">
                              {isCompleted
                                ? formatBRL(goal.currentAmount)
                                : `${formatBRL(goal.monthlyContribution)} / mês`}
                            </span>
                          </div>
                          <div className="flex items-center justify-between pt-1">
                            <span>Conta referência:</span>
                            <span className="font-medium text-on-surface truncate max-w-[150px]">
                              {goal.linkedAccount}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Footer Buttons */}
                      <div className="grid grid-cols-2 gap-space-sm pt-1">
                        <button
                          type="button"
                          onClick={() => openProgressModal(goal, isCompleted ? 'set' : 'add')}
                          className="inline-flex items-center justify-center gap-1.5 py-2 px-space-md rounded-xl text-sm font-semibold bg-surface-container-low text-primary hover:bg-primary hover:text-on-primary transition-all cursor-pointer"
                        >
                          <Icon name="savings" className="text-base" />
                          <span>{isCompleted ? 'Progresso' : 'Atualizar'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditModal(goal)}
                          className="inline-flex items-center justify-center gap-1.5 py-2 px-space-md rounded-xl text-sm font-medium text-secondary hover:bg-surface-container hover:text-on-surface transition-all cursor-pointer"
                        >
                          <Icon name="edit" className="text-base" />
                          <span>Editar</span>
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              /* TABLE VIEW */
              <div className="bg-surface-container-lowest rounded-xl shadow-xs overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-surface-container-low text-secondary text-xs uppercase tracking-wider">
                        <th className="py-3 px-space-md font-semibold">Meta &amp; Categoria</th>
                        <th className="py-3 px-space-md font-semibold">Acumulado / Desejado</th>
                        <th className="py-3 px-space-md font-semibold">Progresso</th>
                        <th className="py-3 px-space-md font-semibold">Data Limite</th>
                        <th className="py-3 px-space-md font-semibold">Aporte Mensal</th>
                        <th className="py-3 px-space-md text-right font-semibold">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-container text-xs text-on-surface">
                      {filteredGoals.map((goal) => {
                        const rawPct =
                          goal.targetAmount > 0
                            ? Number(((goal.currentAmount / goal.targetAmount) * 100).toFixed(1))
                            : 0;
                        const barWidthPct = Math.min(100, Math.max(0, rawPct));
                        const remaining = Math.max(0, goal.targetAmount - goal.currentAmount);
                        const isCompleted = goal.status === 'completed';
                        return (
                          <tr
                            key={goal.id}
                            className="hover:bg-surface-container-low/50 transition-colors"
                          >
                            <td className="py-3.5 px-space-md">
                              <div className="flex items-center gap-2.5">
                                <div className="w-8 h-8 rounded-lg bg-primary-fixed/40 text-primary flex items-center justify-center shrink-0">
                                  <Icon name={goal.icon} className="text-base" />
                                </div>
                                <div>
                                  <div className="text-sm font-bold text-on-surface">
                                    {goal.name}
                                  </div>
                                  <div className="text-[11px] text-secondary">{goal.category}</div>
                                </div>
                              </div>
                            </td>
                            <td className="py-3.5 px-space-md tabular-nums">
                              <div className="font-semibold text-on-surface">
                                {formatBRL(goal.currentAmount)}
                              </div>
                              <div className="text-[11px] text-secondary">
                                de {formatBRL(goal.targetAmount)}
                              </div>
                            </td>
                            <td className="py-3.5 px-space-md tabular-nums">
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <div className="w-24 h-2 bg-surface-container rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-primary rounded-full transition-all duration-300"
                                      style={{ width: `${barWidthPct}%` }}
                                    />
                                  </div>
                                  <span className="font-bold text-primary">
                                    {formatPctBR(rawPct)}
                                  </span>
                                </div>
                                <div className="text-[11px] text-secondary">
                                  {isCompleted
                                    ? 'Meta concluída'
                                    : `Faltam ${formatBRL(remaining)}`}
                                </div>
                              </div>
                            </td>
                            <td className="py-3.5 px-space-md font-medium text-secondary tabular-nums">
                              {goal.targetDateLabel}
                            </td>
                            <td className="py-3.5 px-space-md font-medium tabular-nums">
                              {isCompleted
                                ? 'Finalizado'
                                : `${formatBRL(goal.monthlyContribution)}/mês`}
                            </td>
                            <td className="py-3.5 px-space-md text-right">
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() =>
                                    openProgressModal(goal, isCompleted ? 'set' : 'add')
                                  }
                                  className="px-2.5 py-1 rounded-lg bg-primary text-on-primary text-xs font-semibold hover:bg-primary-container transition-colors cursor-pointer"
                                >
                                  Atualizar
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openEditModal(goal)}
                                  className="p-1.5 rounded-lg hover:bg-surface-container text-secondary hover:text-on-surface cursor-pointer"
                                  title="Editar"
                                >
                                  <Icon name="edit" className="text-sm" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => onDeleteGoal(goal)}
                                  className="p-1.5 rounded-lg hover:bg-error-container text-secondary hover:text-error cursor-pointer"
                                  title="Excluir"
                                >
                                  <Icon name="delete" className="text-sm" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Right 4 cols: Dynamic Insights, Simulator, Live Sparkline */}
          <aside className="xl:col-span-4 flex flex-col gap-space-md">
            <div className="bg-gradient-to-br from-primary-fixed/30 to-surface-container-lowest p-space-lg rounded-xl shadow-xs relative overflow-hidden">
              <div className="flex items-center gap-2 text-primary text-sm font-bold mb-1.5">
                <Icon name="auto_awesome" className="text-xl" />
                <span>Dica Inteligente FinanCerto</span>
              </div>
              <p className="text-sm text-on-surface leading-relaxed mb-2.5">
                {nextMilestone && monthSurplus > 0 ? (
                  <>
                    Com o saldo positivo de{' '}
                    <strong className="text-primary font-bold tabular-nums">
                      {formatBRL(monthSurplus)}
                    </strong>{' '}
                    apurado em <strong>{selectedMonth}</strong>, você pode realizar um aporte extra
                    na meta <strong>&quot;{nextMilestone.name}&quot;</strong>!
                  </>
                ) : (
                  <>
                    Mantenha seus aportes mensais regulares para atingir todas as metas ativas dentro do prazo planejado.
                  </>
                )}
              </p>
              {nextMilestone && (
                <button
                  type="button"
                  onClick={() => openProgressModal(nextMilestone, 'add')}
                  className="inline-flex items-center gap-1.5 text-primary text-xs font-bold hover:underline cursor-pointer"
                >
                  <span>Atualizar progresso em {nextMilestone.name}</span>
                  <Icon name="arrow_forward" className="text-sm" />
                </button>
              )}
            </div>

            {/* Simulador de Aporte */}
            <div className="bg-surface-container-lowest p-space-lg rounded-xl shadow-xs space-y-space-md">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-surface-container-low text-primary flex items-center justify-center">
                  <Icon name="calculate" className="text-lg" />
                </div>
                <div>
                  <h4 className="text-lg text-on-surface font-bold">Simulador de Aporte</h4>
                  <p className="text-xs text-secondary">Planeje qualquer sonho em segundos</p>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-secondary mb-1">
                    Quanto você precisa alcançar? (R$)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-secondary text-sm font-semibold">
                      R$
                    </span>
                    <input
                      type="number"
                      value={simTarget}
                      onChange={(e) => setSimTarget(Math.max(0, Number(e.target.value)))}
                      className="w-full bg-surface-container-low pl-10 pr-3 py-2 rounded-xl text-on-surface text-sm font-semibold focus:outline-none focus:bg-surface-container tabular-nums"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1 text-xs">
                    <label className="text-secondary font-medium">
                      Em quantos meses quer realizar?
                    </label>
                    <span className="font-bold text-primary tabular-nums">
                      {simMonths} {simMonths === 1 ? 'mês' : 'meses'}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={60}
                    value={simMonths}
                    onChange={(e) => setSimMonths(Number(e.target.value))}
                    className="w-full accent-primary h-1.5 bg-surface-container rounded-lg cursor-pointer"
                  />
                  <div className="flex justify-between text-[11px] text-secondary mt-1">
                    <span>1 mês</span>
                    <span>2.5 anos (30m)</span>
                    <span>5 anos (60m)</span>
                  </div>
                </div>

                <div className="bg-surface-container-low p-space-md rounded-xl space-y-1">
                  <span className="text-xs text-secondary font-medium">
                    Aporte mensal necessário:
                  </span>
                  <div className="text-xl text-primary font-bold tabular-nums">
                    {formatBRL(simMonthlyNeeded)}{' '}
                    <span className="text-xs font-normal text-secondary">/ mês</span>
                  </div>
                  <p className="text-xs text-secondary">
                    Calculado com juros compostos de 0,8% a.m.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    openCreateModal('', simTarget > 0 ? formatNumberInputBR(simTarget) : '')
                  }
                  className="w-full py-2.5 px-space-md rounded-xl text-sm font-semibold bg-primary hover:bg-primary-container text-on-primary transition-all shadow-xs flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Icon name="add_task" className="text-base" />
                  <span>Transformar em Meta Real</span>
                </button>
              </div>
            </div>

            {/* Evolução de Poupança Líquida Sparkline (Dynamic) */}
            <div className="bg-surface-container-lowest p-space-lg rounded-xl shadow-xs space-y-2">
              <h4 className="text-lg text-on-surface font-bold flex items-center gap-2">
                <Icon name="analytics" className="text-lg text-primary" />
                <span>Capacidade de Poupança</span>
              </h4>
              <p className="text-xs text-secondary">
                Economia líquida nos últimos 3 meses:{' '}
                <strong className="text-on-surface font-semibold tabular-nums">
                  {formatBRL(sparklineData.last3Sum)}
                </strong>
              </p>
              <div className="pt-2">
                <svg className="w-full h-24 overflow-visible" fill="none" viewBox="0 0 300 80">
                  <defs>
                    <linearGradient id="metasChartGradient" x1="0%" x2="0%" y1="0%" y2="100%">
                      <stop offset="0%" stopColor="#006948" stopOpacity="0.3" />
                      <stop offset="100%" stopColor="#006948" stopOpacity="0.0" />
                    </linearGradient>
                  </defs>
                  {sparklineData.areaPath && (
                    <path d={sparklineData.areaPath} fill="url(#metasChartGradient)" />
                  )}
                  {sparklineData.linePath && (
                    <path
                      d={sparklineData.linePath}
                      stroke="#006948"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="3"
                    />
                  )}
                  {sparklineData.coords.map((c) => (
                    <circle
                      key={c.label + c.x}
                      cx={c.x}
                      cy={c.y}
                      fill={c.isCurrent ? '#85f8c4' : '#006948'}
                      r={c.isCurrent ? 5 : 4}
                      stroke={c.isCurrent ? '#006948' : undefined}
                      strokeWidth={c.isCurrent ? 2 : undefined}
                    />
                  ))}
                </svg>
                <div className="flex justify-between text-[11px] text-secondary font-medium mt-1 px-1">
                  {sparklineData.coords.map((c) => (
                    <span
                      key={c.label + c.x}
                      className={c.isCurrent ? 'font-bold text-primary' : ''}
                    >
                      {c.label}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* MODAL: NOVA / EDITAR META */}
      {goalModalOpen && (
        <div
          className="fixed inset-0 bg-inverse-surface/40 backdrop-blur-xs z-50 flex items-center justify-center p-space-md"
          onClick={() => {
            if (!isSavingGoal) setGoalModalOpen(false);
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-surface-container-lowest w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between px-space-lg py-space-md bg-surface-container-low">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-primary-fixed/40 text-primary flex items-center justify-center">
                  <Icon name={formIcon} className="text-lg" />
                </div>
                <div>
                  <h3 className="text-lg text-on-surface font-bold">
                    {editingGoal ? 'Editar Meta Financeira' : 'Cadastrar Nova Meta'}
                  </h3>
                  <p className="text-xs text-secondary">
                    Defina nome, valor desejado, valor já acumulado e data limite
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={isSavingGoal}
                onClick={() => setGoalModalOpen(false)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-secondary hover:bg-surface-container hover:text-on-surface cursor-pointer disabled:opacity-50"
              >
                <Icon name="close" className="text-lg" />
              </button>
            </div>

            <form onSubmit={handleSaveGoalForm} noValidate className="p-space-lg space-y-space-md">
              {formError && (
                <div
                  role="alert"
                  className="bg-error-container text-on-error-container rounded-xl px-space-md py-2.5 text-xs font-semibold flex items-center gap-2"
                >
                  <Icon name="error" className="text-base shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-secondary mb-1">
                  Nome da Meta *
                </label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => {
                    setFormName(e.target.value);
                    if (formError) setFormError(null);
                  }}
                  placeholder="Ex: Reserva de Emergência, Viagem, Carro..."
                  className="w-full bg-surface-container-low px-space-md py-2 rounded-xl text-on-surface text-sm focus:outline-none focus:bg-surface-container"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-space-sm">
                <div>
                  <label className="block text-xs font-semibold text-secondary mb-1">
                    Valor Desejado (R$) *
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-2 text-secondary text-sm font-semibold">
                      R$
                    </span>
                    <input
                      type="text"
                      inputMode="decimal"
                      required
                      value={formTarget}
                      onChange={(e) => {
                        setFormTarget(e.target.value);
                        if (formError) setFormError(null);
                      }}
                      placeholder="Ex: 10.000,00"
                      className="w-full bg-surface-container-low pl-10 pr-3 py-2 rounded-xl text-on-surface text-sm tabular-nums focus:outline-none focus:bg-surface-container"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-secondary mb-1">
                    Valor Já Acumulado (R$)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-2 text-secondary text-sm font-semibold">
                      R$
                    </span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={formCurrent}
                      onChange={(e) => {
                        setFormCurrent(e.target.value);
                        if (formError) setFormError(null);
                      }}
                      placeholder="0,00"
                      className="w-full bg-surface-container-low pl-10 pr-3 py-2 rounded-xl text-on-surface text-sm tabular-nums focus:outline-none focus:bg-surface-container"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-space-sm">
                <div>
                  <label className="block text-xs font-semibold text-secondary mb-1">
                    Data Limite *
                  </label>
                  <input
                    type="date"
                    required
                    value={formDate}
                    onChange={(e) => {
                      setFormDate(e.target.value);
                      if (formError) setFormError(null);
                    }}
                    className="w-full bg-surface-container-low px-space-md py-2 rounded-xl text-on-surface text-sm tabular-nums focus:outline-none focus:bg-surface-container"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-secondary mb-1">
                    Conta Referência
                  </label>
                  <select
                    value={formAccount}
                    onChange={(e) => setFormAccount(e.target.value)}
                    className="w-full bg-surface-container-low px-space-md py-2 rounded-xl text-on-surface text-sm focus:outline-none"
                  >
                    {liquidAccounts.length === 0 ? (
                      <option value="Carteira Geral">Carteira Geral</option>
                    ) : (
                      liquidAccounts.map((acc) => (
                        <option key={acc.id} value={acc.name}>
                          {acc.name}
                        </option>
                      ))
                    )}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-space-sm">
                <div>
                  <label className="block text-xs font-semibold text-secondary mb-1">
                    Categoria
                  </label>
                  <select
                    value={formCat}
                    onChange={(e) => setFormCat(e.target.value)}
                    className="w-full bg-surface-container-low px-space-md py-2 rounded-xl text-on-surface text-sm focus:outline-none"
                  >
                    <option value="Segurança Financeira">Segurança Financeira</option>
                    <option value="Planejamento Financeiro">Planejamento Financeiro</option>
                    <option value="Lazer & Viagem">Lazer &amp; Viagem</option>
                    <option value="Patrimônio">Patrimônio / Bens</option>
                    <option value="Educação">Educação / Carreira</option>
                    <option value="Equipamento">Equipamento</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-secondary mb-1">
                    Prioridade
                  </label>
                  <select
                    value={formPriority}
                    onChange={(e) => setFormPriority(e.target.value)}
                    className="w-full bg-surface-container-low px-space-md py-2 rounded-xl text-on-surface text-sm focus:outline-none"
                  >
                    <option value="Alta Prioridade">Alta Prioridade</option>
                    <option value="Médio Prazo">Médio Prazo</option>
                    <option value="Longo Prazo">Longo Prazo</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-secondary mb-1.5">
                  Ícone Representativo
                </label>
                <div className="flex items-center gap-2">
                  {GOAL_ICONS.map((ic) => (
                    <button
                      key={ic}
                      type="button"
                      onClick={() => setFormIcon(ic)}
                      className={`w-9 h-9 rounded-xl flex items-center justify-center transition-colors cursor-pointer ${
                        formIcon === ic
                          ? 'bg-primary text-on-primary'
                          : 'bg-surface-container text-secondary hover:text-on-surface'
                      }`}
                    >
                      <Icon name={ic} className="text-lg" />
                    </button>
                  ))}
                </div>
              </div>

              {/* Live Progress Preview inside Modal */}
              {formPreview.validT > 0 && (
                <div className="bg-surface-container-low rounded-xl p-space-md space-y-1.5 tabular-nums">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-secondary font-medium">Prévia de progresso:</span>
                    <span className="font-bold text-primary">
                      {formatPctBR(formPreview.pct)}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between text-xs">
                    <span className="font-bold text-on-surface">
                      {formatBRL(formPreview.validC)}
                    </span>
                    <span className="text-secondary">
                      de {formatBRL(formPreview.validT)}
                    </span>
                  </div>
                  <div className="w-full h-2 bg-surface-container rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all duration-300"
                      style={{ width: `${formPreview.barPct}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                {editingGoal ? (
                  <button
                    type="button"
                    disabled={isSavingGoal}
                    onClick={() => {
                      const target = editingGoal;
                      setGoalModalOpen(false);
                      onDeleteGoal(target);
                    }}
                    className="px-3 py-2 rounded-xl text-xs font-semibold text-error hover:bg-error-container cursor-pointer disabled:opacity-50"
                  >
                    Excluir Meta
                  </button>
                ) : (
                  <span />
                )}
                <div className="flex items-center gap-space-sm">
                  <button
                    type="button"
                    disabled={isSavingGoal}
                    onClick={() => setGoalModalOpen(false)}
                    className="px-space-md py-2 rounded-xl text-sm font-medium text-secondary hover:bg-surface-container cursor-pointer disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={isSavingGoal}
                    className="px-space-lg py-2 rounded-xl text-sm font-semibold bg-primary hover:bg-primary-container text-on-primary shadow-xs inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                  >
                    <Icon
                      name={isSavingGoal ? 'progress_activity' : 'check'}
                      className={`text-base ${isSavingGoal ? 'animate-spin' : ''}`}
                    />
                    <span>{isSavingGoal ? 'Salvando...' : 'Salvar Meta'}</span>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: ATUALIZAR PROGRESSO DA META (SOMAR APORTE OU DEFINIR VALOR ACUMULADO) */}
      {progressTarget && (
        <div
          className="fixed inset-0 bg-inverse-surface/40 backdrop-blur-xs z-50 flex items-center justify-center p-space-md"
          onClick={() => {
            if (!isSavingGoal) setProgressTarget(null);
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-surface-container-lowest w-full max-w-md rounded-2xl shadow-2xl overflow-hidden"
          >
            <div className="flex items-center justify-between px-space-lg py-space-md bg-surface-container-low">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-primary-fixed/40 text-primary flex items-center justify-center shrink-0">
                  <Icon name="savings" className="text-lg" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-lg text-on-surface font-bold">
                    Atualizar Progresso
                  </h3>
                  <p className="text-xs text-secondary truncate">{progressTarget.name}</p>
                </div>
              </div>
              <button
                type="button"
                disabled={isSavingGoal}
                onClick={() => setProgressTarget(null)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-secondary hover:bg-surface-container cursor-pointer disabled:opacity-50"
              >
                <Icon name="close" className="text-lg" />
              </button>
            </div>

            <form onSubmit={handleProgressSubmit} noValidate className="p-space-lg space-y-space-md">
              {progressError && (
                <div
                  role="alert"
                  className="bg-error-container text-on-error-container rounded-xl px-space-md py-2.5 text-xs font-semibold flex items-center gap-2"
                >
                  <Icon name="error" className="text-base shrink-0" />
                  <span>{progressError}</span>
                </div>
              )}

              {/* Mode Switcher */}
              <div className="grid grid-cols-2 gap-1 p-1 bg-surface-container-low rounded-xl">
                <button
                  type="button"
                  onClick={() => handleSwitchProgressMode('add')}
                  className={`py-1.5 px-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    progressMode === 'add'
                      ? 'bg-surface-container-lowest text-primary shadow-2xs'
                      : 'text-secondary hover:text-on-surface'
                  }`}
                >
                  Somar Aporte (+R$)
                </button>
                <button
                  type="button"
                  onClick={() => handleSwitchProgressMode('set')}
                  className={`py-1.5 px-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    progressMode === 'set'
                      ? 'bg-surface-container-lowest text-primary shadow-2xs'
                      : 'text-secondary hover:text-on-surface'
                  }`}
                >
                  Definir Total Acumulado
                </button>
              </div>

              <div>
                <label className="block text-xs font-semibold text-secondary mb-1">
                  {progressMode === 'add'
                    ? 'Valor a somar na meta (R$) *'
                    : 'Novo valor total já acumulado (R$) *'}
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-2.5 text-secondary text-sm font-semibold">
                    R$
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    required
                    autoFocus
                    value={progressInput}
                    onChange={(e) => {
                      setProgressInput(e.target.value);
                      if (progressError) setProgressError(null);
                    }}
                    placeholder={progressMode === 'add' ? '500,00' : '0,00'}
                    className="w-full bg-surface-container-low pl-12 pr-3 py-2.5 text-lg font-bold rounded-xl text-on-surface tabular-nums focus:outline-none focus:bg-surface-container"
                  />
                </div>
              </div>

              {/* Real-time Progress Preview */}
              {progressPreview && (
                <div className="bg-surface-container-low rounded-xl p-space-md space-y-2 tabular-nums">
                  <div className="flex items-center justify-between text-xs text-secondary">
                    <span>Acumulado atual:</span>
                    <span className="font-semibold text-on-surface">
                      {formatBRL(progressTarget.currentAmount)}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between text-xs">
                    <span className="text-secondary font-medium">Novo acumulado:</span>
                    <span className="text-base font-bold text-primary">
                      {formatBRL(progressPreview.nextAmount)}{' '}
                      <span className="text-xs font-semibold">
                        ({formatPctBR(progressPreview.pct)})
                      </span>
                    </span>
                  </div>
                  <div className="w-full h-2 bg-surface-container rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all duration-300"
                      style={{ width: `${progressPreview.barPct}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-secondary">
                    <span>Meta: {formatBRL(progressTarget.targetAmount)}</span>
                    <span className="font-semibold text-on-surface">
                      {progressPreview.isCompleted
                        ? 'Meta 100% atingida!'
                        : `Faltam ${formatBRL(progressPreview.remaining)}`}
                    </span>
                  </div>
                </div>
              )}

              {progressMode === 'add' && liquidAccounts.length > 0 && (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-secondary mb-1">
                      Debitar de alguma conta? (Opcional)
                    </label>
                    <select
                      value={aporteAccountId}
                      onChange={(e) => setAporteAccountId(e.target.value)}
                      className="w-full bg-surface-container-low px-space-md py-2 rounded-xl text-on-surface text-sm focus:outline-none"
                    >
                      <option value="">Apenas atualizar valor acumulado na meta</option>
                      {liquidAccounts.map((acc) => (
                        <option key={acc.id} value={acc.id}>
                          {acc.name} (Saldo: {formatBRL(acc.balance)})
                        </option>
                      ))}
                    </select>
                  </div>

                  {aporteAccountId && (
                    <div>
                      <label className="block text-xs font-semibold text-secondary mb-1">
                        Data do Lançamento na Conta
                      </label>
                      <input
                        type="date"
                        value={aporteDate}
                        onChange={(e) => setAporteDate(e.target.value)}
                        className="w-full bg-surface-container-low px-space-md py-2 rounded-xl text-on-surface text-sm tabular-nums focus:outline-none"
                      />
                    </div>
                  )}
                </>
              )}

              <div className="flex items-center justify-end gap-space-sm pt-2">
                <button
                  type="button"
                  disabled={isSavingGoal}
                  onClick={() => setProgressTarget(null)}
                  className="px-space-md py-2 rounded-xl text-sm font-medium text-secondary hover:bg-surface-container cursor-pointer disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSavingGoal}
                  className="px-space-lg py-2 rounded-xl text-sm font-semibold bg-primary hover:bg-primary-container text-on-primary shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                >
                  <Icon
                    name={isSavingGoal ? 'progress_activity' : 'check'}
                    className={`text-base ${isSavingGoal ? 'animate-spin' : ''}`}
                  />
                  <span>{isSavingGoal ? 'Salvando...' : 'Salvar Progresso'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
