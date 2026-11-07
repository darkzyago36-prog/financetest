import {
  createMonthDefinition,
  getMonthLabelFromKey,
  getQuarterLabelFromMonthKey,
  getTodayIso,
} from '../data/initialData';
import {
  AccountItem,
  Category,
  CategoryBreakdownItem,
  GoalItem,
  MonthlySummaryPoint,
  Transaction,
  TransactionType,
} from '../types/finance';

export function getTxMonthKey(tx: Transaction): string {
  return tx.date.slice(0, 7); // YYYY-MM
}

export function filterTransactionsByMonthKey(
  transactions: Transaction[],
  monthKey: string
): Transaction[] {
  return transactions.filter((t) => getTxMonthKey(t) === monthKey);
}

export function filterTransactionsByAccount(
  transactions: Transaction[],
  accountScope: string,
  accounts: AccountItem[]
): Transaction[] {
  if (!accountScope || accountScope === 'all' || accountScope.startsWith('Todas as')) {
    return transactions;
  }
  const matchedAcc = accounts.find(
    (a) => a.id === accountScope || a.name.toLowerCase() === accountScope.toLowerCase()
  );
  return transactions.filter((t) => {
    if (matchedAcc) {
      return (
        t.accountId === matchedAcc.id ||
        t.account.toLowerCase() === matchedAcc.name.toLowerCase()
      );
    }
    return t.account.toLowerCase() === accountScope.toLowerCase();
  });
}

/**
 * Computes each account's real current balance strictly from its persisted `initialBalance`
 * (`accounts.initial_balance`) plus all linked `transactions` (`receita` / `despesa`).
 */
export function computeAccountsWithCalculatedBalance(
  accounts: AccountItem[],
  transactions: Transaction[]
): AccountItem[] {
  return accounts.map((acc) => {
    const linkedTx = transactions.filter((tx) => {
      if (tx.accountId && acc.id) {
        return tx.accountId === acc.id;
      }
      if (tx.accountId) return false;
      const txAccNorm = (tx.account || '').trim().toLowerCase();
      if (!txAccNorm || txAccNorm === 'sem conta') return false;
      return txAccNorm === acc.name.trim().toLowerCase();
    });

    const inflows = linkedTx
      .filter((tx) => tx.type === 'receita')
      .reduce((sum, tx) => sum + tx.amount, 0);

    const outflows = linkedTx
      .filter((tx) => tx.type === 'despesa')
      .reduce((sum, tx) => sum + tx.amount, 0);

    const baseInitial = Number(acc.initialBalance ?? 0);

    if (acc.type === 'credit') {
      const calculatedInvoice = Math.max(0, Number((baseInitial + outflows - inflows).toFixed(2)));
      return {
        ...acc,
        initialBalance: baseInitial,
        balance: calculatedInvoice,
        calculatedInflows: Number(inflows.toFixed(2)),
        calculatedOutflows: Number(outflows.toFixed(2)),
      };
    }

    const calculatedBalance = Number((baseInitial + inflows - outflows).toFixed(2));
    return {
      ...acc,
      initialBalance: baseInitial,
      balance: calculatedBalance,
      calculatedInflows: Number(inflows.toFixed(2)),
      calculatedOutflows: Number(outflows.toFixed(2)),
    };
  });
}

function normalizeCatMatch(catName: string, txCategory: string): boolean {
  const a = catName.trim().toLowerCase();
  const b = txCategory.trim().toLowerCase();
  if (!a || !b) return false;
  if (a === b) return true;
  const firstWordA = a.split(' ')[0];
  const firstWordB = b.split(' ')[0];
  return firstWordA.length >= 4 && firstWordA === firstWordB;
}

/**
 * Computes live category & subcategory totals directly from transactions (zero static spent values).
 */
