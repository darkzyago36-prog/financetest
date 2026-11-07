import React, { useState, useRef, useEffect, useMemo } from 'react';
import { formatBRL, getMonthLabelFromKey, getTodayIso } from '../data/initialData';
import {
  computeMoMComparison,
  filterTransactionsByAccount,
  filterTransactionsByMonthKey,
  getTxMonthKey,
} from '../services/analyticsService';
import { AccountItem, Category, Transaction } from '../types/finance';
import { Icon } from '../components/Icon';
import { EmptyState } from '../components/ui/EmptyState';

interface MovimentacoesViewProps {
  transactions: Transaction[];
  categories: Category[];
  accounts: AccountItem[];
  availableMonthKeys: string[];
  selectedMonth: string;
  selectedMonthKey: string;
  isLoading?: boolean;
  onRefresh?: () => void;
  initialAccountFilter?: string;
  onClearInitialAccountFilter?: () => void;
  onSelectMonthKey?: (monthKey: string) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onOpenNewTransaction: () => void;
  onEditTransaction: (tx: Transaction) => void;
  onDeleteTransaction: (tx: Transaction) => void;
  onDeleteBatch: (ids: string[]) => void;
  onMarkBatchPaid: (ids: string[]) => void;
  onChangeBatchCategory: (ids: string[], category: string) => void;
  onExportCsv: (rows?: Transaction[]) => void;
  forceMobilePreview: boolean;
}

type PeriodScope = 'month' | '3m' | '6m' | 'all' | 'day' | 'custom';

