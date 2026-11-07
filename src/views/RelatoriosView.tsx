import React, { useMemo, useState } from 'react';
import {
  formatBRL,
  getMonthLabelFromKey,
  getTodayIso,
} from '../data/initialData';
import {
  buildPeriodMonthKeys,
  computeCategoryBreakdown,
  computeFinancialEvolutionSeries,
  computeMonthlySeries,
  computeSmartAxisCeiling,
  filterTransactionsByAccount,
  getTxMonthKey,
  ReportPeriodPresetId,
} from '../services/analyticsService';
import {
  AccountItem,
  Category,
  GoalItem,
  ScreenId,
  Transaction,
  TransactionType,
} from '../types/finance';
import { Icon } from '../components/Icon';
import { DonutChart } from '../components/charts/DonutChart';
import { EmptyState } from '../components/ui/EmptyState';

interface RelatoriosViewProps {
  transactions: Transaction[];
  categories: Category[];
  accounts: AccountItem[];
  goals: GoalItem[];
  availableMonthKeys?: string[];
  selectedMonthKey: string;
  isLoading?: boolean;
  onRefresh?: () => Promise<void> | void;
  onSelectMonthKey?: (monthKey: string) => void;
  onOpenNewTransaction?: () => void;
  onNavigate: (screen: ScreenId) => void;
  onExportCsv: (rows?: Transaction[]) => void;
  onNotify: (msg: string) => void;
}

const PERIOD_PRESETS: { id: ReportPeriodPresetId; label: string }[] = [
  { id: '1m', label: 'Mês' },
  { id: '3m', label: 'Últimos 3 Meses' },
  { id: '6m', label: 'Últimos 6 Meses' },
  { id: 'yr', label: 'Ano' },
  { id: 'all', label: 'Todo o Histórico' },
  { id: 'custom', label: 'Personalizado' },
];

function formatCompactAxisBRL(val: number): string {
  if (val === 0) return '0';
  const sign = val < 0 ? '-' : '';
  const abs = Math.abs(val);
  if (abs >= 1000) {
    const k = abs / 1000;
    return `${sign}${k.toFixed(abs % 1000 === 0 ? 0 : 1).replace('.', ',')}k`;
  }
  return `${sign}${Math.round(abs)}`;
}