export function computeCategoriesWithSpending(
  categories: Category[],
  transactions: Transaction[],
  monthKey?: string
): Category[] {
  const scopedTx = monthKey ? filterTransactionsByMonthKey(transactions, monthKey) : transactions;

  return categories.map((cat) => {
    const matchingTx = scopedTx.filter(
      (t) =>
        t.type === cat.type &&
        ((t.categoryId && t.categoryId === cat.id) || normalizeCatMatch(cat.name, t.category))
    );
    const allTimeMatchingCount = transactions.filter(
      (t) =>
        t.type === cat.type &&
        ((t.categoryId && t.categoryId === cat.id) || normalizeCatMatch(cat.name, t.category))
    ).length;

    const spent = matchingTx.reduce((sum, t) => sum + t.amount, 0);

    const subcategories = cat.subcategories.map((sub, idx) => {
      const subMatches = matchingTx.filter(
        (t) =>
          (t.subcategory && t.subcategory.toLowerCase() === sub.name.toLowerCase()) ||
          t.title.toLowerCase().includes(sub.name.toLowerCase()) ||
          t.subtitle.toLowerCase().includes(sub.name.toLowerCase())
      );

      let subSpent = subMatches.reduce((sum, t) => sum + t.amount, 0);
      if (idx === 0 && spent > 0) {
        const assignedOther = cat.subcategories.slice(1).reduce((acc, otherSub) => {
          const m = matchingTx.filter(
            (t) =>
              (t.subcategory && t.subcategory.toLowerCase() === otherSub.name.toLowerCase()) ||
              t.title.toLowerCase().includes(otherSub.name.toLowerCase()) ||
              t.subtitle.toLowerCase().includes(otherSub.name.toLowerCase())
          );
          return acc + m.reduce((s, item) => s + item.amount, 0);
        }, 0);
        subSpent = Math.max(subSpent, Number((spent - assignedOther).toFixed(2)));
      }

      return {
        ...sub,
        spent: Number(subSpent.toFixed(2)),
      };
    });

    return {
      ...cat,
      spent: Number(spent.toFixed(2)),
      transactionsCount: monthKey ? matchingTx.length : allTimeMatchingCount,
      subcategories,
    };
  });
}

const PALETTE_CYCLE = [
  { color: '#006948', dotClass: 'bg-primary', icon: 'home' },
  { color: '#2170e4', dotClass: 'bg-tertiary-container', icon: 'restaurant' },
  { color: '#565e74', dotClass: 'bg-secondary', icon: 'directions_car' },
  { color: '#ba1a1a', dotClass: 'bg-error', icon: 'favorite' },
  { color: '#0891b2', dotClass: 'bg-cyan-600', icon: 'sports_esports' },
  { color: '#d97706', dotClass: 'bg-amber-500', icon: 'school' },
];

/**
 * Computes category breakdown (for either expenses or incomes) from real transactions
 * for Donut charts and ranked category lists.
 */
export function computeCategoryBreakdown(
  transactions: Transaction[],
  categories: Category[],
  targetType: TransactionType = 'despesa'
): CategoryBreakdownItem[] {
  const matching = transactions.filter((t) => t.type === targetType);
  const totalAmount = matching.reduce((sum, t) => sum + t.amount, 0);

  if (totalAmount <= 0) return [];

  const grouped = new Map<
    string,
    { name: string; amount: number; count: number; catMeta?: Category }
  >();

  for (const tx of matching) {
    const matchedCat = categories.find(
      (c) =>
        c.type === targetType &&
        ((tx.categoryId && c.id === tx.categoryId) || normalizeCatMatch(c.name, tx.category))
    );
    const fallbackName = tx.category && tx.category.trim() ? tx.category.trim() : 'Sem categoria';
    const key = matchedCat ? matchedCat.id : fallbackName.toLowerCase();
    const displayName = matchedCat ? matchedCat.name : fallbackName;
    const existing = grouped.get(key);
    if (existing) {
      existing.amount += tx.amount;
      existing.count += 1;
    } else {
      grouped.set(key, {
        name: displayName,
        amount: tx.amount,
        count: 1,
        catMeta: matchedCat,
      });
    }
  }

  const sorted = Array.from(grouped.entries()).sort((a, b) => b[1].amount - a[1].amount);

  return sorted.map(([id, entry], index) => {
    const fallbackPalette = PALETTE_CYCLE[index % PALETTE_CYCLE.length];
    const pct = Number(((entry.amount / totalAmount) * 100).toFixed(1));
    return {
      id,
      name: entry.name,
      amount: Number(entry.amount.toFixed(2)),
      pct,
      color: entry.catMeta?.hexColor || fallbackPalette.color,
      dotClass: fallbackPalette.dotClass,
      icon:
        entry.catMeta?.icon ||
        (targetType === 'receita' ? 'payments' : fallbackPalette.icon),
      count: entry.count,
      budget: entry.catMeta?.budget || 0,
    };
  });
}

