import React, { useMemo, useState } from 'react';
import { formatBRL } from '../data/initialData';
import {
  computeExpenseBreakdown,
  computeMoMComparison,
  computeMonthlySeries,
  filterTransactionsByMonthKey,
  getTxMonthKey,
} from '../services/analyticsService';
import { AccountItem, Category, GoalItem, ScreenId, Transaction } from '../types/finance';
import { Icon } from '../components/Icon';
import { DonutChart } from '../components/charts/DonutChart';
import { MonthlyBarChart } from '../components/charts/MonthlyBarChart';
import { EmptyState } from '../components/ui/EmptyState';

export type DashboardPeriodScope = 'month' | '3m' | '6m' | 'year' | 'all';

interface DashboardViewProps {
  transactions: Transaction[];
  categories: Category[];
  goals: GoalItem[];
  accounts: AccountItem[];
  availableMonthKeys: string[];
  selectedMonth: string;
  selectedMonthKey: string;
  totalConsolidatedBalance: number;
  isLoading?: boolean;
  onRefresh?: () => void;
  onNavigate: (screen: ScreenId) => void;
  onSelectMonthKey: (monthKey: string) => void;
  onOpenNewTransaction: () => void;
  onEditTransaction: (tx: Transaction) => void;
  onDeleteTransaction: (tx: Transaction) => void;
  onExportCsv: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  transactions,
  categories,
  goals,
  accounts,
  availableMonthKeys,
  selectedMonth,
  selectedMonthKey,
  totalConsolidatedBalance,
  isLoading = false,
  onRefresh,
  onNavigate,
  onSelectMonthKey,
  onOpenNewTransaction,
  onEditTransaction,
  onDeleteTransaction,
  onExportCsv,
}) => {
  const [periodScope, setPeriodScope] = useState<DashboardPeriodScope>('month');
  const [chartView, setChartView] = useState<'6m' | 'yr'>('6m');
  const [txFilter, setTxFilter] = useState<'all' | 'receita' | 'despesa'>('all');

  const selectedYear = selectedMonthKey.slice(0, 4);

  const periodLabel = useMemo(() => {
    if (periodScope === 'month') return selectedMonth;
    if (periodScope === '3m') return 'Últimos 3 meses';
    if (periodScope === '6m') return 'Últimos 6 meses';
    if (periodScope === 'year') return `Ano ${selectedYear}`;
    return 'Todo o histórico';
  }, [periodScope, selectedMonth, selectedYear]);

  // Filter transactions strictly by the selected period
  const scopedTransactions = useMemo(() => {
    let list: Transaction[];
    if (periodScope === 'all') {
      list = transactions;
    } else if (periodScope === 'month') {
      list = filterTransactionsByMonthKey(transactions, selectedMonthKey);
    } else if (periodScope === 'year') {
      list = transactions.filter((t) => t.date.startsWith(selectedYear));
    } else {
      const windowSize = periodScope === '3m' ? 3 : 6;
      const activeIdx = availableMonthKeys.indexOf(selectedMonthKey);
      const endIdx = activeIdx >= 0 ? activeIdx + 1 : availableMonthKeys.length;
      const startIdx = Math.max(0, endIdx - windowSize);
      const allowedKeys = new Set(availableMonthKeys.slice(startIdx, endIdx));
      list = transactions.filter((t) => allowedKeys.has(getTxMonthKey(t)));
    }
    return [...list].sort(
      (a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time)
    );
  }, [transactions, periodScope, selectedMonthKey, selectedYear, availableMonthKeys]);

  // Real calculations from authenticated user's transactions in the selected period
  const periodIncome = useMemo(
    () =>
      scopedTransactions
        .filter((t) => t.type === 'receita')
        .reduce((acc, t) => acc + t.amount, 0),
    [scopedTransactions]
  );

  const periodExpense = useMemo(
    () =>
      scopedTransactions
        .filter((t) => t.type === 'despesa')
        .reduce((acc, t) => acc + t.amount, 0),
    [scopedTransactions]
  );

  const periodBalance = periodIncome - periodExpense;
  const accountsCount = accounts.length;
  const consolidatedBalance = totalConsolidatedBalance;

  const savingsPct =
    periodIncome > 0
      ? ((periodBalance / periodIncome) * 100).toFixed(1).replace('.', ',')
      : '0,0';

  const mom = useMemo(
    () => computeMoMComparison(transactions, selectedMonthKey),
    [transactions, selectedMonthKey]
  );

  const incomeEntriesCount = scopedTransactions.filter((t) => t.type === 'receita').length;
  const expenseEntriesCount = scopedTransactions.filter((t) => t.type === 'despesa').length;

  const chartMonthKeys = useMemo(() => {
    if (chartView === 'yr') {
      const yrKeys = availableMonthKeys.filter((k) => k.startsWith(selectedYear));
      return yrKeys.length > 0 ? yrKeys : availableMonthKeys.slice(-6);
    }
    const activeIdx = availableMonthKeys.indexOf(selectedMonthKey);
    if (activeIdx >= 5) {
      return availableMonthKeys.slice(activeIdx - 5, activeIdx + 1);
    }
    return availableMonthKeys.slice(-6);
  }, [chartView, availableMonthKeys, selectedMonthKey, selectedYear]);

  const chartPoints = useMemo(
    () => computeMonthlySeries(transactions, chartMonthKeys, selectedMonthKey),
    [transactions, chartMonthKeys, selectedMonthKey]
  );

  const cumulativeNet = useMemo(
    () => chartPoints.reduce((sum, p) => sum + p.net, 0),
    [chartPoints]
  );

  const averageNet = useMemo(
    () => (chartPoints.length > 0 ? Math.round(cumulativeNet / chartPoints.length) : 0),
    [cumulativeNet, chartPoints.length]
  );

  const expenseBreakdown = useMemo(
    () => computeExpenseBreakdown(scopedTransactions, categories),
    [scopedTransactions, categories]
  );

  const recentTransactions = useMemo(
    () =>
      scopedTransactions
        .filter((t) => (txFilter === 'all' ? true : t.type === txFilter))
        .slice(0, 6),
    [scopedTransactions, txFilter]
  );

  const activeGoals = useMemo(
    () => goals.filter((g) => g.status === 'active').slice(0, 2),
    [goals]
  );

  return (
    <div className="flex flex-col w-full space-y-gutter">
      {/* PERIOD BAR & SYNC INDICATOR */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-surface-container-lowest rounded-xl px-space-md py-3 shadow-xs">
        <div className="flex items-center gap-2 text-xs text-secondary">
          <Icon name="calendar_month" className="text-lg text-primary" />
          <span>
            Exibindo dados reais de: <strong className="text-on-surface">{periodLabel}</strong>
          </span>
          {isLoading && (
            <span className="inline-flex items-center gap-1 text-primary font-semibold ml-2">
              <Icon name="progress_activity" className="text-sm animate-spin" />
              Atualizando...
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex bg-surface-container-low p-1 rounded-xl gap-1 overflow-x-auto max-w-full">
            {(
              [
                { id: 'month', label: 'Mês Selecionado' },
                { id: '3m', label: '3 Meses' },
                { id: '6m', label: '6 Meses' },
                { id: 'year', label: `Ano ${selectedYear}` },
                { id: 'all', label: 'Tudo' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setPeriodScope(opt.id)}
                className={`px-2.5 py-1 rounded-lg text-xs whitespace-nowrap transition-all cursor-pointer ${
                  periodScope === opt.id
                    ? 'bg-surface-container-lowest text-primary font-semibold shadow-2xs'
                    : 'text-secondary hover:text-on-surface font-medium'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={isLoading}
              title="Recarregar dados do banco"
              className="w-8 h-8 rounded-lg bg-surface-container-low hover:bg-surface-container text-secondary hover:text-on-surface flex items-center justify-center transition-colors cursor-pointer disabled:opacity-50"
            >
              <Icon
                name="refresh"
                className={`text-base ${isLoading ? 'animate-spin text-primary' : ''}`}
              />
            </button>
          )}
        </div>
      </div>

      {/* TOP SUMMARY: 4 KPI CARDS */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-gutter">
        {/* CARD 1: SALDO TOTAL */}
        <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-xs hover:shadow-md transition-shadow relative overflow-hidden flex flex-col justify-between">
          <div className="absolute -right-4 -top-4 w-24 h-24 bg-primary/5 rounded-full blur-xl pointer-events-none" />
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-secondary">Saldo Total</span>
            <div className="w-9 h-9 rounded-xl bg-surface-container-low flex items-center justify-center text-primary">
              <Icon name="account_balance_wallet" className="text-xl" filled />
            </div>
          </div>
          <div className="mt-space-md mb-space-sm">
            <div
              className={`text-[32px] leading-10 font-bold tracking-tight tabular-nums ${
                consolidatedBalance > 0
                  ? 'text-primary'
                  : consolidatedBalance < 0
                  ? 'text-error'
                  : 'text-on-surface'
              }`}
            >
              {consolidatedBalance === 0
                ? formatBRL(0)
                : formatBRL(consolidatedBalance, consolidatedBalance < 0 ? 'minus' : undefined)}
            </div>
          </div>
          <div className="flex items-center gap-1.5 pt-space-xs text-xs text-secondary">
            <Icon
              name={consolidatedBalance >= 0 ? 'account_balance' : 'trending_down'}
              className={`text-sm ${consolidatedBalance >= 0 ? 'text-primary' : 'text-error'}`}
            />
            <span className="truncate">
              {accountsCount > 0
                ? `${accountsCount} ${accountsCount === 1 ? 'conta sincronizada' : 'contas sincronizadas'}`
                : 'Consolidado das movimentações'}
            </span>
          </div>
        </div>

        {/* CARD 2: RECEITAS DO MÊS */}
        <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-xs hover:shadow-md transition-shadow relative overflow-hidden flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-secondary">
              {periodScope === 'month' ? 'Receitas do Mês' : 'Receitas no Período'}
            </span>
            <div className="w-9 h-9 rounded-xl bg-primary-fixed/30 flex items-center justify-center text-primary">
              <Icon name="arrow_upward" className="text-xl font-bold" />
            </div>
          </div>
          <div className="mt-space-md mb-space-sm">
            <div className="text-[32px] leading-10 font-bold text-primary tracking-tight tabular-nums">
              {formatBRL(periodIncome)}
            </div>
          </div>
          <div className="flex items-center gap-1.5 pt-space-xs text-xs text-secondary">
            <span className="font-semibold text-on-surface-variant tabular-nums">
              {incomeEntriesCount} {incomeEntriesCount === 1 ? 'entrada' : 'entradas'}
            </span>
            {periodScope === 'month' && mom.prevIncome > 0 && (
              <>
                <span>·</span>
                <span className="truncate">
                  {mom.incomeDeltaPct >= 0 ? '+' : ''}
                  {mom.incomeDeltaPct.toFixed(1).replace('.', ',')}% vs. mês ant.
                </span>
              </>
            )}
          </div>
        </div>

        {/* CARD 3: DESPESAS DO MÊS */}
        <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-xs hover:shadow-md transition-shadow relative overflow-hidden flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-secondary">
              {periodScope === 'month' ? 'Despesas do Mês' : 'Despesas no Período'}
            </span>
            <div className="w-9 h-9 rounded-xl bg-error-container/60 flex items-center justify-center text-error">
              <Icon name="arrow_downward" className="text-xl font-bold" />
            </div>
          </div>
          <div className="mt-space-md mb-space-sm">
            <div className="text-[32px] leading-10 font-bold text-on-surface tracking-tight tabular-nums">
              {formatBRL(periodExpense)}
            </div>
          </div>
          <div className="flex items-center gap-1.5 pt-space-xs text-xs text-secondary">
            <span className="font-semibold text-on-surface-variant tabular-nums">
              {expenseEntriesCount} {expenseEntriesCount === 1 ? 'saída' : 'saídas'}
            </span>
            {periodScope === 'month' && mom.prevExpense > 0 && (
              <>
                <span>·</span>
                <span
                  className={`font-semibold tabular-nums truncate ${
                    mom.expenseDeltaPct <= 0 ? 'text-primary' : 'text-error'
                  }`}
                >
                  {mom.expenseDeltaPct > 0 ? '+' : ''}
                  {mom.expenseDeltaPct.toFixed(1).replace('.', ',')}% vs.{' '}
                  {mom.prevMonthLabel.split(',')[0]}
                </span>
              </>
            )}
          </div>
        </div>

        {/* CARD 4: ECONOMIA MENSAL */}
        <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-xs hover:shadow-md transition-shadow relative overflow-hidden flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-secondary">
              {periodScope === 'month' ? 'Economia Mensal' : 'Economia no Período'}
            </span>
            <div className="w-9 h-9 rounded-xl bg-secondary-container flex items-center justify-center text-tertiary">
              <Icon name="savings" className="text-xl" filled />
            </div>
          </div>
          <div className="mt-space-md mb-space-sm">
            <div
              className={`text-[32px] leading-10 font-bold tracking-tight tabular-nums ${
                periodBalance > 0
                  ? 'text-primary'
                  : periodBalance < 0
                  ? 'text-error'
                  : 'text-on-surface'
              }`}
            >
              {periodBalance === 0 ? formatBRL(0) : formatBRL(periodBalance, 'auto')}
            </div>
          </div>
          <div className="flex items-center justify-between pt-space-xs text-xs">
            <span className="text-secondary truncate">{periodLabel}</span>
            <span
              className={`font-bold tabular-nums shrink-0 ${
                periodBalance >= 0 ? 'text-primary' : 'text-error'
              }`}
            >
              {savingsPct}% da receita
            </span>
          </div>
        </div>
      </section>

      {/* CHARTS SECTION: 12-COL GRID (8 COLS EVOLUTION + 4 COLS CATEGORIES) */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-gutter">
        {/* MAIN COLUMN: EVOLUÇÃO MENSAL */}
        <div className="lg:col-span-8 bg-surface-container-lowest rounded-xl p-space-lg shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-space-sm mb-space-lg">
              <div>
                <h2 className="text-xl font-bold text-on-surface tracking-tight">Evolução Mensal</h2>
                <p className="text-xs text-secondary">
                  Comparativo real das entradas e saídas registradas (clique em um mês para selecionar)
                </p>
              </div>
              <div className="flex items-center gap-space-sm">
                <div className="inline-flex bg-surface-container-low p-1 rounded-xl gap-1">
                  <button
                    type="button"
                    onClick={() => setChartView('6m')}
                    className={`px-2.5 py-1 text-xs rounded-lg transition-all cursor-pointer whitespace-nowrap ${
                      chartView === '6m'
                        ? 'bg-surface-container-lowest text-on-surface shadow-2xs font-semibold'
                        : 'text-secondary hover:text-on-surface font-medium'
                    }`}
                  >
                    Últimos 6 meses
                  </button>
                  <button
                    type="button"
                    onClick={() => setChartView('yr')}
                    className={`px-2.5 py-1 text-xs rounded-lg transition-all cursor-pointer whitespace-nowrap ${
                      chartView === 'yr'
                        ? 'bg-surface-container-lowest text-on-surface shadow-2xs font-semibold'
                        : 'text-secondary hover:text-on-surface font-medium'
                    }`}
                  >
                    Ano {selectedYear}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={onExportCsv}
                  className="w-8 h-8 rounded-lg bg-surface-container-low text-secondary hover:text-on-surface flex items-center justify-center transition-colors cursor-pointer"
                  title="Exportar movimentações em CSV"
                >
                  <Icon name="download" className="text-lg" />
                </button>
              </div>
            </div>

            {/* LEGENDS */}
            <div className="flex items-center gap-space-lg mb-space-md">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-xs bg-primary inline-block" />
                <span className="text-xs text-on-surface font-semibold">Receitas (Entradas)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-xs bg-secondary-fixed-dim inline-block" />
                <span className="text-xs text-on-surface font-semibold">Despesas (Saídas)</span>
              </div>
            </div>

            <MonthlyBarChart
              points={chartPoints}
              onSelectMonth={(mk) => {
                setPeriodScope('month');
                onSelectMonthKey(mk);
              }}
            />
          </div>

          {/* FOOTER STATS */}
          <div className="mt-space-lg bg-surface-container-low/70 rounded-xl px-space-md py-2.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Icon
                name={cumulativeNet >= 0 ? 'verified' : 'info'}
                className={`${cumulativeNet >= 0 ? 'text-primary' : 'text-error'} text-lg`}
              />
              <span className="text-xs text-on-surface">
                Balanço acumulado de{' '}
                <strong
                  className={`${
                    cumulativeNet >= 0 ? 'text-primary' : 'text-error'
                  } font-semibold tabular-nums`}
                >
                  {formatBRL(cumulativeNet)}
                </strong>{' '}
                no intervalo do gráfico ({chartPoints.length} meses).
              </span>
            </div>
            <span className="text-xs text-secondary font-medium tabular-nums">
              Média líquida de {formatBRL(averageNet)}/mês
            </span>
          </div>
        </div>

        {/* SIDE COLUMN: DISTRIBUIÇÃO DE DESPESAS (DONUT CHART) */}
        <div className="lg:col-span-4 bg-surface-container-lowest rounded-xl p-space-lg shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-space-md">
              <h2 className="text-xl font-bold text-on-surface tracking-tight">Despesas</h2>
              <span className="text-xs text-secondary font-medium">{periodLabel}</span>
            </div>

            {expenseBreakdown.length === 0 ? (
              <div className="py-6">
                <EmptyState
                  icon="pie_chart"
                  title="Sem despesas no período"
                  description={`Nenhum gasto registrado em ${periodLabel}. Lance uma despesa para acompanhar a divisão por categoria.`}
                  actionLabel="Lançar Despesa"
                  onAction={onOpenNewTransaction}
                />
              </div>
            ) : (
              <>
                <DonutChart
                  items={expenseBreakdown.slice(0, 6)}
                  totalAmount={periodExpense}
                  onSelectCategory={() => onNavigate('categorias')}
                />

                <div className="space-y-1.5 pt-1">
                  {expenseBreakdown.slice(0, 5).map((cat) => (
                    <div
                      key={cat.id}
                      onClick={() => onNavigate('categorias')}
                      className="flex items-center justify-between py-1.5 px-2 rounded-lg cursor-pointer hover:bg-surface-container-low transition-colors"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="w-2.5 h-2.5 rounded-xs shrink-0"
                          style={{ backgroundColor: cat.color }}
                        />
                        <span className="text-sm text-on-surface truncate">{cat.name}</span>
                      </div>
                      <div className="text-right tabular-nums shrink-0">
                        <span className="text-sm font-semibold text-on-surface">
                          {formatBRL(cat.amount)}
                        </span>
                        <span className="text-xs text-secondary ml-1.5">{cat.pct}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="mt-space-md pt-2 text-center">
            <button
              type="button"
              onClick={() => onNavigate('categorias')}
              className="text-xs text-primary hover:text-primary-container font-semibold transition-colors inline-flex items-center gap-1 cursor-pointer"
            >
              <span>Gerenciar limites por categoria</span>
              <Icon name="arrow_forward" className="text-sm" />
            </button>
          </div>
        </div>
      </section>

      {/* BOTTOM SECTION: TRANSACTIONS & GOALS */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-gutter">
        {/* LEFT: RECENT TRANSACTIONS (8 COLS) */}
        <div className="lg:col-span-8 bg-surface-container-lowest rounded-xl p-space-lg shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-space-sm mb-space-md">
            <div>
              <h2 className="text-xl font-bold text-on-surface tracking-tight">
                Movimentações ({periodLabel})
              </h2>
              <p className="text-xs text-secondary">
                Lançamentos reais do seu perfil autenticado no período selecionado
              </p>
            </div>
            <div className="flex items-center gap-space-md flex-wrap">
              <div className="inline-flex bg-surface-container-low p-1 rounded-xl text-xs">
                {(
                  [
                    { id: 'all', label: 'Todas' },
                    { id: 'receita', label: 'Receitas' },
                    { id: 'despesa', label: 'Despesas' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setTxFilter(tab.id)}
                    className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                      txFilter === tab.id
                        ? 'bg-surface-container-lowest text-on-surface font-semibold shadow-2xs'
                        : 'text-secondary hover:text-on-surface font-medium'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => onNavigate('movimentacoes')}
                className="text-xs text-primary font-semibold hover:underline inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
              >
                <span>Extrato completo</span>
                <Icon name="east" className="text-sm" />
              </button>
            </div>
          </div>

          {recentTransactions.length === 0 ? (
            <EmptyState
              icon="receipt_long"
              title="Nenhuma movimentação registrada neste período"
              description={`Ainda não há lançamentos em ${periodLabel}${
                txFilter !== 'all' ? ` para o tipo "${txFilter}"` : ''
              }. Clique abaixo para registrar sua primeira receita ou despesa.`}
              actionLabel="Nova Movimentação"
              onAction={onOpenNewTransaction}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-surface-container-low/60 text-secondary text-xs uppercase tracking-wider">
                    <th className="py-2.5 px-space-md rounded-l-lg font-semibold">
                      Descrição / Favorecido
                    </th>
                    <th className="py-2.5 px-space-md font-semibold hidden sm:table-cell">
                      Categoria
                    </th>
                    <th className="py-2.5 px-space-md font-semibold hidden md:table-cell">Conta</th>
                    <th className="py-2.5 px-space-md font-semibold hidden sm:table-cell">Data</th>
                    <th className="py-2.5 px-space-md text-right font-semibold">Valor</th>
                    <th className="py-2.5 px-3 text-right rounded-r-lg font-semibold w-20">
                      Ações
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-container-low text-sm">
                  {recentTransactions.map((tx) => (
                    <tr
                      key={tx.id}
                      className="hover:bg-surface-container-low/60 transition-colors group"
                    >
                      <td className="py-3 px-space-md">
                        <div className="flex items-center gap-space-sm">
                          <div
                            className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                              tx.type === 'receita'
                                ? 'bg-primary-fixed/40 text-primary'
                                : 'bg-secondary-container text-secondary'
                            }`}
                          >
                            <Icon name={tx.icon} className="text-base" />
                          </div>
                          <div className="min-w-0">
                            <div className="font-medium text-on-surface truncate max-w-[200px] sm:max-w-[240px]">
                              {tx.title}
                            </div>
                            <div className="text-[11px] text-secondary sm:hidden">
                              {tx.dateLabel} • {tx.account}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-space-md text-xs font-medium text-on-surface-variant hidden sm:table-cell">
                        {tx.category}
                      </td>
                      <td className="py-3 px-space-md text-secondary text-xs font-medium hidden md:table-cell">
                        {tx.account}
                      </td>
                      <td className="py-3 px-space-md text-secondary text-xs hidden sm:table-cell whitespace-nowrap">
                        {tx.dateLabel}, {tx.time}
                      </td>
                      <td
                        className={`py-3 px-space-md text-right text-sm font-bold tabular-nums whitespace-nowrap ${
                          tx.type === 'receita' ? 'text-primary' : 'text-error'
                        }`}
                      >
                        {formatBRL(tx.amount, tx.type === 'receita' ? 'plus' : 'minus')}
                      </td>
                      <td className="py-3 px-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => onEditTransaction(tx)}
                            title="Editar lançamento"
                            className="w-7 h-7 rounded-lg flex items-center justify-center text-secondary hover:text-primary hover:bg-surface-container transition-colors cursor-pointer"
                          >
                            <Icon name="edit" className="text-base" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteTransaction(tx)}
                            title="Excluir lançamento"
                            className="w-7 h-7 rounded-lg flex items-center justify-center text-secondary hover:text-error hover:bg-error-container transition-colors cursor-pointer"
                          >
                            <Icon name="delete" className="text-base" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* RIGHT: GOALS & SMART ADVISOR (4 COLS) */}
        <div className="lg:col-span-4 space-y-gutter flex flex-col justify-between">
          <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-xs flex flex-col justify-between h-full">
            <div>
              <div className="flex items-center justify-between mb-space-md">
                <h2 className="text-xl font-bold text-on-surface tracking-tight">
                  Metas de Poupança
                </h2>
                <button
                  type="button"
                  onClick={() => onNavigate('metas')}
                  className="text-xs text-primary font-semibold hover:underline cursor-pointer"
                >
                  Ver todas
                </button>
              </div>

              {activeGoals.length === 0 ? (
                <div className="bg-surface-container-low/60 rounded-xl p-space-md text-xs text-secondary space-y-2">
                  <p>Você ainda não possui metas financeiras cadastradas.</p>
                  <button
                    type="button"
                    onClick={() => onNavigate('metas')}
                    className="text-primary font-semibold hover:underline cursor-pointer inline-flex items-center gap-1"
                  >
                    <span>Criar primeira meta</span>
                    <Icon name="arrow_forward" className="text-sm" />
                  </button>
                </div>
              ) : (
                <div className="space-y-space-md">
                  {activeGoals.map((g) => {
                    const pct =
                      g.targetAmount > 0
                        ? Math.min(100, Math.round((g.currentAmount / g.targetAmount) * 100))
                        : 0;
                    const isTertiary = g.theme === 'tertiary';
                    return (
                      <div key={g.id} className="bg-surface-container-low/60 rounded-xl p-space-md">
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2 min-w-0">
                            <Icon
                              name={g.icon}
                              className={`${
                                isTertiary ? 'text-tertiary' : 'text-primary'
                              } text-xl shrink-0`}
                              filled
                            />
                            <span className="text-sm font-bold text-on-surface truncate">
                              {g.name}
                            </span>
                          </div>
                          <span
                            className={`text-xs font-semibold tabular-nums ${
                              isTertiary ? 'text-tertiary' : 'text-primary'
                            }`}
                          >
                            {pct}%
                          </span>
                        </div>
                        <div className="w-full h-2 bg-surface-container rounded-full overflow-hidden mb-2">
                          <div
                            className={`h-full ${
                              isTertiary ? 'bg-tertiary' : 'bg-primary'
                            } rounded-full transition-all duration-300`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <div className="flex items-center justify-between text-xs text-secondary tabular-nums">
                          <span>{formatBRL(g.currentAmount)}</span>
                          <span>Meta: {formatBRL(g.targetAmount)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* DYNAMIC SMART INSIGHT BANNER */}
            <div className="mt-space-md bg-primary-fixed/20 rounded-xl p-space-md flex items-start gap-space-sm">
              <div className="w-8 h-8 rounded-lg bg-primary-container text-on-primary-container flex items-center justify-center shrink-0 mt-0.5">
                <Icon name="auto_awesome" className="text-lg" />
              </div>
              <div>
                <span className="text-xs font-bold text-primary block mb-0.5">
                  Resumo do Período
                </span>
                <p className="text-xs text-on-surface-variant leading-relaxed">
                  {periodBalance > 0 ? (
                    <>
                      Em <strong>{periodLabel}</strong>, seu saldo líquido é positivo em{' '}
                      <strong className="text-primary font-semibold tabular-nums">
                        {formatBRL(periodBalance)}
                      </strong>{' '}
                      ({savingsPct}% das receitas).
                    </>
                  ) : scopedTransactions.length === 0 ? (
                    <>
                      Nenhum lançamento registrado em <strong>{periodLabel}</strong>. Clique em
                      &quot;Nova Movimentação&quot; para adicionar receitas ou despesas.
                    </>
                  ) : (
                    <>
                      Atenção: suas despesas em <strong>{periodLabel}</strong> superaram as receitas
                      em{' '}
                      <strong className="text-error font-semibold tabular-nums">
                        {formatBRL(Math.abs(periodBalance))}
                      </strong>
                      .
                    </>
                  )}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