export const RelatoriosView: React.FC<RelatoriosViewProps> = ({
  transactions,
  categories,
  accounts,
  goals,
  availableMonthKeys = [],
  selectedMonthKey,
  isLoading = false,
  onRefresh,
  onSelectMonthKey,
  onOpenNewTransaction,
  onNavigate,
  onExportCsv,
  onNotify,
}) => {
  const [periodId, setPeriodId] = useState<ReportPeriodPresetId>('6m');
  const [customStart, setCustomStart] = useState(() => `${selectedMonthKey}-01`);
  const [customEnd, setCustomEnd] = useState(getTodayIso);
  const [chartCadence, setChartCadence] = useState<'mensal' | 'trimestral'>('mensal');
  const [evolutionTab, setEvolutionTab] = useState<'acumulado' | 'saldo_mensal'>('acumulado');
  const [categoryTab, setCategoryTab] = useState<TransactionType>('despesa');
  const [accountScope, setAccountScope] = useState('all');
  const [insightDismissed, setInsightDismissed] = useState(false);
  const [monthSearch, setMonthSearch] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [hoveredBarKey, setHoveredBarKey] = useState<string | null>(null);
  const [hoveredEvoKey, setHoveredEvoKey] = useState<string | null>(null);

  // Scoped transactions by selected account (or all user accounts)
  const accountScopedTransactions = useMemo(
    () => filterTransactionsByAccount(transactions, accountScope, accounts),
    [transactions, accountScope, accounts]
  );

  // Distinct years available for quick switching when "Ano" filter is active
  const availableYears = useMemo(() => {
    const yearsSet = new Set<string>([
      selectedMonthKey.slice(0, 4),
      getTodayIso().slice(0, 4),
    ]);
    for (const tx of transactions) {
      if (tx.date && tx.date.length >= 4) {
        yearsSet.add(tx.date.slice(0, 4));
      }
    }
    return Array.from(yearsSet).sort((a, b) => b.localeCompare(a));
  }, [transactions, selectedMonthKey]);

  // Exact contiguous calendar month keys for the selected period preset
  const activeMonthKeys = useMemo(
    () =>
      buildPeriodMonthKeys(
        periodId,
        selectedMonthKey,
        accountScopedTransactions,
        customStart,
        customEnd
      ),
    [periodId, selectedMonthKey, accountScopedTransactions, customStart, customEnd]
  );

  // Real user transactions filtered strictly by active period + account
  const periodTransactions = useMemo(() => {
    if (periodId === 'all') {
      return accountScopedTransactions;
    }
    if (periodId === 'custom') {
      const start = customStart <= customEnd ? customStart : customEnd;
      const end = customStart <= customEnd ? customEnd : customStart;
      return accountScopedTransactions.filter((t) => t.date >= start && t.date <= end);
    }
    const keySet = new Set(activeMonthKeys);
    return accountScopedTransactions.filter((t) => keySet.has(getTxMonthKey(t)));
  }, [accountScopedTransactions, periodId, customStart, customEnd, activeMonthKeys]);

  // Chronological monthly series for charts
  const chronologicalSeries = useMemo(
    () => computeMonthlySeries(periodTransactions, activeMonthKeys, selectedMonthKey),
    [periodTransactions, activeMonthKeys, selectedMonthKey]
  );

  // Reverse chronological for breakdown table
  const tableRows = useMemo(
    () => [...chronologicalSeries].reverse(),
    [chronologicalSeries]
  );

  const totalIncome = useMemo(
    () =>
      Number(
        periodTransactions
          .filter((t) => t.type === 'receita')
          .reduce((s, t) => s + t.amount, 0)
          .toFixed(2)
      ),
    [periodTransactions]
  );

  const totalExpenses = useMemo(
    () =>
      Number(
        periodTransactions
          .filter((t) => t.type === 'despesa')
          .reduce((s, t) => s + t.amount, 0)
          .toFixed(2)
      ),
    [periodTransactions]
  );

  const totalNet = Number((totalIncome - totalExpenses).toFixed(2));
  const avgSavingsRateNum = totalIncome > 0 ? (totalNet / totalIncome) * 100 : 0;
  const avgSavingsRate = avgSavingsRateNum.toFixed(1).replace('.', ',');
  const avgMonthlyExpense =
    chronologicalSeries.length > 0
      ? Number((totalExpenses / chronologicalSeries.length).toFixed(2))
      : 0;

  const expenseBreakdown = useMemo(
    () => computeCategoryBreakdown(periodTransactions, categories, 'despesa'),
    [periodTransactions, categories]
  );

  const incomeBreakdown = useMemo(
    () => computeCategoryBreakdown(periodTransactions, categories, 'receita'),
    [periodTransactions, categories]
  );

  const activeCategoryBreakdown =
    categoryTab === 'despesa' ? expenseBreakdown : incomeBreakdown;
  const activeCategoryTotal =
    categoryTab === 'despesa' ? totalExpenses : totalIncome;

  // Chart 1 Geometry: Receitas vs Despesas + Saldo Líquido (supports positive & negative Saldo!)
  const incomeExpenseChart = useMemo(() => {
    const pts = chronologicalSeries;
    const rawMaxPos = Math.max(
      0,
      ...pts.map((p) => Math.max(p.income, p.expenses, p.net))
    );
    const rawMinNeg = Math.min(0, ...pts.map((p) => p.net));
    const hasDeficit = rawMinNeg < 0;

    const posCeiling = computeSmartAxisCeiling(rawMaxPos);
    const negFloor = hasDeficit ? -computeSmartAxisCeiling(Math.abs(rawMinNeg)) : 0;
    const totalSpan = Math.max(1, posCeiling - negFloor);

    const chartTop = 24;
    const chartBottom = 216;
    const usableH = chartBottom - chartTop; // 192px
    const zeroY = Math.round(chartTop + (posCeiling / totalSpan) * usableH);

    const count = Math.max(1, pts.length);
    const leftPad = 68;
    const rightPad = 612;
    const usableW = rightPad - leftPad;
    const stepX = count === 1 ? 0 : usableW / (count - 1);
    const startX = count === 1 ? 340 : leftPad;
    const barW = count > 8 ? 13 : 20;
    const gapHalf = count > 8 ? 1 : 2;

    const bars = pts.map((p, idx) => {
      const centerX = Math.round(startX + idx * stepX);
      const incH =
        p.income > 0
          ? Math.max(4, Math.round((p.income / totalSpan) * usableH))
          : 0;
      const expH =
        p.expenses > 0
          ? Math.max(4, Math.round((p.expenses / totalSpan) * usableH))
          : 0;
      const netY = Math.round(zeroY - (p.net / totalSpan) * usableH);

      return {
        ...p,
        centerX,
        barW,
        incX: centerX - barW - gapHalf,
        incY: zeroY - incH,
        incH,
        expX: centerX + gapHalf,
        expY: zeroY - expH,
        expH,
        netY,
      };
    });

    const polylinePoints = bars.map((b) => `${b.centerX},${b.netY}`).join(' ');
    const bestPoint =
      pts.some((p) => p.txCount > 0)
        ? [...pts].filter((p) => p.txCount > 0).sort((a, b) => b.net - a.net)[0]
        : undefined;

    const tickRatios = hasDeficit
      ? [posCeiling, posCeiling / 2, 0, negFloor / 2, negFloor]
      : [posCeiling, posCeiling * 0.75, posCeiling * 0.5, posCeiling * 0.25, 0];

    const yTicks = tickRatios.map((val, idx) => {
      const y = Math.round(zeroY - (val / totalSpan) * usableH);
      return {
        key: `${idx}-${val}`,
        y,
        val,
        isZero: val === 0,
        label: formatCompactAxisBRL(val),
      };
    });

    return { bars, polylinePoints, bestPoint, yTicks, zeroY };
  }, [chronologicalSeries]);

  // Quarterly aggregation from live series
  const quarterlyGeometry = useMemo(() => {
    const map = new Map<string, { quarter: string; income: number; expenses: number }>();
    for (const pt of chronologicalSeries) {
      const curr = map.get(pt.quarter) || { quarter: pt.quarter, income: 0, expenses: 0 };
      curr.income = Number((curr.income + pt.income).toFixed(2));
      curr.expenses = Number((curr.expenses + pt.expenses).toFixed(2));
      map.set(pt.quarter, curr);
    }
    const items = Array.from(map.values());
    const maxQ = Math.max(0, ...items.map((i) => Math.max(i.income, i.expenses)));
    const ceiling = computeSmartAxisCeiling(maxQ);
    return { items, ceiling };
  }, [chronologicalSeries]);

  // Chart 2A: Real Financial Evolution (Opening Balance + Trajectory + Closing Balance)
  const evolutionData = useMemo(
    () =>
      computeFinancialEvolutionSeries({
        accounts,
        scopedTransactions: accountScopedTransactions,
        periodId,
        activeMonthKeys,
        customStart,
        customEnd,
        accountScope,
      }),
    [
      accounts,
      accountScopedTransactions,
      periodId,
      activeMonthKeys,
      customStart,
      customEnd,
      accountScope,
    ]
  );

  const evolutionSvg = useMemo(() => {
    const pts = evolutionData.points;
    const vals = pts.map((p) => p.balance);
    const minVal = vals.length > 0 ? Math.min(...vals) : 0;
    const maxVal = vals.length > 0 ? Math.max(...vals) : 0;
    const rawSpan = maxVal - minVal;
    const pad = rawSpan > 0 ? rawSpan * 0.15 : Math.max(100, Math.abs(maxVal) * 0.2 || 100);
    const domainMin = minVal - pad;
    const domainMax = maxVal + pad;
    const domainSpan = Math.max(1, domainMax - domainMin);

    const leftX = 58;
    const rightX = 612;
    const topY = 20;
    const bottomY = 142;
    const usableW = rightX - leftX;
    const usableH = bottomY - topY;

    const coords = pts.map((pt, idx) => {
      const x =
        pts.length <= 1
          ? Math.round((leftX + rightX) / 2)
          : Math.round(leftX + (idx / (pts.length - 1)) * usableW);
      const y = Math.round(bottomY - ((pt.balance - domainMin) / domainSpan) * usableH);
      return {
        ...pt,
        x,
        y,
      };
    });

    const linePath = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x},${c.y}`).join(' ');
    const areaPath =
      coords.length > 1
        ? `${linePath} L ${coords[coords.length - 1].x},${bottomY + 6} L ${coords[0].x},${
            bottomY + 6
          } Z`
        : '';

    const yGuides = [maxVal, (maxVal + minVal) / 2, minVal].map((v, i) => ({
      id: i,
      y: Math.round(bottomY - ((v - domainMin) / domainSpan) * usableH),
      label: formatCompactAxisBRL(v),
    }));

    return { coords, linePath, areaPath, yGuides };
  }, [evolutionData]);

  // Chart 2B: Dedicated Saldo Mensal (Superávit / Déficit) diverging bar geometry
  const saldoMensalSvg = useMemo(() => {
    const pts = chronologicalSeries;
    const maxAbs = Math.max(0, ...pts.map((p) => Math.abs(p.net)));
    const bound = computeSmartAxisCeiling(maxAbs);
    const zeroY = 85;
    const halfH = 62;
    const count = Math.max(1, pts.length);
    const leftX = 72;
    const rightX = 605;
    const stepX = count === 1 ? 0 : (rightX - leftX) / (count - 1);
    const startX = count === 1 ? 338 : leftX;
    const barW = count > 8 ? 22 : 34;

    const items = pts.map((p, idx) => {
      const centerX = Math.round(startX + idx * stepX);
      const h =
        p.net !== 0 ? Math.max(4, Math.round((Math.abs(p.net) / bound) * halfH)) : 2;
      const y = p.net >= 0 ? zeroY - h : zeroY;
      return {
        ...p,
        centerX,
        x: Math.round(centerX - barW / 2),
        y,
        w: barW,
        h,
      };
    });

    return { items, zeroY, bound };
  }, [chronologicalSeries]);

  const searchedRows = tableRows.filter((r) =>
    r.monthLabel.toLowerCase().includes(monthSearch.toLowerCase())
  );

  const positiveMonthsCount = chronologicalSeries.filter((r) => r.net > 0).length;

  const emergencyCoverageMonths =
    avgMonthlyExpense > 0 && evolutionData.closingBalance > 0
      ? (evolutionData.closingBalance / avgMonthlyExpense).toFixed(1).replace('.', ',')
      : '0,0';

  const topGoal = goals.find((g) => g.status === 'active') || goals[0];
  const topExpenseCat = expenseBreakdown[0];

  const activeRangeLabel = useMemo(() => {
    if (periodId === 'custom') {
      return `${customStart.split('-').reverse().join('/')} — ${customEnd
        .split('-')
        .reverse()
        .join('/')}`;
    }
    if (chronologicalSeries.length === 1) {
      return chronologicalSeries[0].monthLabel;
    }
    return `${chronologicalSeries[0]?.monthLabel || ''} — ${
      chronologicalSeries[chronologicalSeries.length - 1]?.monthLabel || ''
    }`;
  }, [periodId, customStart, customEnd, chronologicalSeries]);

  const hoveredBar = useMemo(
    () => incomeExpenseChart.bars.find((b) => b.monthKey === hoveredBarKey) || null,
    [incomeExpenseChart.bars, hoveredBarKey]
  );

  const hoveredEvo = useMemo(
    () => evolutionSvg.coords.find((c) => c.key === hoveredEvoKey) || null,
    [evolutionSvg.coords, hoveredEvoKey]
  );

  const handleManualSync = async () => {
    if (isSyncing || isLoading) return;
    if (!onRefresh) {
      onNotify('Indicadores sincronizados com as movimentações atuais!');
      return;
    }
    setIsSyncing(true);
    try {
      await onRefresh();
      onNotify('Relatórios sincronizados com os dados reais do Supabase!');
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="flex flex-col w-full space-y-gutter pb-space-xl">
      {/* Header */}
      <section className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-space-md">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-on-surface-variant text-xs">
            <span>Visão Geral</span>
            <Icon name="chevron_right" className="text-xs text-outline-variant" />
            <span className="text-primary font-semibold">Relatórios Financeiros</span>
          </div>
          <h1 className="text-[32px] leading-10 font-bold text-on-surface tracking-tight">
            Relatórios e Análises
          </h1>
          <p className="text-sm text-on-surface-variant max-w-2xl">
            Gráficos dinâmicos de receitas, despesas, saldo e evolução financeira calculados exclusivamente com seus dados reais no Supabase.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-space-sm">
          {onOpenNewTransaction && (
            <button
              type="button"
              onClick={onOpenNewTransaction}
              className="inline-flex items-center gap-2 px-space-md py-2.5 rounded-xl bg-primary hover:bg-primary-container text-on-primary transition-all shadow-xs text-sm font-semibold cursor-pointer whitespace-nowrap"
            >
              <Icon name="add_circle" className="text-base" />
              <span>Nova Movimentação</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 px-space-md py-2.5 rounded-xl bg-surface-container-lowest text-on-surface hover:bg-surface-container transition-all shadow-xs text-sm font-medium cursor-pointer whitespace-nowrap"
          >
            <Icon name="picture_as_pdf" className="text-base text-tertiary" />
            <span>Imprimir / PDF</span>
          </button>
          <button
            type="button"
            onClick={() => onExportCsv(periodTransactions)}
            className="inline-flex items-center gap-2 px-space-md py-2.5 rounded-xl bg-surface-container-lowest text-on-surface hover:bg-surface-container transition-all shadow-xs text-sm font-medium cursor-pointer whitespace-nowrap"
          >
            <Icon name="table_chart" className="text-base text-primary" />
            <span>Exportar CSV ({periodTransactions.length})</span>
          </button>
          <button
            type="button"
            disabled={isLoading || isSyncing}
            onClick={() => void handleManualSync()}
            title="Sincronizar com o Supabase"
            className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-surface-container-lowest text-on-surface-variant hover:text-on-surface hover:bg-surface-container shadow-xs transition-all cursor-pointer disabled:opacity-60"
          >
            <Icon
              name="sync"
              className={`text-lg ${isLoading || isSyncing ? 'animate-spin text-primary' : ''}`}
            />
          </button>
        </div>
      </section>

      {/* Filter & Time-Horizon Bar (Mês, Últimos 3 Meses, Últimos 6 Meses, Ano, Histórico, Personalizado) */}
      <section className="bg-surface-container-lowest rounded-xl p-space-sm shadow-xs flex flex-col xl:flex-row items-stretch xl:items-center justify-between gap-space-md">
        <div className="flex items-center gap-1 overflow-x-auto pb-1 xl:pb-0">
          {PERIOD_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => setPeriodId(preset.id)}
              className={`px-space-md py-2 rounded-lg text-sm transition-all whitespace-nowrap cursor-pointer ${
                periodId === preset.id
                  ? 'bg-primary-container text-on-primary-container font-semibold shadow-2xs'
                  : 'text-on-surface-variant hover:bg-surface-container-low font-medium'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-space-sm justify-end">
          {periodId === '1m' && onSelectMonthKey && availableMonthKeys.length > 0 && (
            <select
              aria-label="Selecionar mês do relatório"
              value={selectedMonthKey}
              onChange={(e) => onSelectMonthKey(e.target.value)}
              className="px-space-md py-2 bg-surface-container-low rounded-xl text-on-surface text-xs font-semibold focus:outline-none cursor-pointer"
            >
              {availableMonthKeys.map((mKey) => (
                <option key={mKey} value={mKey}>
                  {getMonthLabelFromKey(mKey)}
                </option>
              ))}
            </select>
          )}

          {periodId === 'yr' && onSelectMonthKey && availableYears.length > 0 && (
            <select
              aria-label="Selecionar ano do relatório"
              value={selectedMonthKey.slice(0, 4)}
              onChange={(e) => {
                const targetYr = e.target.value;
                const currentMm = selectedMonthKey.slice(5, 7) || '01';
                onSelectMonthKey(`${targetYr}-${currentMm}`);
              }}
              className="px-space-md py-2 bg-surface-container-low rounded-xl text-on-surface text-xs font-semibold focus:outline-none cursor-pointer"
            >
              {availableYears.map((yr) => (
                <option key={yr} value={yr}>
                  Ano {yr}
                </option>
              ))}
            </select>
          )}

          {periodId === 'custom' ? (
            <div className="flex items-center gap-1.5 bg-surface-container-low px-3 py-1.5 rounded-xl text-xs">
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="bg-transparent text-on-surface font-semibold focus:outline-none tabular-nums"
              />
              <span className="text-secondary">até</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="bg-transparent text-on-surface font-semibold focus:outline-none tabular-nums"
              />
            </div>
          ) : (
            <div className="flex items-center gap-2 px-space-md py-2 bg-surface-container-low rounded-xl text-on-surface text-xs">
              <Icon name="calendar_month" className="text-primary text-base" />
              <span className="font-semibold">{activeRangeLabel}</span>
              <span className="text-on-surface-variant tabular-nums">
                | {periodTransactions.length}{' '}
                {periodTransactions.length === 1 ? 'lançamento' : 'lançamentos'}
              </span>
            </div>
          )}

          <select
            aria-label="Filtrar relatório por conta"
            value={accountScope}
            onChange={(e) => setAccountScope(e.target.value)}
            className="px-space-md py-2 bg-surface-container-low rounded-xl text-on-surface text-xs font-semibold focus:outline-none cursor-pointer"
          >
            <option value="all">Todas as Contas ({accounts.length})</option>
            {accounts.map((acc) => (
              <option key={acc.id} value={acc.id}>
                {acc.name}
              </option>
            ))}
          </select>
        </div>
      </section>

      {/* KPI Executive Overview Metrics */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-space-md">
        <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-space-sm">
              <span className="text-xs font-semibold text-on-surface-variant uppercase">
                Receitas no Período
              </span>
              <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                <Icon name="trending_up" className="text-xl" filled />
              </div>
            </div>
            <div className="text-3xl font-bold text-on-surface tracking-tight mb-1 tabular-nums">
              {formatBRL(totalIncome)}
            </div>
          </div>
          <div className="flex items-center justify-between pt-space-sm mt-space-sm text-xs">
            <span className="inline-flex items-center gap-0.5 text-primary font-semibold tabular-nums">
              {periodTransactions.filter((t) => t.type === 'receita').length} entradas
            </span>
            <span className="text-on-surface-variant">
              {chronologicalSeries.length}{' '}
              {chronologicalSeries.length === 1 ? 'competência' : 'competências'}
            </span>
          </div>
        </div>

        <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-space-sm">
              <span className="text-xs font-semibold text-on-surface-variant uppercase">
                Despesas no Período
              </span>
              <div className="w-9 h-9 rounded-full bg-error/10 flex items-center justify-center text-error">
                <Icon name="trending_down" className="text-xl" filled />
              </div>
            </div>
            <div className="text-3xl font-bold text-on-surface tracking-tight mb-1 tabular-nums">
              {formatBRL(totalExpenses)}
            </div>
          </div>
          <div className="flex items-center justify-between pt-space-sm mt-space-sm text-xs">
            <span className="inline-flex items-center gap-0.5 text-error font-semibold tabular-nums">
              {periodTransactions.filter((t) => t.type === 'despesa').length} saídas
            </span>
            <span className="text-on-surface-variant">
              {expenseBreakdown.length}{' '}
              {expenseBreakdown.length === 1 ? 'categoria ativa' : 'categorias ativas'}
            </span>
          </div>
        </div>

        <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-space-sm">
              <span className="text-xs font-semibold text-on-surface-variant uppercase">
                Saldo do Período
              </span>
              <div className="w-9 h-9 rounded-full bg-tertiary/10 flex items-center justify-center text-tertiary">
                <Icon name="savings" className="text-xl" filled />
              </div>
            </div>
            <div
              className={`text-3xl font-bold tracking-tight mb-1 tabular-nums ${
                totalNet >= 0 ? 'text-on-surface' : 'text-error'
              }`}
            >
              {formatBRL(totalNet, totalNet < 0 ? 'minus' : undefined)}
            </div>
          </div>
          <div className="space-y-1.5 pt-space-sm mt-space-sm">
            <div className="flex items-center justify-between text-xs tabular-nums">
              <span className="text-on-surface-variant">Taxa de Poupança</span>
              <span className={`font-bold ${avgSavingsRateNum >= 0 ? 'text-primary' : 'text-error'}`}>
                {avgSavingsRate}%
              </span>
            </div>
            <svg className="w-full h-1.5 rounded-full overflow-hidden" viewBox="0 0 100 6" preserveAspectRatio="none">
              <rect width="100" height="6" rx="3" className="fill-surface-container" />
              <rect
                width={Math.max(0, Math.min(100, avgSavingsRateNum))}
                height="6"
                rx="3"
                className="fill-primary"
              />
            </svg>
          </div>
        </div>

        <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-space-sm">
              <span className="text-xs font-semibold text-on-surface-variant uppercase">
                Saldo Acumulado Final
              </span>
              <div className="w-9 h-9 rounded-full bg-secondary/10 flex items-center justify-center text-secondary">
                <Icon name="account_balance_wallet" className="text-xl" />
              </div>
            </div>
            <div
              className={`text-3xl font-bold tracking-tight mb-1 tabular-nums ${
                evolutionData.closingBalance >= 0 ? 'text-on-surface' : 'text-error'
              }`}
            >
              {formatBRL(
                evolutionData.closingBalance,
                evolutionData.closingBalance < 0 ? 'minus' : undefined
              )}
            </div>
          </div>
          <div className="flex items-center justify-between pt-space-sm mt-space-sm text-xs tabular-nums">
            <span className="text-on-surface-variant">Média de gastos:</span>
            <span className="text-on-surface font-semibold">
              {formatBRL(avgMonthlyExpense)}/mês
            </span>
          </div>
        </div>
      </section>

      {/* Dynamic Smart Insight Banner */}
      {!insightDismissed && (
        <section className="bg-gradient-to-r from-primary-fixed/50 to-surface-container-low rounded-xl p-space-lg shadow-xs relative overflow-hidden">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-space-md relative z-10">
            <div className="flex items-center gap-space-md">
              <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center text-on-primary shadow-2xs shrink-0">
                <Icon name="auto_awesome" className="text-2xl" filled />
              </div>
              <div className="space-y-0.5">
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-primary uppercase font-bold tracking-wider">
                    Diagnóstico Financeiro Dinâmico
                  </span>
                  <span>·</span>
                  <span className="text-primary font-semibold">Dados Reais Supabase</span>
                </div>
                <p className="text-sm text-on-surface font-medium leading-relaxed">
                  {topExpenseCat ? (
                    <>
                      Sua maior categoria de saída no período é{' '}
                      <strong className="font-semibold text-primary">
                        {topExpenseCat.name} ({topExpenseCat.pct}%)
                      </strong>
                      , somando{' '}
                      <strong className="tabular-nums">{formatBRL(topExpenseCat.amount)}</strong>.
                      {topGoal && totalNet > 0 && (
                        <>
                          {' '}
                          Seu saldo positivo de{' '}
                          <strong className="tabular-nums">{formatBRL(totalNet)}</strong> pode
                          acelerar a meta{' '}
                          <span className="underline decoration-primary font-semibold">
                            {topGoal.name}
                          </span>
                          .
                        </>
                      )}
                    </>
                  ) : periodTransactions.length > 0 ? (
                    <>
                      Você registrou{' '}
                      <strong className="tabular-nums">{formatBRL(totalIncome)}</strong> em receitas
                      e nenhuma despesa neste filtro — saldo positivo integral de{' '}
                      <strong className="tabular-nums">{formatBRL(totalNet)}</strong>.
                    </>
                  ) : (
                    <>
                      Nenhuma movimentação encontrada para o período selecionado ({activeRangeLabel}
                      ). Cadastre uma receita ou despesa ou altere o filtro acima para visualizar a
                      evolução.
                    </>
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
              <button
                type="button"
                onClick={() => onNavigate('movimentacoes')}
                className="px-space-md py-2 rounded-xl bg-surface-container-lowest hover:bg-surface-container text-on-surface text-sm font-semibold transition-all shadow-2xs cursor-pointer whitespace-nowrap"
              >
                Ver Extrato
              </button>
              <button
                type="button"
                onClick={() => setInsightDismissed(true)}
                aria-label="Dispensar insight"
                className="w-8 h-8 flex items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container/60 transition-colors cursor-pointer"
              >
                <Icon name="close" className="text-base" />
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Main Visual Analytics Grid */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-space-lg">
        {/* Left 7 cols */}
        <div className="lg:col-span-7 flex flex-col space-y-gutter">
          {/* Chart 1: Receitas vs Despesas + Linha de Saldo */}
          <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-xs flex flex-col justify-between">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-space-sm mb-space-md">
              <div>
                <h2 className="text-lg font-bold text-on-surface">
                  Receitas, Despesas e Saldo
                </h2>
                <p className="text-xs text-on-surface-variant">
                  Comparativo por competência calculado em tempo real das suas movimentações
                </p>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-3 text-xs font-medium text-on-surface-variant">
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-xs bg-primary" />
                    Receitas
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-xs bg-error/80" />
                    Despesas
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-0.5 bg-tertiary inline-block" />
                    Saldo
                  </span>
                </div>
                <div className="bg-surface-container-low p-1 rounded-lg flex items-center text-xs">
                  <button
                    type="button"
                    onClick={() => setChartCadence('mensal')}
                    className={`px-2 py-0.5 rounded cursor-pointer ${
                      chartCadence === 'mensal'
                        ? 'bg-surface-container-lowest text-on-surface font-semibold shadow-2xs'
                        : 'text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    Mensal
                  </button>
                  <button
                    type="button"
                    onClick={() => setChartCadence('trimestral')}
                    className={`px-2 py-0.5 rounded cursor-pointer ${
                      chartCadence === 'trimestral'
                        ? 'bg-surface-container-lowest text-on-surface font-semibold shadow-2xs'
                        : 'text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    Trimestral
                  </button>
                </div>
              </div>
            </div>

            {/* Live Hover Inspection Strip */}
            {hoveredBar && chartCadence === 'mensal' && (
              <div className="mb-space-sm px-3 py-1.5 rounded-lg bg-surface-container-low flex flex-wrap items-center justify-between gap-2 text-xs tabular-nums">
                <span className="font-bold text-on-surface">{hoveredBar.monthLabel}</span>
                <div className="flex items-center gap-3">
                  <span className="text-primary font-semibold">
                    Receitas: {formatBRL(hoveredBar.income)}
                  </span>
                  <span className="text-error font-semibold">
                    Despesas: {formatBRL(hoveredBar.expenses)}
                  </span>
                  <span
                    className={`font-bold ${
                      hoveredBar.net >= 0 ? 'text-primary' : 'text-error'
                    }`}
                  >
                    Saldo: {formatBRL(hoveredBar.net, 'auto')}
                  </span>
                </div>
              </div>
            )}

            <div className="w-full h-72 relative">
              {periodTransactions.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center px-4 bg-surface-container-low/40 rounded-xl">
                  <Icon name="bar_chart" className="text-3xl text-secondary mb-2" />
                  <p className="text-sm font-semibold text-on-surface">
                    Sem movimentações neste período
                  </p>
                  <p className="text-xs text-secondary max-w-sm mt-1">
                    Assim que uma receita ou despesa for cadastrada neste período, as barras e a linha de saldo serão exibidas automaticamente.
                  </p>
                </div>
              ) : chartCadence === 'mensal' ? (
                <svg className="w-full h-full" viewBox="0 0 640 250">
                  {incomeExpenseChart.yTicks.map((t) => (
                    <g key={t.key}>
                      <line
                        stroke={t.isZero ? '#94A3B8' : '#E2E8F0'}
                        strokeDasharray={t.isZero ? undefined : '3 3'}
                        strokeWidth={t.isZero ? '1.3' : '1'}
                        x1="50"
                        x2="625"
                        y1={t.y}
                        y2={t.y}
                      />
                      <text
                        className="text-[10px] fill-secondary"
                        textAnchor="end"
                        x="44"
                        y={t.y + 3}
                      >
                        {t.label}
                      </text>
                    </g>
                  ))}

                  {incomeExpenseChart.bars.map((b) => (
                    <g
                      key={b.monthKey}
                      onMouseEnter={() => setHoveredBarKey(b.monthKey)}
                      onMouseLeave={() => setHoveredBarKey(null)}
                      className="cursor-pointer"
                    >
                      <rect
                        fill="transparent"
                        x={b.centerX - b.barW - 8}
                        y={16}
                        width={b.barW * 2 + 16}
                        height={226}
                      />
                      {b.incH > 0 && (
                        <rect
                          className="fill-primary hover:opacity-90 transition-opacity"
                          height={b.incH}
                          rx="4"
                          width={b.barW}
                          x={b.incX}
                          y={b.incY}
                        >
                          <title>
                            {b.monthLabel} • Receitas: {formatBRL(b.income)}
                          </title>
                        </rect>
                      )}
                      {b.expH > 0 && (
                        <rect
                          className="fill-error/80 hover:opacity-90 transition-opacity"
                          height={b.expH}
                          rx="4"
                          width={b.barW}
                          x={b.expX}
                          y={b.expY}
                        >
                          <title>
                            {b.monthLabel} • Despesas: {formatBRL(b.expenses)}
                          </title>
                        </rect>
                      )}
                      <text
                        className={`text-[10px] ${
                          b.isHighlight || hoveredBarKey === b.monthKey
                            ? 'fill-primary font-bold'
                            : 'fill-secondary font-medium'
                        }`}
                        textAnchor="middle"
                        x={b.centerX}
                        y="241"
                      >
                        {b.shortLabel.replace(' (Atual)', '')}
                      </text>
                    </g>
                  ))}

                  {incomeExpenseChart.bars.length > 1 && (
                    <polyline
                      fill="none"
                      points={incomeExpenseChart.polylinePoints}
                      stroke="#2170E4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2.5"
                    />
                  )}
                  {incomeExpenseChart.bars.map((b) => (
                    <circle
                      key={`dot-${b.monthKey}`}
                      className={
                        b.net < 0
                          ? 'fill-error stroke-white'
                          : 'fill-white stroke-tertiary'
                      }
                      cx={b.centerX}
                      cy={b.netY}
                      r={hoveredBarKey === b.monthKey || b.isHighlight ? 5 : 3.5}
                      strokeWidth="2"
                      onMouseEnter={() => setHoveredBarKey(b.monthKey)}
                      onMouseLeave={() => setHoveredBarKey(null)}
                    >
                      <title>
                        Saldo ({b.monthLabel}): {formatBRL(b.net, 'auto')}
                      </title>
                    </circle>
                  ))}
                </svg>
              ) : (
                <svg className="w-full h-full" viewBox="0 0 640 250">
                  <line
                    stroke="#E2E8F0"
                    strokeDasharray="3 3"
                    strokeWidth="1"
                    x1="50"
                    x2="625"
                    y1="40"
                    y2="40"
                  />
                  <line
                    stroke="#E2E8F0"
                    strokeDasharray="3 3"
                    strokeWidth="1"
                    x1="50"
                    x2="625"
                    y1="130"
                    y2="130"
                  />
                  <line stroke="#94A3B8" strokeWidth="1.2" x1="50" x2="625" y1="220" y2="220" />
                  <text className="text-[10px] fill-secondary" textAnchor="end" x="44" y="44">
                    {formatCompactAxisBRL(quarterlyGeometry.ceiling)}
                  </text>
                  <text className="text-[10px] fill-secondary" textAnchor="end" x="44" y="134">
                    {formatCompactAxisBRL(quarterlyGeometry.ceiling / 2)}
                  </text>
                  <text className="text-[10px] fill-secondary" textAnchor="end" x="44" y="224">
                    0
                  </text>

                  {quarterlyGeometry.items.map((q, idx) => {
                    const count = quarterlyGeometry.items.length;
                    const centerX =
                      count === 1 ? 335 : Math.round(145 + idx * (380 / Math.max(1, count - 1)));
                    const incH =
                      q.income > 0
                        ? Math.max(4, Math.round((q.income / quarterlyGeometry.ceiling) * 180))
                        : 0;
                    const expH =
                      q.expenses > 0
                        ? Math.max(4, Math.round((q.expenses / quarterlyGeometry.ceiling) * 180))
                        : 0;
                    return (
                      <g key={q.quarter}>
                        {incH > 0 && (
                          <rect
                            className="fill-primary"
                            height={incH}
                            rx="6"
                            width="44"
                            x={centerX - 47}
                            y={220 - incH}
                          >
                            <title>
                              {q.quarter} • Receitas: {formatBRL(q.income)}
                            </title>
                          </rect>
                        )}
                        {expH > 0 && (
                          <rect
                            className="fill-error/80"
                            height={expH}
                            rx="6"
                            width="44"
                            x={centerX + 3}
                            y={220 - expH}
                          >
                            <title>
                              {q.quarter} • Despesas: {formatBRL(q.expenses)}
                            </title>
                          </rect>
                        )}
                        <text
                          className="text-[11px] fill-on-surface font-semibold"
                          textAnchor="middle"
                          x={centerX}
                          y="240"
                        >
                          {q.quarter} ({formatBRL(q.income - q.expenses, 'auto')})
                        </text>
                      </g>
                    );
                  })}
                </svg>
              )}
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-on-surface-variant bg-surface-container-low/50 px-space-md py-2 rounded-lg mt-space-sm">
              <div className="flex items-center gap-1.5">
                <Icon name="show_chart" className="text-sm text-tertiary" />
                <span>
                  A linha azul representa o <strong>Saldo Líquido</strong> (Receitas − Despesas) em cada competência.
                </span>
              </div>
              {incomeExpenseChart.bestPoint && (
                <span className="font-semibold text-primary tabular-nums">
                  Melhor saldo: {incomeExpenseChart.bestPoint.monthLabel} (
                  {formatBRL(incomeExpenseChart.bestPoint.net, 'auto')})
                </span>
              )}
            </div>
          </div>

          {/* Chart 2: Evolução Financeira Acumulada & Saldo Líquido por Mês */}
          <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-xs flex flex-col justify-between">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-space-sm mb-space-md">
              <div>
                <h2 className="text-lg font-bold text-on-surface">
                  {evolutionTab === 'acumulado'
                    ? 'Evolução Financeira Acumulada'
                    : 'Saldo Líquido por Competência'}
                </h2>
                <p className="text-xs text-on-surface-variant">
                  {evolutionTab === 'acumulado'
                    ? periodId === '1m'
                      ? 'Progressão do saldo acumulado dia a dia dentro do mês selecionado'
                      : 'Trajetória real do saldo acumulado (saldo inicial das contas + movimentações)'
                    : 'Superávit (positivo) ou déficit (negativo) apurado em cada mês do período'}
                </p>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <div className="bg-surface-container-low p-1 rounded-lg flex items-center text-xs">
                  <button
                    type="button"
                    onClick={() => setEvolutionTab('acumulado')}
                    className={`px-2.5 py-0.5 rounded cursor-pointer ${
                      evolutionTab === 'acumulado'
                        ? 'bg-surface-container-lowest text-on-surface font-semibold shadow-2xs'
                        : 'text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    Evolução
                  </button>
                  <button
                    type="button"
                    onClick={() => setEvolutionTab('saldo_mensal')}
                    className={`px-2.5 py-0.5 rounded cursor-pointer ${
                      evolutionTab === 'saldo_mensal'
                        ? 'bg-surface-container-lowest text-on-surface font-semibold shadow-2xs'
                        : 'text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    Saldo Mensal
                  </button>
                </div>

                <span
                  className={`inline-flex items-center gap-1 text-xs font-bold tabular-nums ${
                    evolutionData.netChange >= 0 ? 'text-primary' : 'text-error'
                  }`}
                >
                  <Icon
                    name={evolutionData.netChange >= 0 ? 'trending_up' : 'trending_down'}
                    className="text-sm"
                  />
                  {evolutionData.growthPct >= 0 ? '+' : ''}
                  {evolutionData.growthPct.toFixed(1).replace('.', ',')}%
                </span>
              </div>
            </div>

            {hoveredEvo && evolutionTab === 'acumulado' && (
              <div className="mb-space-sm px-3 py-1.5 rounded-lg bg-surface-container-low flex flex-wrap items-center justify-between gap-2 text-xs tabular-nums">
                <span className="font-bold text-on-surface">{hoveredEvo.fullLabel}</span>
                <div className="flex items-center gap-3">
                  <span className="font-bold text-primary">
                    Saldo acumulado: {formatBRL(hoveredEvo.balance)}
                  </span>
                  {hoveredEvo.periodDelta !== 0 && (
                    <span
                      className={`font-semibold ${
                        hoveredEvo.periodDelta >= 0 ? 'text-primary' : 'text-error'
                      }`}
                    >
                      Variação: {formatBRL(hoveredEvo.periodDelta, 'auto')}
                    </span>
                  )}
                </div>
              </div>
            )}

            <div className="w-full h-48 relative">
              {evolutionTab === 'acumulado' ? (
                <svg className="w-full h-full" viewBox="0 0 640 175">
                  <defs>
                    <linearGradient id="relAreaGradient" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="#006948" stopOpacity="0.25" />
                      <stop offset="100%" stopColor="#006948" stopOpacity="0.0" />
                    </linearGradient>
                  </defs>

                  {evolutionSvg.yGuides.map((g) => (
                    <g key={g.id}>
                      <line
                        stroke="#E2E8F0"
                        strokeDasharray="3 3"
                        strokeWidth="1"
                        x1="48"
                        x2="622"
                        y1={g.y}
                        y2={g.y}
                      />
                      <text
                        className="text-[10px] fill-secondary"
                        textAnchor="end"
                        x="42"
                        y={g.y + 3}
                      >
                        {g.label}
                      </text>
                    </g>
                  ))}

                  {evolutionSvg.areaPath && (
                    <path d={evolutionSvg.areaPath} fill="url(#relAreaGradient)" />
                  )}
                  {evolutionSvg.linePath && (
                    <path
                      d={evolutionSvg.linePath}
                      fill="none"
                      stroke="#006948"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="3"
                    />
                  )}
                  {evolutionSvg.coords.map((c, idx) => {
                    const showLabel =
                      evolutionSvg.coords.length <= 7 ||
                      idx === 0 ||
                      idx === evolutionSvg.coords.length - 1 ||
                      idx % Math.ceil(evolutionSvg.coords.length / 6) === 0;

                    return (
                      <g
                        key={c.key}
                        onMouseEnter={() => setHoveredEvoKey(c.key)}
                        onMouseLeave={() => setHoveredEvoKey(null)}
                        className="cursor-pointer"
                      >
                        <circle
                          className={
                            idx === evolutionSvg.coords.length - 1 || hoveredEvoKey === c.key
                              ? 'fill-primary stroke-white'
                              : 'fill-white stroke-primary'
                          }
                          cx={c.x}
                          cy={c.y}
                          r={
                            idx === evolutionSvg.coords.length - 1 || hoveredEvoKey === c.key
                              ? 5.5
                              : 4
                          }
                          strokeWidth="2"
                        >
                          <title>
                            {c.fullLabel}: {formatBRL(c.balance)}
                          </title>
                        </circle>
                        {showLabel && (
                          <text
                            className="text-[10px] fill-secondary font-medium"
                            textAnchor="middle"
                            x={c.x}
                            y="166"
                          >
                            {c.label}
                          </text>
                        )}
                      </g>
                    );
                  })}
                </svg>
              ) : (
                <svg className="w-full h-full" viewBox="0 0 640 175">
                  <line
                    stroke="#E2E8F0"
                    strokeDasharray="3 3"
                    strokeWidth="1"
                    x1="48"
                    x2="622"
                    y1={saldoMensalSvg.zeroY - 58}
                    y2={saldoMensalSvg.zeroY - 58}
                  />
                  <line
                    stroke="#94A3B8"
                    strokeWidth="1.3"
                    x1="48"
                    x2="622"
                    y1={saldoMensalSvg.zeroY}
                    y2={saldoMensalSvg.zeroY}
                  />
                  <line
                    stroke="#E2E8F0"
                    strokeDasharray="3 3"
                    strokeWidth="1"
                    x1="48"
                    x2="622"
                    y1={saldoMensalSvg.zeroY + 58}
                    y2={saldoMensalSvg.zeroY + 58}
                  />
                  <text
                    className="text-[10px] fill-secondary"
                    textAnchor="end"
                    x="42"
                    y={saldoMensalSvg.zeroY - 55}
                  >
                    +{formatCompactAxisBRL(saldoMensalSvg.bound)}
                  </text>
                  <text
                    className="text-[10px] fill-secondary font-semibold"
                    textAnchor="end"
                    x="42"
                    y={saldoMensalSvg.zeroY + 3}
                  >
                    0
                  </text>
                  <text
                    className="text-[10px] fill-secondary"
                    textAnchor="end"
                    x="42"
                    y={saldoMensalSvg.zeroY + 61}
                  >
                    -{formatCompactAxisBRL(saldoMensalSvg.bound)}
                  </text>

                  {saldoMensalSvg.items.map((item) => (
                    <g key={item.monthKey}>
                      <rect
                        className={
                          item.net > 0
                            ? 'fill-primary hover:opacity-90'
                            : item.net < 0
                            ? 'fill-error/85 hover:opacity-90'
                            : 'fill-outline-variant'
                        }
                        x={item.x}
                        y={item.y}
                        width={item.w}
                        height={item.h}
                        rx="4"
                      >
                        <title>
                          {item.monthLabel} • Saldo: {formatBRL(item.net, 'auto')}
                        </title>
                      </rect>
                      <text
                        className="text-[10px] fill-secondary font-medium"
                        textAnchor="middle"
                        x={item.centerX}
                        y="167"
                      >
                        {item.shortLabel.replace(' (Atual)', '')}
                      </text>
                    </g>
                  ))}
                </svg>
              )}
            </div>

            <div className="grid grid-cols-3 gap-space-sm text-center pt-space-sm tabular-nums">
              <div className="bg-surface-container-low rounded-lg p-2.5">
                <span className="text-xs text-on-surface-variant block">Saldo Inicial Período</span>
                <span className="text-sm sm:text-base text-on-surface font-semibold">
                  {formatBRL(
                    evolutionData.openingBalance,
                    evolutionData.openingBalance < 0 ? 'minus' : undefined
                  )}
                </span>
              </div>
              <div className="bg-surface-container-low rounded-lg p-2.5">
                <span className="text-xs text-on-surface-variant block">Variação no Período</span>
                <span
                  className={`text-sm sm:text-base font-bold ${
                    evolutionData.netChange >= 0 ? 'text-primary' : 'text-error'
                  }`}
                >
                  {formatBRL(evolutionData.netChange, 'auto')}
                </span>
              </div>
              <div className="bg-surface-container-low rounded-lg p-2.5">
                <span className="text-xs text-on-surface-variant block">Saldo Final Acumulado</span>
                <span className="text-sm sm:text-base text-on-surface font-bold">
                  {formatBRL(
                    evolutionData.closingBalance,
                    evolutionData.closingBalance < 0 ? 'minus' : undefined
                  )}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right 5 cols: Category Donut & Dynamic Ranking (Despesas | Receitas) */}
        <div className="lg:col-span-5 flex flex-col">
          <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-xs flex flex-col justify-between h-full">
            <div>
              <div className="flex items-start justify-between gap-2 mb-space-md">
                <div>
                  <h2 className="text-lg font-bold text-on-surface">
                    {categoryTab === 'despesa'
                      ? 'Despesas por Categoria'
                      : 'Receitas por Categoria'}
                  </h2>
                  <p className="text-xs text-on-surface-variant tabular-nums">
                    Divisão proporcional de {formatBRL(activeCategoryTotal)}
                  </p>
                </div>

                <div className="bg-surface-container-low p-1 rounded-lg flex items-center text-xs shrink-0">
                  <button
                    type="button"
                    onClick={() => setCategoryTab('despesa')}
                    className={`px-2 py-0.5 rounded cursor-pointer ${
                      categoryTab === 'despesa'
                        ? 'bg-surface-container-lowest text-on-surface font-semibold shadow-2xs'
                        : 'text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    Despesas
                  </button>
                  <button
                    type="button"
                    onClick={() => setCategoryTab('receita')}
                    className={`px-2 py-0.5 rounded cursor-pointer ${
                      categoryTab === 'receita'
                        ? 'bg-surface-container-lowest text-on-surface font-semibold shadow-2xs'
                        : 'text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    Receitas
                  </button>
                </div>
              </div>

              {activeCategoryBreakdown.length === 0 ? (
                <div className="py-6">
                  <EmptyState
                    icon="pie_chart"
                    title={
                      categoryTab === 'despesa'
                        ? 'Sem despesas no filtro atual'
                        : 'Sem receitas no filtro atual'
                    }
                    description={`Não há ${
                      categoryTab === 'despesa' ? 'despesas' : 'receitas'
                    } registradas para esta combinação de período e conta.`}
                  />
                </div>
              ) : (
                <DonutChart
                  items={activeCategoryBreakdown.slice(0, 6)}
                  totalAmount={activeCategoryTotal}
                  centerLabel={categoryTab === 'despesa' ? 'DESPESAS' : 'RECEITAS'}
                  compactTotal
                  onSelectCategory={() => onNavigate('categorias')}
                />
              )}
            </div>

            {activeCategoryBreakdown.length > 0 && (
              <div className="space-y-space-md pt-space-sm">
                {activeCategoryBreakdown.slice(0, 5).map((item, idx) => (
                  <div key={item.id} className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-surface-container-low text-on-surface">
                          <Icon name={item.icon} className="text-sm" />
                        </span>
                        <span className="text-on-surface font-semibold truncate">
                          {idx + 1}. {item.name}
                        </span>
                        <span className="text-xs text-on-surface-variant tabular-nums shrink-0">
                          {item.pct.toFixed(1).replace('.', ',')}%
                        </span>
                      </div>
                      <div className="text-right tabular-nums shrink-0">
                        <span className="font-semibold text-on-surface">
                          {formatBRL(item.amount)}
                        </span>
                        <span className="text-[11px] text-secondary block">
                          {item.count} {item.count === 1 ? 'lançamento' : 'lançamentos'}
                        </span>
                      </div>
                    </div>
                    <svg className="w-full h-2 rounded-full overflow-hidden" viewBox="0 0 100 8" preserveAspectRatio="none">
                      <rect width="100" height="8" rx="4" className="fill-surface-container" />
                      <rect
                        width={Math.min(100, Math.max(2, item.pct))}
                        height="8"
                        rx="4"
                        fill={item.color}
                      />
                    </svg>
                  </div>
                ))}

                <button
                  type="button"
                  onClick={() => onNavigate('categorias')}
                  className="inline-flex items-center justify-center w-full gap-1 pt-2 text-primary text-sm hover:underline font-semibold cursor-pointer"
                >
                  <span>Gerenciar categorias ({categories.length})</span>
                  <Icon name="arrow_forward" className="text-sm" />
                </button>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Detailed Monthly Breakdown Table */}
      <section className="bg-surface-container-lowest rounded-xl shadow-xs overflow-hidden">
        <div className="p-space-lg flex flex-col sm:flex-row sm:items-center justify-between gap-space-sm">
          <div>
            <h2 className="text-lg font-bold text-on-surface">Detalhamento Mês a Mês</h2>
            <p className="text-xs text-on-surface-variant">
              Balanço consolidado calculado diretamente das movimentações registradas no Supabase
            </p>
          </div>
          <div className="flex items-center gap-space-sm">
            <div className="relative">
              <input
                type="text"
                value={monthSearch}
                onChange={(e) => setMonthSearch(e.target.value)}
                placeholder="Filtrar competência..."
                className="w-48 pl-8 pr-3 py-1.5 text-xs bg-surface-container-low rounded-lg text-on-surface focus:outline-none"
              />
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-on-surface-variant flex items-center">
                <Icon name="search" className="text-sm" />
              </span>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-container-low text-on-surface-variant text-xs uppercase tracking-wider">
                <th className="py-3 px-space-lg font-semibold">Mês de Referência</th>
                <th className="py-3 px-space-md text-right font-semibold">Receitas</th>
                <th className="py-3 px-space-md text-right font-semibold">Despesas</th>
                <th className="py-3 px-space-md text-right font-semibold">Saldo do Mês</th>
                <th className="py-3 px-space-md text-center font-semibold">% Poupado</th>
                <th className="py-3 px-space-lg text-right font-semibold">Diagnóstico</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container/60 text-sm tabular-nums">
              {searchedRows.map((row) => (
                <tr
                  key={row.monthKey}
                  className={`hover:bg-surface-container-low/40 transition-colors ${
                    row.isHighlight ? 'bg-primary/5' : ''
                  }`}
                >
                  <td className="py-3.5 px-space-lg font-semibold text-on-surface">
                    {row.monthLabel}
                    {row.isCurrent && (
                      <span className="ml-1.5 text-xs text-primary font-medium">(Selecionado)</span>
                    )}
                  </td>
                  <td className="py-3.5 px-space-md text-right text-primary font-medium">
                    +{formatBRL(row.income)}
                  </td>
                  <td className="py-3.5 px-space-md text-right text-error font-medium">
                    -{formatBRL(row.expenses)}
                  </td>
                  <td
                    className={`py-3.5 px-space-md text-right font-bold ${
                      row.net >= 0 ? 'text-primary' : 'text-error'
                    }`}
                  >
                    {formatBRL(row.net, 'auto')}
                  </td>
                  <td className="py-3.5 px-space-md text-center">
                    <span
                      className={`font-semibold text-xs ${
                        row.isHighlight ? 'text-primary font-bold' : 'text-on-surface'
                      }`}
                    >
                      {row.savingsRate.toFixed(1).replace('.', ',')}%
                    </span>
                  </td>
                  <td className="py-3.5 px-space-lg text-right">
                    <span
                      className={`inline-flex items-center gap-1 text-xs font-semibold ${
                        row.statusTone === 'atencao'
                          ? 'text-error'
                          : row.statusTone === 'esperado'
                          ? 'text-secondary'
                          : 'text-primary'
                      }`}
                    >
                      <Icon
                        name={
                          row.statusTone === 'recorde'
                            ? 'stars'
                            : row.statusTone === 'atencao'
                            ? 'warning'
                            : row.statusTone === 'esperado'
                            ? 'task_alt'
                            : 'check_circle'
                        }
                        className="text-sm"
                      />
                      {row.statusLabel}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-surface-container text-sm tabular-nums">
              <tr>
                <th className="py-4 px-space-lg text-on-surface font-bold">
                  TOTAL ACUMULADO ({chronologicalSeries.length}{' '}
                  {chronologicalSeries.length === 1 ? 'MÊS' : 'MESES'})
                </th>
                <th className="py-4 px-space-md text-right text-primary font-bold">
                  +{formatBRL(totalIncome)}
                </th>
                <th className="py-4 px-space-md text-right text-error font-bold">
                  -{formatBRL(totalExpenses)}
                </th>
                <th
                  className={`py-4 px-space-md text-right font-bold ${
                    totalNet >= 0 ? 'text-primary' : 'text-error'
                  }`}
                >
                  {formatBRL(totalNet, 'auto')}
                </th>
                <th className="py-4 px-space-md text-center text-primary font-bold">
                  {avgSavingsRate}% (Média)
                </th>
                <th className="py-4 px-space-lg text-right text-on-surface-variant font-medium">
                  {positiveMonthsCount}/{chronologicalSeries.length} Meses Positivos
                </th>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* Financial Advisory Cards (Dynamic) */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-space-md">
        <div className="bg-surface-container-lowest rounded-xl p-space-md shadow-xs flex items-start gap-space-sm">
          <div className="w-10 h-10 rounded-xl bg-tertiary/10 text-tertiary flex items-center justify-center shrink-0">
            <Icon name="query_stats" className="text-xl" />
          </div>
          <div>
            <h3 className="text-base text-on-surface font-semibold">Cobertura de Liquidez</h3>
            <p className="text-xs text-on-surface-variant mt-0.5 leading-relaxed">
              Seu saldo acumulado final cobre cerca de <strong>{emergencyCoverageMonths} meses</strong> do seu custo médio mensal ({formatBRL(avgMonthlyExpense)}).
            </p>
          </div>
        </div>

        <div className="bg-surface-container-lowest rounded-xl p-space-md shadow-xs flex items-start gap-space-sm">
          <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Icon name="savings" className="text-xl" />
          </div>
          <div>
            <h3 className="text-base text-on-surface font-semibold">Resultado Acumulado</h3>
            <p className="text-xs text-on-surface-variant mt-0.5 leading-relaxed">
              No recorte selecionado, a diferença entre receitas e despesas resultou em{' '}
              <strong className="tabular-nums">{formatBRL(totalNet, 'auto')}</strong>.
            </p>
          </div>
        </div>

        <div className="bg-surface-container-lowest rounded-xl p-space-md shadow-xs flex items-start gap-space-sm">
          <div className="w-10 h-10 rounded-xl bg-secondary-container text-on-secondary-container flex items-center justify-center shrink-0">
            <Icon name="table_chart" className="text-xl" />
          </div>
          <div>
            <h3 className="text-base text-on-surface font-semibold">Exportação Contábil</h3>
            <p className="text-xs text-on-surface-variant mt-0.5 leading-relaxed">
              Exporte os {periodTransactions.length} lançamentos filtrados em CSV ou imprima este relatório em PDF.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};