export const MovimentacoesView: React.FC<MovimentacoesViewProps> = ({
  transactions,
  categories,
  accounts,
  availableMonthKeys,
  selectedMonth,
  selectedMonthKey,
  isLoading = false,
  onRefresh,
  initialAccountFilter,
  onClearInitialAccountFilter,
  onSelectMonthKey,
  onPrevMonth,
  onNextMonth,
  onOpenNewTransaction,
  onEditTransaction,
  onDeleteTransaction,
  onDeleteBatch,
  onMarkBatchPaid,
  onChangeBatchCategory,
  onExportCsv,
  forceMobilePreview,
}) => {
  const [typeFilter, setTypeFilter] = useState<'all' | 'receita' | 'despesa'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('Todas as categorias');
  const [accountFilter, setAccountFilter] = useState('Todas as contas');
  const [periodScope, setPeriodScope] = useState<PeriodScope>('all');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [statusFilter, setStatusFilter] = useState('Todos os status');
  const [sortBy, setSortBy] = useState('Mais recentes');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const [batchCategoryOpen, setBatchCategoryOpen] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (initialAccountFilter) {
      setAccountFilter(initialAccountFilter);
      setCurrentPage(1);
      onClearInitialAccountFilter?.();
    }
  }, [initialAccountFilter, onClearInitialAccountFilter]);

  useEffect(() => {
    const validSet = new Set(transactions.map((t) => t.id));
    setSelectedIds((prev) => prev.filter((id) => validSet.has(id)));
  }, [transactions]);

  useEffect(() => {
    const handleSlashShortcut = (e: KeyboardEvent) => {
      if (
        e.key === '/' &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA' &&
        document.activeElement?.tagName !== 'SELECT'
      ) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleSlashShortcut);
    return () => window.removeEventListener('keydown', handleSlashShortcut);
  }, []);

  const categoryNames = useMemo(() => {
    const fromDb = categories.map((c) => c.name);
    const fromTx = transactions.map((t) => t.category).filter(Boolean);
    return Array.from(new Set([...fromDb, ...fromTx]));
  }, [categories, transactions]);

  // Scope transactions by selected period
  const periodTransactions = useMemo(() => {
    if (periodScope === 'all') return transactions;
    if (periodScope === 'month') {
      return filterTransactionsByMonthKey(transactions, selectedMonthKey);
    }
    if (periodScope === 'day') {
      if (!customStartDate) return transactions;
      return transactions.filter((tx) => tx.date === customStartDate);
    }
    if (periodScope === 'custom') {
      return transactions.filter(
        (tx) =>
          (!customStartDate || tx.date >= customStartDate) &&
          (!customEndDate || tx.date <= customEndDate)
      );
    }
    const activeIdx = availableMonthKeys.indexOf(selectedMonthKey);
    const windowSize = periodScope === '3m' ? 3 : 6;
    const endIdx = activeIdx >= 0 ? activeIdx + 1 : availableMonthKeys.length;
    const startIdx = Math.max(0, endIdx - windowSize);
    const allowedKeys = new Set(availableMonthKeys.slice(startIdx, endIdx));
    return transactions.filter((tx) => allowedKeys.has(getTxMonthKey(tx)));
  }, [
    transactions,
    periodScope,
    selectedMonthKey,
    availableMonthKeys,
    customStartDate,
    customEndDate,
  ]);

  const totalIncome = useMemo(
    () =>
      periodTransactions
        .filter((t) => t.type === 'receita')
        .reduce((acc, t) => acc + t.amount, 0),
    [periodTransactions]
  );

  const totalExpense = useMemo(
    () =>
      periodTransactions
        .filter((t) => t.type === 'despesa')
        .reduce((acc, t) => acc + t.amount, 0),
    [periodTransactions]
  );

  const netPeriod = totalIncome - totalExpense;
  const savingsRate =
    totalIncome > 0 ? ((netPeriod / totalIncome) * 100).toFixed(1).replace('.', ',') : '0,0';

  const totalExpenseBudget = useMemo(() => {
    const monthlySum = categories
      .filter((c) => c.type === 'despesa')
      .reduce((sum, c) => sum + c.budget, 0);
    const multiplier =
      periodScope === '3m' ? 3 : periodScope === '6m' ? 6 : periodScope === 'all' ? 6 : 1;
    return monthlySum * multiplier;
  }, [categories, periodScope]);

  const budgetPct =
    totalExpenseBudget > 0
      ? Math.min(100, Math.round((totalExpense / totalExpenseBudget) * 100))
      : 0;

  const mom = useMemo(
    () => computeMoMComparison(transactions, selectedMonthKey),
    [transactions, selectedMonthKey]
  );

  const incomeCount = periodTransactions.filter((t) => t.type === 'receita').length;
  const expenseCount = periodTransactions.filter((t) => t.type === 'despesa').length;

  // Filtered & sorted list
  const filteredTransactions = useMemo(() => {
    const byAccount = filterTransactionsByAccount(periodTransactions, accountFilter, accounts);

    return byAccount
      .filter((tx) => {
        if (typeFilter !== 'all' && tx.type !== typeFilter) return false;
        if (
          categoryFilter !== 'Todas as categorias' &&
          tx.category.trim().toLowerCase() !== categoryFilter.trim().toLowerCase()
        ) {
          return false;
        }
        if (statusFilter !== 'Todos os status') {
          if (statusFilter === 'Efetivado / Pago' && tx.status !== 'efetivado') return false;
          if (statusFilter === 'Pendente / Agendado' && tx.status !== 'pendente') return false;
          if (statusFilter === 'Conciliado' && tx.status !== 'conciliado') return false;
        }
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const match =
            tx.title.toLowerCase().includes(q) ||
            tx.subtitle.toLowerCase().includes(q) ||
            tx.category.toLowerCase().includes(q) ||
            (tx.subcategory || '').toLowerCase().includes(q) ||
            tx.account.toLowerCase().includes(q) ||
            (tx.tags || '').toLowerCase().includes(q);
          if (!match) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'Mais antigas') return a.date.localeCompare(b.date);
        if (sortBy === 'Maior valor') return b.amount - a.amount;
        if (sortBy === 'Menor valor') return a.amount - b.amount;
        if (sortBy === 'Alfabética (A-Z)') return a.title.localeCompare(b.title);
        return b.date.localeCompare(a.date) || b.time.localeCompare(a.time);
      });
  }, [
    periodTransactions,
    accountFilter,
    accounts,
    typeFilter,
    categoryFilter,
    statusFilter,
    searchQuery,
    sortBy,
  ]);

  const totalPages = Math.max(1, Math.ceil(filteredTransactions.length / itemsPerPage));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedTransactions = filteredTransactions.slice(
    (safePage - 1) * itemsPerPage,
    safePage * itemsPerPage
  );

  const resetFilters = () => {
    setTypeFilter('all');
    setSearchQuery('');
    setCategoryFilter('Todas as categorias');
    setAccountFilter('Todas as contas');
    setPeriodScope('all');
    setCustomStartDate('');
    setCustomEndDate('');
    setStatusFilter('Todos os status');
    setSortBy('Mais recentes');
    setCurrentPage(1);
  };

  const toggleSelectAll = () => {
    const visibleIds = paginatedTransactions.map((t) => t.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
    if (allSelected) {
      setSelectedIds((prev) => prev.filter((id) => !visibleIds.includes(id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
    }
  };

  const toggleSelectOne = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  // Group transactions by dateGroup for Mobile Feed
  const groupedMobile = useMemo(() => {
    return filteredTransactions.reduce<Record<string, Transaction[]>>((acc, tx) => {
      const group = tx.dateGroup || tx.dateLabel;
      if (!acc[group]) acc[group] = [];
      acc[group].push(tx);
      return acc;
    }, {});
  }, [filteredTransactions]);

  const mobileChipOptions = ['Todas', 'Despesas', 'Receitas', ...categoryNames.slice(0, 4)];

  const activeMobileChip =
    categoryFilter !== 'Todas as categorias'
      ? categoryFilter
      : typeFilter === 'despesa'
      ? 'Despesas'
      : typeFilter === 'receita'
      ? 'Receitas'
      : 'Todas';

  const handleMobileChipClick = (chip: string) => {
    if (chip === 'Todas') {
      setTypeFilter('all');
      setCategoryFilter('Todas as categorias');
    } else if (chip === 'Despesas') {
      setTypeFilter('despesa');
      setCategoryFilter('Todas as categorias');
    } else if (chip === 'Receitas') {
      setTypeFilter('receita');
      setCategoryFilter('Todas as categorias');
    } else {
      setTypeFilter('all');
      setCategoryFilter(chip);
    }
  };

  const hasUnlinkedAccounts = useMemo(
    () => transactions.some((t) => !t.accountId && t.account === 'Sem conta'),
    [transactions]
  );

  const periodTitleSuffix =
    periodScope === 'month'
      ? selectedMonth
      : periodScope === '3m'
      ? 'Últimos 3 Meses'
      : periodScope === '6m'
      ? 'Últimos 6 Meses'
      : periodScope === 'day'
      ? customStartDate
        ? `Data: ${customStartDate.split('-').reverse().join('/')}`
        : 'Data Específica'
      : periodScope === 'custom'
      ? `${customStartDate ? customStartDate.split('-').reverse().join('/') : 'Início'} a ${
          customEndDate ? customEndDate.split('-').reverse().join('/') : 'Hoje'
        }`
      : 'Todas as Datas';

  return (
    <>
      {/* MOBILE FEED LAYOUT */}
      <div
        className={`${
          forceMobilePreview ? 'block max-w-[430px] mx-auto' : 'lg:hidden block'
        } space-y-space-md pb-6`}
      >
        {/* Month Selector & Summary Card */}
        <section className="bg-surface-container-lowest rounded-xl shadow-xs p-space-md flex flex-col gap-space-md">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                setPeriodScope('month');
                setCustomStartDate('');
                setCustomEndDate('');
                onPrevMonth();
              }}
              aria-label="Mês anterior"
              className="w-9 h-9 rounded-full bg-surface-container flex items-center justify-center text-on-surface hover:bg-surface-container-high transition-colors active:scale-95 cursor-pointer"
            >
              <Icon name="chevron_left" className="text-[20px]" />
            </button>
            <div className="flex items-center gap-1.5">
              <Icon name="calendar_today" className="text-primary text-[20px]" />
              <span className="text-base text-on-surface font-bold">{periodTitleSuffix}</span>
            </div>
            <button
              type="button"
              onClick={() => {
                setPeriodScope('month');
                setCustomStartDate('');
                setCustomEndDate('');
                onNextMonth();
              }}
              aria-label="Próximo mês"
              className="w-9 h-9 rounded-full bg-surface-container flex items-center justify-center text-on-surface hover:bg-surface-container-high transition-colors active:scale-95 cursor-pointer"
            >
              <Icon name="chevron_right" className="text-[20px]" />
            </button>
          </div>

          {/* Mobile Period & Direct Date Filter */}
          <div className="flex flex-col gap-2">
            <select
              value={periodScope}
              onChange={(e) => {
                const next = e.target.value as PeriodScope;
                setPeriodScope(next);
                if (next === 'day') {
                  if (!customStartDate) setCustomStartDate(getTodayIso());
                  setCustomEndDate('');
                } else if (next === 'custom' && !customStartDate && !customEndDate) {
                  setCustomStartDate(`${selectedMonthKey}-01`);
                  setCustomEndDate(getTodayIso());
                } else if (next !== 'custom') {
                  setCustomStartDate('');
                  setCustomEndDate('');
                }
              }}
              className="w-full bg-surface-container-low text-on-surface rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none"
            >
              <option value="all">Período: Todo o histórico</option>
              <option value="month">Período: {selectedMonth}</option>
              <option value="3m">Período: Últimos 3 meses</option>
              <option value="6m">Período: Últimos 6 meses</option>
              <option value="day">Período: Data específica</option>
              <option value="custom">Período: Intervalo de datas</option>
            </select>

            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-0.5">
                <label className="text-[10px] font-semibold text-secondary uppercase px-1">
                  {periodScope === 'day' ? 'Data do Lançamento' : 'Data Inicial'}
                </label>
                <input
                  type="date"
                  value={customStartDate}
                  onChange={(e) => {
                    const val = e.target.value;
                    setCustomStartDate(val);
                    if (periodScope !== 'day') {
                      setPeriodScope(val || customEndDate ? 'custom' : 'all');
                    } else if (!val) {
                      setPeriodScope('all');
                    }
                    setCurrentPage(1);
                  }}
                  className="bg-surface-container-low rounded-xl px-2.5 py-1.5 text-xs text-on-surface tabular-nums focus:outline-none"
                />
              </div>
              <div className="flex flex-col gap-0.5">
                <label className="text-[10px] font-semibold text-secondary uppercase px-1">
                  Data Final
                </label>
                <input
                  type="date"
                  value={customEndDate}
                  disabled={periodScope === 'day'}
                  onChange={(e) => {
                    const val = e.target.value;
                    setCustomEndDate(val);
                    setPeriodScope(customStartDate || val ? 'custom' : 'all');
                    setCurrentPage(1);
                  }}
                  className="bg-surface-container-low rounded-xl px-2.5 py-1.5 text-xs text-on-surface tabular-nums focus:outline-none disabled:opacity-45"
                />
              </div>
            </div>
          </div>

          {/* Balance Trio Strip */}
          <div className="grid grid-cols-3 gap-2 pt-1">
            <div className="bg-surface-container-low rounded-xl p-2.5 flex flex-col justify-between">
              <div className="flex items-center gap-1 text-primary">
                <Icon name="arrow_downward" className="text-[15px]" />
                <span className="text-xs font-semibold text-on-surface-variant">Receitas</span>
              </div>
              <p className="text-sm text-primary font-bold mt-1 tracking-tight truncate tabular-nums">
                + R$ {Math.round(totalIncome).toLocaleString('pt-BR')}
              </p>
            </div>
            <div className="bg-error-container/40 rounded-xl p-2.5 flex flex-col justify-between">
              <div className="flex items-center gap-1 text-error">
                <Icon name="arrow_upward" className="text-[15px]" />
                <span className="text-xs font-semibold text-on-surface-variant">Despesas</span>
              </div>
              <p className="text-sm text-error font-bold mt-1 tracking-tight truncate tabular-nums">
                - R$ {Math.round(totalExpense).toLocaleString('pt-BR')}
              </p>
            </div>
            <div className="bg-primary-fixed/25 rounded-xl p-2.5 flex flex-col justify-between">
              <div className="flex items-center gap-1 text-on-primary-fixed-variant">
                <Icon name="account_balance" className="text-[15px]" />
                <span className="text-xs font-semibold text-on-surface-variant">Saldo</span>
              </div>
              <p className="text-sm text-on-surface font-bold mt-1 tracking-tight truncate tabular-nums">
                {netPeriod >= 0 ? '+' : '-'} R${' '}
                {Math.abs(Math.round(netPeriod)).toLocaleString('pt-BR')}
              </p>
            </div>
          </div>

          {totalExpenseBudget > 0 && (
            <div className="flex flex-col gap-1.5 pt-1">
              <div className="flex justify-between items-center text-on-surface-variant text-xs">
                <span className="font-semibold">Uso do Orçamento ({budgetPct}%)</span>
                <span
                  className={`font-semibold ${
                    budgetPct < 80 ? 'text-primary' : budgetPct <= 100 ? 'text-amber-700' : 'text-error'
                  }`}
                >
                  {budgetPct < 80 ? 'Saudável' : budgetPct <= 100 ? 'Atenção' : 'Excedido'}
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-surface-container overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    budgetPct <= 100 ? 'bg-primary-container' : 'bg-error'
                  }`}
                  style={{ width: `${budgetPct}%` }}
                />
              </div>
            </div>
          )}
        </section>

        {/* Search & Filter Chips */}
        <section className="flex flex-col gap-2.5">
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-surface-container-lowest rounded-xl shadow-xs px-3.5 h-11 flex items-center gap-2">
              <Icon name="search" className="text-on-surface-variant text-[20px]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar lançamento, loja, conta..."
                className="w-full bg-transparent text-on-surface placeholder:text-on-surface-variant/60 text-sm focus:outline-none"
              />
            </div>
            <button
              type="button"
              onClick={resetFilters}
              aria-label="Limpar filtros"
              title="Limpar filtros"
              className="w-11 h-11 rounded-xl bg-surface-container-lowest shadow-xs flex items-center justify-center text-on-surface-variant hover:text-primary active:scale-95 transition-all shrink-0 cursor-pointer"
            >
              <Icon name="restart_alt" className="text-[20px]" />
            </button>
          </div>

          {accountFilter !== 'Todas as contas' && (
            <div className="flex items-center justify-between px-3 py-1.5 rounded-xl bg-primary-fixed/30 text-xs text-on-surface">
              <span>
                Filtrando conta: <strong>{accountFilter}</strong>
              </span>
              <button
                type="button"
                onClick={() => setAccountFilter('Todas as contas')}
                className="text-primary font-semibold cursor-pointer"
              >
                Limpar
              </button>
            </div>
          )}

          <div className="flex gap-2 overflow-x-auto no-scrollbar py-0.5">
            {mobileChipOptions.map((chip) => {
              const active = activeMobileChip === chip;
              return (
                <button
                  key={chip}
                  type="button"
                  onClick={() => handleMobileChipClick(chip)}
                  className={`px-4 py-1.5 rounded-full text-sm whitespace-nowrap shadow-2xs transition-all cursor-pointer ${
                    active
                      ? 'bg-primary text-on-primary font-semibold'
                      : 'bg-surface-container-lowest text-on-surface-variant hover:text-on-surface font-medium'
                  }`}
                >
                  {chip}
                </button>
              );
            })}
          </div>
        </section>

        {/* Transactions Feed Grouped by Date */}
        <section className="space-y-4">
          {isLoading ? (
            <div className="bg-surface-container-lowest rounded-xl p-6 text-center space-y-2 shadow-xs">
              <Icon name="progress_activity" className="text-2xl text-primary animate-spin" />
              <p className="text-sm font-semibold text-on-surface">
                Carregando movimentações...
              </p>
            </div>
          ) : filteredTransactions.length === 0 ? (
            <EmptyState
              icon="receipt_long"
              title="Nenhuma movimentação encontrada"
              description="Não encontramos lançamentos para este período ou filtro. Adicione uma nova receita ou despesa ou limpe os filtros."
              actionLabel="Nova Movimentação"
              onAction={onOpenNewTransaction}
              secondaryLabel="Limpar Filtros"
              onSecondaryAction={resetFilters}
            />
          ) : (
            Object.entries(groupedMobile).map(([groupTitle, items]) => {
              const groupSum = items.reduce(
                (acc, t) => acc + (t.type === 'receita' ? t.amount : -t.amount),
                0
              );
              return (
                <div key={groupTitle} className="space-y-2">
                  <div className="flex items-center justify-between px-1">
                    <h3 className="text-xs text-on-surface-variant uppercase tracking-wider font-semibold">
                      {groupTitle}
                    </h3>
                    <span
                      className={`text-xs font-semibold tabular-nums ${
                        groupSum >= 0 ? 'text-primary' : 'text-on-surface-variant'
                      }`}
                    >
                      {formatBRL(groupSum, 'auto')}
                    </span>
                  </div>

                  {items.map((tx) => (
                    <article
                      key={tx.id}
                      className="bg-surface-container-lowest rounded-xl shadow-xs p-3.5 flex items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                            tx.type === 'receita'
                              ? 'bg-primary-fixed text-on-primary-fixed'
                              : tx.category.includes('Moradia')
                              ? 'bg-tertiary-fixed text-on-tertiary-fixed'
                              : tx.category.includes('Alimentação') || tx.category.includes('Saúde')
                              ? 'bg-error-container/50 text-error'
                              : 'bg-surface-container-highest text-secondary'
                          }`}
                        >
                          <Icon name={tx.icon} className="text-[22px]" />
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="text-base text-on-surface font-bold truncate">
                            {tx.title}
                          </span>
                          <div className="flex items-center gap-1.5 mt-0.5 text-xs text-on-surface-variant">
                            <span className="truncate">{tx.account}</span>
                            <span>·</span>
                            <span className="font-medium truncate">{tx.category}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col items-end shrink-0">
                        <span
                          className={`text-base font-bold tracking-tight tabular-nums whitespace-nowrap ${
                            tx.type === 'receita' ? 'text-primary' : 'text-error'
                          }`}
                        >
                          {formatBRL(tx.amount, tx.type === 'receita' ? 'plus' : 'minus')}
                        </span>
                        <div className="flex items-center gap-1 mt-1 text-on-surface-variant">
                          <button
                            type="button"
                            onClick={() => onEditTransaction(tx)}
                            aria-label="Editar"
                            className="p-1 hover:text-primary transition-colors cursor-pointer"
                          >
                            <Icon name="edit" className="text-[16px]" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteTransaction(tx)}
                            aria-label="Excluir"
                            className="p-1 hover:text-error transition-colors cursor-pointer"
                          >
                            <Icon name="delete" className="text-[16px]" />
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              );
            })
          )}
        </section>

        {/* Sticky Quick Action CTA */}
        <div className="pt-1">
          <button
            type="button"
            onClick={onOpenNewTransaction}
            className="w-full h-12 rounded-xl bg-primary text-on-primary shadow-md flex items-center justify-center gap-2 text-base font-semibold active:scale-[0.98] transition-all cursor-pointer"
          >
            <Icon name="add_circle" className="text-[22px]" />
            <span>Nova Movimentação</span>
          </button>
        </div>
      </div>

      {/* DESKTOP LEDGER LAYOUT */}
      {!forceMobilePreview && (
        <div className="hidden lg:flex flex-col w-full">
          {/* Top Breadcrumb & Actions */}
          <div className="flex flex-wrap items-center justify-between gap-space-sm mb-space-lg">
            <div className="flex flex-col">
              <div className="flex items-center gap-1 text-secondary text-xs mb-1">
                <span>Finanças Pessoais</span>
                <Icon name="chevron_right" className="text-xs" />
                <span className="text-primary font-semibold">
                  Extrato Consolidado • {periodTitleSuffix}
                </span>
              </div>
              <h1 className="text-[32px] leading-10 font-bold text-on-surface tracking-tight">
                Movimentações Financeiras
              </h1>
              <p className="text-sm text-secondary mt-0.5">
                Gerencie suas receitas e despesas sincronizadas com seu banco de dados Supabase.
              </p>
            </div>

            <div className="flex items-center gap-space-sm">
              {onRefresh && (
                <button
                  type="button"
                  onClick={onRefresh}
                  disabled={isLoading}
                  title="Sincronizar com o banco"
                  className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-surface-container-lowest hover:bg-surface-container text-on-surface text-sm font-medium shadow-xs transition-all cursor-pointer disabled:opacity-50"
                >
                  <Icon
                    name="refresh"
                    className={`text-lg text-secondary ${isLoading ? 'animate-spin text-primary' : ''}`}
                  />
                  <span>{isLoading ? 'Sincronizando...' : 'Atualizar'}</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => onExportCsv(filteredTransactions)}
                className="inline-flex items-center gap-1.5 px-space-md py-2.5 rounded-xl bg-surface-container-lowest hover:bg-surface-container text-on-surface text-sm font-medium shadow-xs transition-all cursor-pointer whitespace-nowrap"
              >
                <Icon name="download" className="text-lg text-secondary" />
                <span>Exportar CSV ({filteredTransactions.length})</span>
              </button>
              <button
                type="button"
                onClick={onOpenNewTransaction}
                className="inline-flex items-center gap-1.5 px-space-lg py-2.5 rounded-xl bg-primary hover:bg-primary-container text-on-primary text-sm font-semibold shadow-sm hover:shadow-md transition-all cursor-pointer whitespace-nowrap"
              >
                <Icon name="add_circle" className="text-lg" />
                <span>Nova Movimentação</span>
              </button>
            </div>
          </div>

          {/* 4 KPI Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-space-md mb-space-lg">
            <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-xs flex flex-col justify-between">
              <div className="flex items-center justify-between mb-space-md">
                <span className="text-xs text-secondary uppercase tracking-wider font-semibold">
                  Total Entradas ({periodScope === 'month' ? 'Mês' : 'Período'})
                </span>
                <div className="w-9 h-9 rounded-xl bg-primary-fixed/40 flex items-center justify-center text-primary">
                  <Icon name="trending_up" className="text-xl" />
                </div>
              </div>
              <div>
                <span className="text-3xl text-on-surface tracking-tight font-bold tabular-nums">
                  {formatBRL(totalIncome, 'plus')}
                </span>
                <div className="flex items-center gap-1.5 mt-1.5 text-xs">
                  {periodScope === 'month' && mom.prevIncome > 0 ? (
                    <>
                      <span
                        className={`font-semibold inline-flex items-center tabular-nums ${
                          mom.incomeDeltaPct >= 0 ? 'text-on-primary-fixed-variant' : 'text-error'
                        }`}
                      >
                        <Icon
                          name={mom.incomeDeltaPct >= 0 ? 'arrow_upward' : 'arrow_downward'}
                          className="text-xs mr-0.5"
                        />
                        {mom.incomeDeltaPct >= 0 ? '+' : ''}
                        {mom.incomeDeltaPct.toFixed(1).replace('.', ',')}%
                      </span>
                      <span className="text-secondary">
                        · vs. {mom.prevMonthLabel.split(',')[0]}
                      </span>
                    </>
                  ) : (
                    <span className="text-secondary">
                      {incomeCount} {incomeCount === 1 ? 'receita registrada' : 'receitas registradas'}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-xs flex flex-col justify-between">
              <div className="flex items-center justify-between mb-space-md">
                <span className="text-xs text-secondary uppercase tracking-wider font-semibold">
                  Total Saídas ({periodScope === 'month' ? 'Mês' : 'Período'})
                </span>
                <div className="w-9 h-9 rounded-xl bg-error-container/60 flex items-center justify-center text-error">
                  <Icon name="trending_down" className="text-xl" />
                </div>
              </div>
              <div>
                <span className="text-3xl text-on-surface tracking-tight font-bold tabular-nums">
                  {formatBRL(totalExpense, 'minus')}
                </span>
                <div className="flex items-center gap-1.5 mt-1.5 text-xs text-secondary">
                  <span>
                    {expenseCount} {expenseCount === 1 ? 'despesa registrada' : 'despesas registradas'}
                    {totalExpenseBudget > 0 ? ` · ${budgetPct}% do orçamento` : ''}
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-xs flex flex-col justify-between">
              <div className="flex items-center justify-between mb-space-md">
                <span className="text-xs text-secondary uppercase tracking-wider font-semibold">
                  Saldo do Período
                </span>
                <div className="w-9 h-9 rounded-xl bg-secondary-container flex items-center justify-center text-on-secondary-container">
                  <Icon name="account_balance_wallet" className="text-xl" />
                </div>
              </div>
              <div>
                <span
                  className={`text-3xl tracking-tight font-bold tabular-nums ${
                    netPeriod >= 0 ? 'text-primary' : 'text-error'
                  }`}
                >
                  {netPeriod === 0 ? formatBRL(0) : formatBRL(netPeriod, 'auto')}
                </span>
                <div className="flex items-center gap-1.5 mt-1.5 text-xs">
                  <span className="text-primary font-semibold tabular-nums">
                    Taxa de poupança: {savingsRate}%
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-xs flex flex-col justify-between">
              <div className="flex items-center justify-between mb-space-md">
                <span className="text-xs text-secondary uppercase tracking-wider font-semibold">
                  Volume de Lançamentos
                </span>
                <div className="w-9 h-9 rounded-xl bg-surface-container-high flex items-center justify-center text-on-surface">
                  <Icon name="receipt_long" className="text-xl" />
                </div>
              </div>
              <div>
                <span className="text-3xl text-on-surface tracking-tight font-bold tabular-nums">
                  {periodTransactions.length}{' '}
                  {periodTransactions.length === 1 ? 'Lançamento' : 'Lançamentos'}
                </span>
                <div className="flex items-center gap-2 mt-1.5 text-xs text-secondary tabular-nums">
                  <span>
                    {incomeCount} {incomeCount === 1 ? 'receita' : 'receitas'} · {expenseCount}{' '}
                    {expenseCount === 1 ? 'despesa' : 'despesas'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Filter & Search Toolbar Card */}
          <div className="bg-surface-container-lowest rounded-xl p-space-md shadow-xs mb-space-lg flex flex-col gap-space-md">
            <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-space-md">
              {/* Segmented Type Tabs */}
              <div className="inline-flex items-center bg-surface-container-low p-1 rounded-xl self-start">
                <button
                  type="button"
                  onClick={() => {
                    setTypeFilter('all');
                    setCurrentPage(1);
                  }}
                  className={`px-space-md py-1.5 rounded-lg text-sm transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                    typeFilter === 'all'
                      ? 'bg-surface-container-lowest font-semibold text-on-surface shadow-2xs'
                      : 'text-secondary hover:text-on-surface'
                  }`}
                >
                  <span>Todas</span>
                  <span className="text-xs font-bold tabular-nums opacity-75">
                    ({periodTransactions.length})
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTypeFilter('receita');
                    setCurrentPage(1);
                  }}
                  className={`px-space-md py-1.5 rounded-lg text-sm transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                    typeFilter === 'receita'
                      ? 'bg-surface-container-lowest font-semibold text-primary shadow-2xs'
                      : 'text-secondary hover:text-on-surface'
                  }`}
                >
                  <span>Receitas</span>
                  <span className="text-xs font-bold tabular-nums opacity-75">({incomeCount})</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTypeFilter('despesa');
                    setCurrentPage(1);
                  }}
                  className={`px-space-md py-1.5 rounded-lg text-sm transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                    typeFilter === 'despesa'
                      ? 'bg-surface-container-lowest font-semibold text-error shadow-2xs'
                      : 'text-secondary hover:text-on-surface'
                  }`}
                >
                  <span>Despesas</span>
                  <span className="text-xs font-bold tabular-nums opacity-75">
                    ({expenseCount})
                  </span>
                </button>
              </div>

              {/* Live Search */}
              <div className="relative flex-1 max-w-md">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-secondary flex items-center">
                  <Icon name="search" className="text-lg" />
                </span>
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setCurrentPage(1);
                  }}
                  placeholder="Buscar por estabelecimento, descrição ou tag..."
                  className="w-full bg-surface-container-low text-on-surface rounded-xl pl-10 pr-12 py-2 text-sm placeholder:text-secondary focus:outline-none focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary/20 transition-all"
                />
                <kbd className="absolute right-3 top-1/2 -translate-y-1/2 bg-surface-container px-1.5 py-0.5 rounded text-[11px] font-mono font-semibold text-secondary">
                  /
                </kbd>
              </div>
            </div>

            {/* Bottom Granular Selectors */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-space-sm pt-1 items-end">
              <div className="flex flex-col">
                <label className="text-[11px] text-secondary mb-1 uppercase font-semibold">
                  Mês de Referência
                </label>
                <select
                  value={selectedMonthKey}
                  onChange={(e) => {
                    onSelectMonthKey?.(e.target.value);
                    setPeriodScope('month');
                    setCurrentPage(1);
                  }}
                  className="w-full bg-surface-container-low text-on-surface rounded-xl px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
                >
                  {availableMonthKeys.map((mk) => (
                    <option key={mk} value={mk}>
                      {getMonthLabelFromKey(mk)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col">
                <label className="text-[11px] text-secondary mb-1 uppercase font-semibold">
                  Período
                </label>
                <select
                  value={periodScope}
                  onChange={(e) => {
                    const next = e.target.value as PeriodScope;
                    setPeriodScope(next);
                    if (next === 'day') {
                      if (!customStartDate) setCustomStartDate(getTodayIso());
                      setCustomEndDate('');
                    } else if (next !== 'custom') {
                      setCustomStartDate('');
                      setCustomEndDate('');
                    }
                    setCurrentPage(1);
                  }}
                  className="w-full bg-surface-container-low text-on-surface rounded-xl px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
                >
                  <option value="all">Todo o histórico</option>
                  <option value="month">Apenas o mês</option>
                  <option value="3m">Últimos 3 meses</option>
                  <option value="6m">Últimos 6 meses</option>
                  <option value="day">Data específica</option>
                  <option value="custom">Intervalo de datas</option>
                </select>
              </div>

              <div className="flex flex-col">
                <label className="text-[11px] text-secondary mb-1 uppercase font-semibold">
                  {periodScope === 'day' ? 'Data do Lançamento' : 'Data Inicial'}
                </label>
                <input
                  type="date"
                  value={customStartDate}
                  onChange={(e) => {
                    const val = e.target.value;
                    setCustomStartDate(val);
                    if (periodScope !== 'day') {
                      setPeriodScope(val || customEndDate ? 'custom' : 'all');
                    } else if (!val) {
                      setPeriodScope('all');
                    }
                    setCurrentPage(1);
                  }}
                  className="w-full bg-surface-container-low text-on-surface rounded-xl px-2.5 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div className="flex flex-col">
                <label className="text-[11px] text-secondary mb-1 uppercase font-semibold">
                  Data Final
                </label>
                <input
                  type="date"
                  value={customEndDate}
                  disabled={periodScope === 'day'}
                  onChange={(e) => {
                    const val = e.target.value;
                    setCustomEndDate(val);
                    setPeriodScope(customStartDate || val ? 'custom' : 'all');
                    setCurrentPage(1);
                  }}
                  className="w-full bg-surface-container-low text-on-surface rounded-xl px-2.5 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-45"
                />
              </div>

              <div className="flex flex-col">
                <label className="text-[11px] text-secondary mb-1 uppercase font-semibold">
                  Categoria
                </label>
                <select
                  value={categoryFilter}
                  onChange={(e) => {
                    setCategoryFilter(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="w-full bg-surface-container-low text-on-surface rounded-xl px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
                >
                  <option>Todas as categorias</option>
                  {categoryNames.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col">
                <label className="text-[11px] text-secondary mb-1 uppercase font-semibold">
                  Conta / Carteira
                </label>
                <select
                  value={accountFilter}
                  onChange={(e) => {
                    setAccountFilter(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="w-full bg-surface-container-low text-on-surface rounded-xl px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
                >
                  <option value="Todas as contas">Todas as contas</option>
                  {hasUnlinkedAccounts && <option value="Sem conta">Sem conta</option>}
                  {accounts.map((a) => (
                    <option key={a.id} value={a.name}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                onClick={resetFilters}
                className="w-full flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl bg-surface-container hover:bg-surface-container-high text-on-surface text-sm font-medium transition-all cursor-pointer whitespace-nowrap"
              >
                <Icon name="restart_alt" className="text-base text-secondary" />
                <span>Limpar Filtros</span>
              </button>
            </div>
          </div>

          {/* Main Ledger Table */}
          <div className="bg-surface-container-lowest rounded-xl shadow-xs overflow-hidden flex flex-col mb-space-lg">
            {/* Batch Actions Ribbon */}
            <div className="px-space-md py-2.5 bg-surface-container-low flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-space-sm text-sm text-secondary">
                <label className="flex items-center gap-2 cursor-pointer select-none font-semibold text-on-surface">
                  <input
                    type="checkbox"
                    checked={
                      paginatedTransactions.length > 0 &&
                      paginatedTransactions.every((t) => selectedIds.includes(t.id))
                    }
                    onChange={toggleSelectAll}
                    className="w-4 h-4 rounded text-primary focus:ring-primary/20 cursor-pointer accent-primary"
                  />
                  <span>Extrato Filtrado ({filteredTransactions.length} itens)</span>
                </label>
                <span>·</span>
                <span className="tabular-nums">{selectedIds.length} selecionados</span>
              </div>

              <div className="flex items-center gap-2 relative">
                <div className="relative">
                  <button
                    type="button"
                    disabled={selectedIds.length === 0}
                    onClick={() => setBatchCategoryOpen((v) => !v)}
                    className="px-2.5 py-1 rounded-lg bg-surface-container-lowest hover:bg-surface-container disabled:opacity-45 text-on-surface text-xs font-medium shadow-2xs transition-all flex items-center gap-1 cursor-pointer whitespace-nowrap"
                  >
                    <Icon name="label" className="text-sm text-secondary" />
                    <span>Alterar Categoria</span>
                  </button>
                  {batchCategoryOpen && selectedIds.length > 0 && (
                    <div className="absolute right-0 top-8 z-30 bg-surface-container-lowest border border-surface-container rounded-xl shadow-xl p-1.5 w-52 space-y-0.5 max-h-60 overflow-y-auto">
                      <button
                        type="button"
                        onClick={() => {
                          onChangeBatchCategory(selectedIds, 'Sem categoria');
                          setBatchCategoryOpen(false);
                          setSelectedIds([]);
                        }}
                        className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-secondary hover:bg-surface-container-low cursor-pointer font-medium"
                      >
                        Sem categoria (remover vínculo)
                      </button>
                      {categories.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => {
                            onChangeBatchCategory(selectedIds, c.name);
                            setBatchCategoryOpen(false);
                            setSelectedIds([]);
                          }}
                          className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-on-surface hover:bg-surface-container-low cursor-pointer"
                        >
                          {c.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  disabled={selectedIds.length === 0}
                  onClick={() => onMarkBatchPaid(selectedIds)}
                  className="px-2.5 py-1 rounded-lg bg-surface-container-lowest hover:bg-surface-container disabled:opacity-45 text-on-surface text-xs font-medium shadow-2xs transition-all flex items-center gap-1 cursor-pointer whitespace-nowrap"
                >
                  <Icon name="done_all" className="text-sm text-secondary" />
                  <span>Marcar como Pago</span>
                </button>

                <button
                  type="button"
                  disabled={selectedIds.length === 0}
                  onClick={() => {
                    onDeleteBatch(selectedIds);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-surface-container-lowest hover:bg-error-container disabled:opacity-45 text-error text-xs font-medium transition-all flex items-center gap-1 cursor-pointer whitespace-nowrap"
                >
                  <Icon name="delete" className="text-sm text-error" />
                  <span>Excluir Selecionados</span>
                </button>
              </div>
            </div>

            {/* Table */}
            {isLoading ? (
              <div className="p-12 flex flex-col items-center justify-center gap-3 text-center">
                <Icon name="progress_activity" className="text-3xl text-primary animate-spin" />
                <div>
                  <p className="text-sm font-bold text-on-surface">
                    Carregando movimentações do banco de dados...
                  </p>
                  <p className="text-xs text-secondary mt-0.5">
                    Sincronizando receitas e despesas do seu perfil autenticado.
                  </p>
                </div>
              </div>
            ) : paginatedTransactions.length === 0 ? (
              <div className="p-8">
                <EmptyState
                  icon="receipt_long"
                  title="Nenhuma movimentação encontrada"
                  description="Ajuste os filtros aplicados, troque o período ou cadastre um novo lançamento no seu extrato."
                  actionLabel="Nova Movimentação"
                  onAction={onOpenNewTransaction}
                  secondaryLabel="Limpar Filtros"
                  onSecondaryAction={resetFilters}
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-surface-container-lowest text-secondary uppercase text-[11px] font-semibold tracking-wider border-b border-surface-container">
                      <th className="py-3 px-space-md w-12 text-center">
                        <span className="sr-only">Seleção</span>
                      </th>
                      <th className="py-3 px-space-sm">Data / Horário</th>
                      <th className="py-3 px-space-md">Descrição &amp; Detalhes</th>
                      <th className="py-3 px-space-sm">Categoria</th>
                      <th className="py-3 px-space-sm">Conta / Carteira</th>
                      <th className="py-3 px-space-sm">Situação</th>
                      <th className="py-3 px-space-md text-right">Valor</th>
                      <th className="py-3 px-space-md text-center w-28">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="text-sm text-on-surface divide-y divide-surface-container/60">
                    {paginatedTransactions.map((tx) => {
                      const isChecked = selectedIds.includes(tx.id);
                      return (
                        <tr
                          key={tx.id}
                          className={`hover:bg-surface-container-low transition-colors group ${
                            isChecked ? 'bg-surface-container-low/40' : ''
                          }`}
                        >
                          <td className="py-3.5 px-space-md text-center">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleSelectOne(tx.id)}
                              className="w-4 h-4 rounded text-primary focus:ring-primary/20 accent-primary cursor-pointer"
                            />
                          </td>
                          <td className="py-3.5 px-space-sm whitespace-nowrap tabular-nums">
                            <span className="font-semibold text-on-surface block text-sm">
                              {tx.dateLabel}
                            </span>
                            <span className="text-secondary text-xs">
                              {tx.time} · {tx.method}
                            </span>
                          </td>
                          <td className="py-3.5 px-space-md">
                            <div className="flex items-center gap-3">
                              <div
                                className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                                  tx.type === 'receita'
                                    ? 'bg-primary-fixed/50 text-primary'
                                    : 'bg-surface-container text-secondary'
                                }`}
                              >
                                <Icon name={tx.icon} className="text-lg" />
                              </div>
                              <div className="flex flex-col min-w-0">
                                <span className="font-semibold text-on-surface truncate max-w-[260px]">
                                  {tx.title}
                                </span>
                                <span className="text-secondary text-xs truncate max-w-[260px]">
                                  {tx.subtitle}
                                </span>
                              </div>
                            </div>
                          </td>
                          <td className="py-3.5 px-space-sm whitespace-nowrap text-xs font-medium text-on-surface-variant">
                            <div>{tx.category}</div>
                            {tx.subcategory && (
                              <span className="text-[11px] text-secondary">{tx.subcategory}</span>
                            )}
                          </td>
                          <td className="py-3.5 px-space-sm whitespace-nowrap text-xs font-medium text-secondary">
                            <span className="inline-flex items-center gap-1.5">
                              <Icon
                                name={tx.accountIcon || 'account_balance'}
                                className="text-sm text-secondary"
                              />
                              {tx.account}
                            </span>
                          </td>
                          <td className="py-3.5 px-space-sm whitespace-nowrap text-xs font-semibold">
                            {tx.status === 'pendente' ? (
                              <span className="text-amber-700">Pendente</span>
                            ) : tx.status === 'conciliado' ? (
                              <span className="text-primary">Conciliado</span>
                            ) : (
                              <span className="text-on-surface-variant">Efetivado</span>
                            )}
                          </td>
                          <td className="py-3.5 px-space-md text-right whitespace-nowrap tabular-nums">
                            <span
                              className={`text-base font-bold tracking-tight ${
                                tx.type === 'receita' ? 'text-primary' : 'text-error'
                              }`}
                            >
                              {formatBRL(tx.amount, tx.type === 'receita' ? 'plus' : 'minus')}
                            </span>
                          </td>
                          <td className="py-3.5 px-space-md text-center">
                            <div className="flex items-center justify-center gap-1 opacity-85 group-hover:opacity-100 transition-opacity">
                              <button
                                type="button"
                                onClick={() => onEditTransaction(tx)}
                                title="Editar"
                                className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-surface-container text-secondary hover:text-on-surface transition-colors cursor-pointer"
                              >
                                <Icon name="edit" className="text-base" />
                              </button>
                              <button
                                type="button"
                                onClick={() => onDeleteTransaction(tx)}
                                title="Excluir"
                                className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-error-container text-secondary hover:text-error transition-colors cursor-pointer"
                              >
                                <Icon name="delete" className="text-base" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Table Footer & Pagination */}
            <div className="p-space-md bg-surface-container-lowest border-t border-surface-container flex flex-col sm:flex-row items-center justify-between gap-space-md">
              <div className="flex items-center gap-space-md text-secondary text-xs tabular-nums">
                <span>
                  Mostrando{' '}
                  <strong className="font-semibold text-on-surface">
                    {filteredTransactions.length === 0 ? 0 : (safePage - 1) * itemsPerPage + 1} a{' '}
                    {Math.min(safePage * itemsPerPage, filteredTransactions.length)}
                  </strong>{' '}
                  de{' '}
                  <strong className="font-semibold text-on-surface">
                    {filteredTransactions.length}
                  </strong>{' '}
                  movimentações
                </span>
                <div className="flex items-center gap-1.5">
                  <label htmlFor="items-per-page" className="text-secondary font-medium">
                    Exibir:
                  </label>
                  <select
                    id="items-per-page"
                    value={itemsPerPage}
                    onChange={(e) => {
                      setItemsPerPage(Number(e.target.value));
                      setCurrentPage(1);
                    }}
                    className="bg-surface-container-low text-on-surface rounded-lg px-2 py-1 text-xs font-semibold focus:outline-none cursor-pointer"
                  >
                    <option value={10}>10 itens</option>
                    <option value={25}>25 itens</option>
                    <option value={50}>50 itens</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={safePage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  className="px-2.5 py-1.5 rounded-lg bg-surface-container-low hover:bg-surface-container disabled:opacity-50 disabled:cursor-not-allowed text-on-surface text-xs font-medium flex items-center gap-1 cursor-pointer"
                >
                  <Icon name="chevron_left" className="text-sm" />
                  <span>Anterior</span>
                </button>
                {Array.from({ length: totalPages }, (_, idx) => idx + 1).map((pageNum) => (
                  <button
                    key={pageNum}
                    type="button"
                    onClick={() => setCurrentPage(pageNum)}
                    className={`w-8 h-8 rounded-lg text-xs font-bold flex items-center justify-center transition-colors cursor-pointer tabular-nums ${
                      safePage === pageNum
                        ? 'bg-primary text-on-primary shadow-2xs'
                        : 'hover:bg-surface-container text-on-surface font-medium'
                    }`}
                  >
                    {pageNum}
                  </button>
                ))}
                <button
                  type="button"
                  disabled={safePage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  className="px-2.5 py-1.5 rounded-lg bg-surface-container-low hover:bg-surface-container disabled:opacity-50 disabled:cursor-not-allowed text-on-surface text-xs font-medium flex items-center gap-1 cursor-pointer"
                >
                  <span>Próximo</span>
                  <Icon name="chevron_right" className="text-sm" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