/**
 * Computes expense breakdown by category from real transactions for Donut charts and ranked lists.
 */
export function computeExpenseBreakdown(
  transactions: Transaction[],
  categories: Category[]
): CategoryBreakdownItem[] {
  return computeCategoryBreakdown(transactions, categories, 'despesa');
}

/**
 * Computes monthly income, expenses, net savings, savings rate, and dynamic bar heights from transactions.
 */
export function computeMonthlySeries(
  transactions: Transaction[],
  monthKeys: string[],
  activeMonthKey: string
): MonthlySummaryPoint[] {
  const rawPoints = monthKeys.map((key) => {
    const def = createMonthDefinition(key);
    const monthTx = filterTransactionsByMonthKey(transactions, key);
    const income = monthTx
      .filter((t) => t.type === 'receita')
      .reduce((sum, t) => sum + t.amount, 0);
    const expenses = monthTx
      .filter((t) => t.type === 'despesa')
      .reduce((sum, t) => sum + t.amount, 0);
    const net = income - expenses;
    const savingsRate = income > 0 ? Number(((net / income) * 100).toFixed(1)) : 0;

    return {
      monthKey: key,
      monthLabel: def.label,
      shortLabel: key === activeMonthKey ? `${def.shortLabel} (Atual)` : def.shortYearLabel,
      quarter: getQuarterLabelFromMonthKey(key),
      income: Number(income.toFixed(2)),
      expenses: Number(expenses.toFixed(2)),
      net: Number(net.toFixed(2)),
      savingsRate,
      isCurrent: key === activeMonthKey,
      txCount: monthTx.length,
    };
  });

  const maxMetric = Math.max(1, ...rawPoints.map((p) => Math.max(p.income, p.expenses)));
  const scaleCeiling = Math.max(100, Math.ceil(maxMetric / 100) * 100);
  const maxNet = Math.max(...rawPoints.map((p) => p.net), 0);

  return rawPoints.map((p) => {
    const isRecord = p.net > 0 && p.net === maxNet && rawPoints.length > 1;
    let statusLabel = 'Sem lançamentos';
    let statusTone: MonthlySummaryPoint['statusTone'] = 'esperado';

    if (p.txCount > 0) {
      if (isRecord) {
        statusLabel = 'Recorde do Período';
        statusTone = 'recorde';
      } else if (p.savingsRate >= 48) {
        statusLabel = 'Meta Superada';
        statusTone = 'superada';
      } else if (p.net >= 0) {
        statusLabel = 'Dentro do Esperado';
        statusTone = 'esperado';
      } else {
        statusLabel = 'Déficit no Período';
        statusTone = 'atencao';
      }
    }

    return {
      ...p,
      incomePct:
        scaleCeiling > 0
          ? Math.min(100, Number(((p.income / scaleCeiling) * 100).toFixed(1)))
          : 0,
      expensePct:
        scaleCeiling > 0
          ? Math.min(100, Number(((p.expenses / scaleCeiling) * 100).toFixed(1)))
          : 0,
      statusLabel,
      statusTone,
      isHighlight: isRecord,
    };
  });
}

export function getPreviousMonthKey(monthKey: string): string {
  const [yrStr, mmStr] = monthKey.split('-');
  let yr = Number(yrStr);
  let mm = Number(mmStr) - 1;
  if (mm < 1) {
    mm = 12;
    yr -= 1;
  }
  return `${yr}-${String(mm).padStart(2, '0')}`;
}

export function computeMoMComparison(transactions: Transaction[], currentMonthKey: string) {
  const prevKey = getPreviousMonthKey(currentMonthKey);
  const currTx = filterTransactionsByMonthKey(transactions, currentMonthKey);
  const prevTx = filterTransactionsByMonthKey(transactions, prevKey);

  const currIncome = currTx.filter((t) => t.type === 'receita').reduce((s, t) => s + t.amount, 0);
  const prevIncome = prevTx.filter((t) => t.type === 'receita').reduce((s, t) => s + t.amount, 0);

  const currExpense = currTx.filter((t) => t.type === 'despesa').reduce((s, t) => s + t.amount, 0);
  const prevExpense = prevTx.filter((t) => t.type === 'despesa').reduce((s, t) => s + t.amount, 0);

  const incomeDeltaPct =
    prevIncome > 0 ? Number((((currIncome - prevIncome) / prevIncome) * 100).toFixed(1)) : 0;
  const expenseDeltaPct =
    prevExpense > 0 ? Number((((currExpense - prevExpense) / prevExpense) * 100).toFixed(1)) : 0;

  return {
    prevMonthLabel: getMonthLabelFromKey(prevKey),
    currIncome,
    prevIncome,
    currExpense,
    prevExpense,
    incomeDeltaPct,
    expenseDeltaPct,
  };
}

export function computeMonthsRemaining(
  targetDateIso: string,
  referenceDateIso = getTodayIso()
): number {
  const ref = new Date(referenceDateIso);
  const tgt = new Date(targetDateIso);
  if (Number.isNaN(tgt.getTime())) return 6;
  const diffMonths =
    (tgt.getFullYear() - ref.getFullYear()) * 12 + (tgt.getMonth() - ref.getMonth());
  return Math.max(1, diffMonths);
}

export function findNextMilestoneGoal(goals: GoalItem[]): GoalItem | null {
  const active = goals.filter((g) => g.status === 'active');
  if (active.length === 0) return null;
  return [...active].sort((a, b) =>
    (a.targetDateIso || '9999-12-31').localeCompare(b.targetDateIso || '9999-12-31')
  )[0];
}

export type ReportPeriodPresetId = '1m' | '3m' | '6m' | 'yr' | 'all' | 'custom';

function shiftMonthKey(monthKey: string, deltaMonths: number): string {
  const [yrStr, mmStr] = monthKey.split('-');
  const baseYr = Number(yrStr) || new Date().getFullYear();
  const baseMm = (Number(mmStr) || 1) - 1;
  const dt = new Date(baseYr, baseMm + deltaMonths, 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
}

function buildMonthSpanKeys(startMonthKey: string, endMonthKey: string): string[] {
  const a = startMonthKey <= endMonthKey ? startMonthKey : endMonthKey;
  const b = startMonthKey <= endMonthKey ? endMonthKey : startMonthKey;
  const keys: string[] = [];
  let cursor = a;
  let guard = 0;
  while (cursor <= b && guard < 120) {
    keys.push(cursor);
    cursor = shiftMonthKey(cursor, 1);
    guard += 1;
  }
  return keys.length > 0 ? keys : [endMonthKey];
}

/**
 * Generates exact contiguous calendar month keys (`YYYY-MM`) for report period filters:
 * - `1m`: Selected month
 * - `3m`: Trailing 3 consecutive calendar months ending at `selectedMonthKey`
 * - `6m`: Trailing 6 consecutive calendar months ending at `selectedMonthKey`
 * - `yr`: All 12 months (`01`..`12`) of the year in `selectedMonthKey`
 * - `all`: Exact span from the user's earliest transaction month to latest transaction month
 * - `custom`: Continuous months between `customStart` and `customEnd`
 */
export function buildPeriodMonthKeys(
  periodId: ReportPeriodPresetId,
  selectedMonthKey: string,
  transactions: Transaction[],
  customStart?: string,
  customEnd?: string
): string[] {
  const safeSelected =
    selectedMonthKey && /^\d{4}-\d{2}$/.test(selectedMonthKey)
      ? selectedMonthKey
      : getTodayIso().slice(0, 7);

  if (periodId === '1m') {
    return [safeSelected];
  }
  if (periodId === '3m') {
    return [
      shiftMonthKey(safeSelected, -2),
      shiftMonthKey(safeSelected, -1),
      safeSelected,
    ];
  }
  if (periodId === '6m') {
    return [
      shiftMonthKey(safeSelected, -5),
      shiftMonthKey(safeSelected, -4),
      shiftMonthKey(safeSelected, -3),
      shiftMonthKey(safeSelected, -2),
      shiftMonthKey(safeSelected, -1),
      safeSelected,
    ];
  }
  if (periodId === 'yr') {
    const yr = safeSelected.slice(0, 4);
    return Array.from({ length: 12 }, (_, idx) => `${yr}-${String(idx + 1).padStart(2, '0')}`);
  }
  if (periodId === 'custom') {
    const startKey =
      customStart && /^\d{4}-\d{2}/.test(customStart) ? customStart.slice(0, 7) : safeSelected;
    const endKey =
      customEnd && /^\d{4}-\d{2}/.test(customEnd) ? customEnd.slice(0, 7) : safeSelected;
    return buildMonthSpanKeys(startKey, endKey);
  }

  // 'all' — span across real transaction history (or fallback to trailing 6 months if empty)
  if (transactions.length === 0) {
    return [safeSelected];
  }
  const txKeys = transactions
    .map((t) => getTxMonthKey(t))
    .filter((k) => /^\d{4}-\d{2}$/.test(k))
    .sort((a, b) => a.localeCompare(b));

  if (txKeys.length === 0) {
    return [safeSelected];
  }
  return buildMonthSpanKeys(txKeys[0], txKeys[txKeys.length - 1]);
}

/**
 * Computes a clean 1-2-5 magnitude ceiling for chart Y-axes so both small (R$ 50)
 * and large (R$ 50.000) real values render proportionally.
 */
export function computeSmartAxisCeiling(rawMax: number): number {
  const abs = Math.abs(rawMax);
  if (!Number.isFinite(abs) || abs <= 0) return 1000;
  if (abs <= 100) return 100;
  const magnitude = Math.pow(10, Math.floor(Math.log10(abs)));
  const normalized = abs / magnitude;
  let niceFactor = 10;
  if (normalized <= 1) niceFactor = 1;
  else if (normalized <= 2) niceFactor = 2;
  else if (normalized <= 2.5) niceFactor = 2.5;
  else if (normalized <= 4) niceFactor = 4;
  else if (normalized <= 5) niceFactor = 5;
  else if (normalized <= 8) niceFactor = 8;
  return Math.ceil(niceFactor * magnitude);
}

export interface EvolutionPoint {
  key: string;
  label: string;
  fullLabel: string;
  balance: number;
  periodDelta: number;
}

export interface FinancialEvolutionResult {
  openingBalance: number;
  closingBalance: number;
  netChange: number;
  growthPct: number;
  points: EvolutionPoint[];
}

function getLastDayOfMonthIso(monthKey: string): string {
  const [yrStr, mmStr] = monthKey.split('-');
  const yr = Number(yrStr) || new Date().getFullYear();
  const mm = Number(mmStr) || 1;
  const lastDay = new Date(yr, mm, 0).getDate();
  return `${monthKey}-${String(lastDay).padStart(2, '0')}`;
}

/**
 * Computes the user's real accumulated financial evolution across any report period:
 * - Opening balance = sum of scoped accounts' `initialBalance` + net of all scoped transactions strictly BEFORE period start.
 * - For `1m` (single month): builds daily intramonth checkpoints so the user sees exact balance progression inside the month.
 * - For `3m`, `6m`, `yr`, `all`, `custom`: builds start checkpoint + closing balance of each month in `activeMonthKeys`.
 */
export function computeFinancialEvolutionSeries(params: {
  accounts: AccountItem[];
  scopedTransactions: Transaction[];
  periodId: ReportPeriodPresetId;
  activeMonthKeys: string[];
  customStart?: string;
  customEnd?: string;
  accountScope?: string;
}): FinancialEvolutionResult {
  const {
    accounts,
    scopedTransactions,
    periodId,
    activeMonthKeys,
    customStart,
    customEnd,
    accountScope = 'all',
  } = params;

  const relevantAccounts =
    !accountScope || accountScope === 'all'
      ? accounts.filter((a) => a.type !== 'credit')
      : accounts.filter(
          (a) => a.id === accountScope || a.name.toLowerCase() === accountScope.toLowerCase()
        );

  const accountsInitialBase = relevantAccounts.reduce(
    (sum, acc) =>
      sum + (acc.type === 'credit' ? -Number(acc.initialBalance || 0) : Number(acc.initialBalance || 0)),
    0
  );

  const firstMonthKey = activeMonthKeys[0] || getTodayIso().slice(0, 7);
  const lastMonthKey = activeMonthKeys[activeMonthKeys.length - 1] || firstMonthKey;

  const periodStartIso =
    periodId === 'custom' && customStart && /^\d{4}-\d{2}-\d{2}$/.test(customStart)
      ? customStart
      : `${firstMonthKey}-01`;

  const periodEndIso =
    periodId === 'custom' && customEnd && /^\d{4}-\d{2}-\d{2}$/.test(customEnd)
      ? customEnd
      : getLastDayOfMonthIso(lastMonthKey);

  const priorNet = scopedTransactions
    .filter((t) => t.date < periodStartIso)
    .reduce((sum, t) => sum + (t.type === 'receita' ? t.amount : -t.amount), 0);

  const openingBalance = Number((accountsInitialBase + priorNet).toFixed(2));

  const inPeriodTx = scopedTransactions
    .filter((t) => t.date >= periodStartIso && t.date <= periodEndIso)
    .sort((a, b) => a.date.localeCompare(b.date));

  const points: EvolutionPoint[] = [];

  if (periodId === '1m') {
    const [, mmStr] = firstMonthKey.split('-');
    const lastDayIso = getLastDayOfMonthIso(firstMonthKey);
    const lastDayStr = lastDayIso.slice(8, 10);

    // Collect distinct transaction days inside the month + start (01) + end of month
    const daySet = new Set<string>([`${firstMonthKey}-01`]);
    for (const tx of inPeriodTx) {
      daySet.add(tx.date);
    }
    daySet.add(lastDayIso);

    const sortedDays = Array.from(daySet).sort((a, b) => a.localeCompare(b));

    let running = openingBalance;
    let txCursor = 0;

    // Opening point before day 01 transactions if day 01 has transactions
    const hasDay01Tx = inPeriodTx.some((t) => t.date === `${firstMonthKey}-01`);
    if (hasDay01Tx) {
      points.push({
        key: `${firstMonthKey}-start`,
        label: 'Início',
        fullLabel: `Saldo inicial em 01/${mmStr}`,
        balance: openingBalance,
        periodDelta: 0,
      });
    }

    for (const dayIso of sortedDays) {
      let dayDelta = 0;
      while (txCursor < inPeriodTx.length && inPeriodTx[txCursor].date <= dayIso) {
        const tx = inPeriodTx[txCursor];
        const signed = tx.type === 'receita' ? tx.amount : -tx.amount;
        running += signed;
        dayDelta += signed;
        txCursor += 1;
      }
      const dd = dayIso.slice(8, 10);
      const isLast = dayIso === lastDayIso;
      points.push({
        key: dayIso,
        label: isLast && sortedDays.length > 5 ? `${lastDayStr}/${mmStr}` : `${dd}/${mmStr}`,
        fullLabel: `Dia ${dd}/${mmStr}/${firstMonthKey.slice(0, 4)}`,
        balance: Number(running.toFixed(2)),
        periodDelta: Number(dayDelta.toFixed(2)),
      });
    }
  } else {
    // Multi-month trajectory: Opening checkpoint + closing balance of each month
    const firstDef = createMonthDefinition(firstMonthKey);
    points.push({
      key: `${firstMonthKey}-open`,
      label: 'Início',
      fullLabel: `Abertura (${firstDef.label})`,
      balance: openingBalance,
      periodDelta: 0,
    });

    let running = openingBalance;
    for (const mKey of activeMonthKeys) {
      const def = createMonthDefinition(mKey);
      const mTx = inPeriodTx.filter((t) => getTxMonthKey(t) === mKey);
      const mNet = mTx.reduce(
        (sum, t) => sum + (t.type === 'receita' ? t.amount : -t.amount),
        0
      );
      running = Number((running + mNet).toFixed(2));
      points.push({
        key: mKey,
        label: activeMonthKeys.length > 8 ? def.shortLabel : def.shortYearLabel,
        fullLabel: def.label,
        balance: running,
        periodDelta: Number(mNet.toFixed(2)),
      });
    }
  }

  const closingBalance =
    points.length > 0 ? points[points.length - 1].balance : openingBalance;
  const netChange = Number((closingBalance - openingBalance).toFixed(2));

  let growthPct = 0;
  if (Math.abs(openingBalance) > 0.009) {
    growthPct = Number(((netChange / Math.abs(openingBalance)) * 100).toFixed(1));
  } else if (netChange > 0) {
    growthPct = 100;
  } else if (netChange < 0) {
    growthPct = -100;
  }

  return {
    openingBalance,
    closingBalance,
    netChange,
    growthPct,
    points,
  };
}
