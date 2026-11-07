import React, { useMemo, useState } from 'react';
import { formatBRL, formatDateGroupPT, formatDateLabelPT, getTodayIso } from '../data/initialData';
import { filterTransactionsByMonthKey } from '../services/analyticsService';
import {
  isDuplicateAccountName,
  parseBrlBalanceInput,
} from '../services/financeService';
import {
  AccountItem,
  AccountType,
  DataSourceMode,
  ScreenId,
  Transaction,
} from '../types/finance';
import { Icon } from '../components/Icon';
import { EmptyState } from '../components/ui/EmptyState';

export interface SaveAccountResult {
  ok: boolean;
  errorMessage?: string;
}

interface ContasViewProps {
  accounts: AccountItem[];
  transactions: Transaction[];
  selectedMonthKey: string;
  dataSourceMode: DataSourceMode;
  isLoading?: boolean;
  onRefresh?: () => Promise<void> | void;
  onSaveAccount: (
    acc: Omit<AccountItem, 'id'>,
    existingId?: string
  ) => Promise<SaveAccountResult>;
  onDeleteAccount: (acc: AccountItem) => void;
  onUpdateAccountBalance: (
    id: string,
    newInitialBalance: number
  ) => Promise<SaveAccountResult>;
  onImportTransactions: (imported: Omit<Transaction, 'id'>[]) => void;
  onViewAccountStatement: (accountName: string) => void;
  onNavigate: (screen: ScreenId) => void;
  onNotify: (msg: string) => void;
}

const ACCENT_STYLES: Record<AccountItem['accentTheme'], string> = {
  orange: 'bg-orange-500/10 text-orange-600',
  purple: 'bg-purple-600/10 text-purple-700',
  amber: 'bg-orange-600/10 text-orange-700',
  'dark-purple': 'bg-purple-900/10 text-purple-900',
  slate: 'bg-slate-900/10 text-slate-800',
  blue: 'bg-blue-600/10 text-blue-800',
};

const MODALITY_LABELS: Record<AccountType, string> = {
  checking: 'Conta Corrente',
  savings: 'Carteira / Reserva',
  business: 'Conta PJ',
  investment: 'Investimentos',
  credit: 'Cartão de Crédito',
};

function formatNumericForInput(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '0';
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(2).replace('.', ',');
}

function deriveCodeFromName(name: string, type: AccountType): string {
  if (type === 'credit') return 'CARD';
  const lower = name.trim().toLowerCase();
  if (lower.includes('carteira')) return 'CT';
  const letters = name.replace(/[^a-zA-ZÀ-ÿ]/g, '').slice(0, 3).toUpperCase();
  return letters || 'BK';
}

function deriveThemeFromModality(
  name: string,
  type: AccountType,
  fallback?: AccountItem['accentTheme']
): AccountItem['accentTheme'] {
  if (fallback) return fallback;
  const lower = name.toLowerCase();
  if (type === 'credit' || lower.includes('nu')) return 'purple';
  if (type === 'savings') return 'amber';
  if (type === 'business') return 'slate';
  if (lower.includes('ita') || lower.includes('inter')) return 'orange';
  return 'blue';
}

export const ContasView: React.FC<ContasViewProps> = ({
  accounts,
  transactions,
  selectedMonthKey,
  dataSourceMode,
  isLoading = false,
  onRefresh,
  onSaveAccount,
  onDeleteAccount,
  onUpdateAccountBalance,
  onImportTransactions,
  onViewAccountStatement,
  onNotify,
}) => {
  const [filterTab, setFilterTab] = useState<'all' | 'checking' | 'credit' | 'investment'>('all');
  const [syncing, setSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState('Sincronizado em tempo real');

  // Create / Edit Account Modal
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [editingAcc, setEditingAcc] = useState<AccountItem | null>(null);
  const [formName, setFormName] = useState('');
  const [formCode, setFormCode] = useState('');
  const [codeManuallyEdited, setCodeManuallyEdited] = useState(false);
  const [formType, setFormType] = useState<AccountType>('checking');
  const [formBalance, setFormBalance] = useState('0');
  const [formLimit, setFormLimit] = useState('');
  const [formMeta, setFormMeta] = useState('Conta Corrente');
  const [metaManuallyEdited, setMetaManuallyEdited] = useState(false);
  const [isSavingAcc, setIsSavingAcc] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Adjust Initial Balance Modal
  const [adjustTarget, setAdjustTarget] = useState<AccountItem | null>(null);
  const [adjustValue, setAdjustValue] = useState('');
  const [adjustError, setAdjustError] = useState<string | null>(null);

  // Open Finance / Conciliation Rules Modal
  const [consentsOpen, setConsentsOpen] = useState(false);

  const totalInitialSum = accounts
    .filter((a) => a.type !== 'credit')
    .reduce((sum, a) => sum + a.initialBalance, 0);

  const liquidBalance = accounts
    .filter((a) => ['checking', 'savings', 'business'].includes(a.type))
    .reduce((sum, a) => sum + a.balance, 0);

  const creditInvoiceTotal = accounts
    .filter((a) => a.type === 'credit')
    .reduce((sum, a) => sum + a.balance, 0);

  const creditLimitTotal = accounts
    .filter((a) => a.type === 'credit')
    .reduce((sum, a) => sum + (a.limit || 0), 0);

  const creditUsagePct =
    creditLimitTotal > 0
      ? Math.min(100, Math.round((creditInvoiceTotal / creditLimitTotal) * 100))
      : 0;

  const investmentTotal = accounts
    .filter((a) => a.type === 'investment')
    .reduce((sum, a) => sum + a.balance, 0);

  const netWorth = liquidBalance + investmentTotal - creditInvoiceTotal;
  const grossAssets = liquidBalance + investmentTotal;

  const monthNetDeltaPct = useMemo(() => {
    const monthTx = filterTransactionsByMonthKey(transactions, selectedMonthKey);
    const inc = monthTx.filter((t) => t.type === 'receita').reduce((s, t) => s + t.amount, 0);
    const exp = monthTx.filter((t) => t.type === 'despesa').reduce((s, t) => s + t.amount, 0);
    const net = inc - exp;
    if (netWorth <= 0) return 0;
    return Number(((net / netWorth) * 100).toFixed(1));
  }, [transactions, selectedMonthKey, netWorth]);

  const investSharePct =
    grossAssets > 0 ? ((investmentTotal / grossAssets) * 100).toFixed(1) : '0';
  const liquidSharePct =
    grossAssets > 0 ? ((liquidBalance / grossAssets) * 100).toFixed(1) : '0';
  const invoiceSharePct =
    grossAssets > 0 ? ((creditInvoiceTotal / grossAssets) * 100).toFixed(1) : '0';

  const filteredAccounts = useMemo(
    () =>
      accounts.filter((acc) => {
        if (filterTab === 'all') return true;
        if (filterTab === 'checking') {
          return ['checking', 'savings', 'business'].includes(acc.type);
        }
        return acc.type === filterTab;
      }),
    [accounts, filterTab]
  );

  const handleSyncNow = async () => {
    if (syncing || isLoading) return;
    setSyncing(true);
    try {
      if (onRefresh) {
        await onRefresh();
      }
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      setLastSyncTime(`hoje às ${hh}:${mm}`);
      onNotify('Contas e saldos sincronizados com o Supabase!');
    } finally {
      setSyncing(false);
    }
  };

  const handleCsvFileImport = async (file: File) => {
    try {
      const text = await file.text();
      const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);

      if (lines.length <= 1) {
        onNotify(`Arquivo "${file.name}" lido sem novos lançamentos.`);
        return;
      }

      const defaultAcc = accounts[0];
      const parsedRows: Omit<Transaction, 'id'>[] = [];

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',').map((c) => c.replace(/^"|"$/g, '').trim());
        if (cols.length < 4) continue;
        const isoDate = /^\d{4}-\d{2}-\d{2}$/.test(cols[0]) ? cols[0] : getTodayIso();
        const time = cols.length >= 7 ? cols[1] : '12:00';
        const title = cols.length >= 7 ? cols[2] : cols[1];
        const category = cols.length >= 7 ? cols[3] || 'Sem categoria' : 'Sem categoria';
        const accName = cols.length >= 7 ? cols[4] : defaultAcc?.name || 'Sem conta';
        const rawType = cols.length >= 7 ? cols[5] : Number(cols[3]) >= 0 ? 'receita' : 'despesa';
        const rawAmount = parseFloat(cols[cols.length - 1].replace(',', '.'));
        if (!title || !Number.isFinite(rawAmount) || rawAmount === 0) continue;

        const matchedAcc =
          accounts.find((a) => a.name.toLowerCase() === accName.toLowerCase()) || defaultAcc;

        parsedRows.push({
          title,
          subtitle: `Importado de ${file.name}`,
          category,
          account: matchedAcc?.name || accName,
          accountId: matchedAcc?.id,
          accountIcon: matchedAcc?.type === 'credit' ? 'credit_card' : 'account_balance',
          type: rawType === 'receita' ? 'receita' : 'despesa',
          amount: Math.abs(rawAmount),
          date: isoDate,
          dateLabel: formatDateLabelPT(isoDate),
          dateGroup: formatDateGroupPT(isoDate),
          time: time || '12:00',
          method: 'Importação CSV',
          icon: rawType === 'receita' ? 'payments' : 'receipt_long',
          status: 'conciliado',
        });
      }

      if (parsedRows.length > 0) {
        onImportTransactions(parsedRows);
      } else {
        onNotify(`Arquivo "${file.name}" verificado.`);
      }
    } catch {
      onNotify('Não foi possível ler o arquivo selecionado.');
    }
  };

  const openNewAccountModal = () => {
    setEditingAcc(null);
    setFormName('');
    setFormCode('BK');
    setCodeManuallyEdited(false);
    setFormType('checking');
    setFormBalance('0');
    setFormLimit('');
    setFormMeta(MODALITY_LABELS.checking);
    setMetaManuallyEdited(false);
    setFormError(null);
    setAccountModalOpen(true);
  };

  const openEditAccountModal = (acc: AccountItem) => {
    setEditingAcc(acc);
    setFormName(acc.name);
    setFormCode(acc.institutionCode);
    setCodeManuallyEdited(true);
    setFormType(acc.type);
    setFormBalance(formatNumericForInput(acc.initialBalance));
    setFormLimit(acc.limit && acc.limit > 0 ? formatNumericForInput(acc.limit) : '');
    setFormMeta(acc.badgeText || MODALITY_LABELS[acc.type]);
    setMetaManuallyEdited(true);
    setFormError(null);
    setAccountModalOpen(true);
  };

  const handleNameChange = (value: string) => {
    setFormName(value);
    if (formError) setFormError(null);
    if (!codeManuallyEdited) {
      setFormCode(deriveCodeFromName(value, formType));
    }
  };

  const handleModalityChange = (nextType: AccountType) => {
    setFormType(nextType);
    if (formError) setFormError(null);
    if (!codeManuallyEdited || nextType === 'credit') {
      setFormCode(deriveCodeFromName(formName, nextType));
    }
    if (!metaManuallyEdited) {
      setFormMeta(MODALITY_LABELS[nextType]);
    }
  };

  // Live preview of resulting balance inside Create/Edit modal
  const modalPreviewStats = useMemo(() => {
    const parsedInitial = parseBrlBalanceInput(formBalance);
    const safeInitial = Number.isFinite(parsedInitial) ? parsedInitial : 0;
    const inflows = editingAcc?.calculatedInflows || 0;
    const outflows = editingAcc?.calculatedOutflows || 0;
    const isCredit = formType === 'credit';
    const netMovements = isCredit ? outflows - inflows : inflows - outflows;
    const resultingBalance = isCredit
      ? Math.max(0, Number((safeInitial + outflows - inflows).toFixed(2)))
      : Number((safeInitial + inflows - outflows).toFixed(2));
    return {
      isValid: Number.isFinite(parsedInitial),
      safeInitial,
      inflows,
      outflows,
      netMovements,
      resultingBalance,
    };
  }, [formBalance, editingAcc, formType]);

  // Live preview inside Adjust Initial Balance modal
  const adjustPreviewStats = useMemo(() => {
    if (!adjustTarget) return null;
    const parsedInitial = parseBrlBalanceInput(adjustValue);
    const safeInitial = Number.isFinite(parsedInitial) ? parsedInitial : 0;
    const inflows = adjustTarget.calculatedInflows || 0;
    const outflows = adjustTarget.calculatedOutflows || 0;
    const isCredit = adjustTarget.type === 'credit';
    const netMovements = isCredit ? outflows - inflows : inflows - outflows;
    const resultingBalance = isCredit
      ? Math.max(0, Number((safeInitial + outflows - inflows).toFixed(2)))
      : Number((safeInitial + inflows - outflows).toFixed(2));
    return {
      isValid: Number.isFinite(parsedInitial),
      safeInitial,
      netMovements,
      resultingBalance,
    };
  }, [adjustTarget, adjustValue]);

  const handleSaveAccountForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSavingAcc) return;

    const cleanName = formName.trim().replace(/\s+/g, ' ');
    if (!cleanName) {
      setFormError('Informe o nome da conta ou carteira.');
      return;
    }

    if (isDuplicateAccountName(accounts, cleanName, editingAcc?.id)) {
      setFormError(
        `Já existe uma conta ou carteira com o nome "${cleanName}". Escolha outro nome.`
      );
      return;
    }

    const numericInitialBalance = parseBrlBalanceInput(formBalance);
    if (!Number.isFinite(numericInitialBalance)) {
      setFormError('Informe um saldo inicial numérico válido (ex: 0, 1500 ou 1.500,50).');
      return;
    }

    const parsedLimit = formLimit.trim() ? parseBrlBalanceInput(formLimit) : 0;
    if (formType === 'credit' && formLimit.trim() && (!Number.isFinite(parsedLimit) || parsedLimit < 0)) {
      setFormError('Informe um limite de cartão válido.');
      return;
    }

    setIsSavingAcc(true);
    setFormError(null);
    try {
      const effectiveCode =
        formType === 'credit'
          ? 'CARD'
          : formCode.trim().slice(0, 3).toUpperCase() || deriveCodeFromName(cleanName, formType);

      const res = await onSaveAccount(
        {
          name: cleanName,
          institutionCode: effectiveCode,
          badgeText: formMeta.trim() || MODALITY_LABELS[formType],
          type: formType,
          openFinance: editingAcc?.openFinance ?? false,
          initialBalance: numericInitialBalance,
          balance: numericInitialBalance,
          limit: formType === 'credit' && parsedLimit > 0 ? parsedLimit : undefined,
          dueDate: formType === 'credit' ? editingAcc?.dueDate : undefined,
          statusText:
            formType === 'credit'
              ? 'Aberta'
              : formType === 'investment'
              ? 'Carteira Ativa'
              : undefined,
          metaRow1Label: 'Saldo Inicial',
          metaRow1Value: formatBRL(numericInitialBalance),
          metaRow2Label: 'Status',
          metaRow2Value: 'Sincronizada',
          metaRow2Highlight: true,
          accentTheme: deriveThemeFromModality(cleanName, formType, editingAcc?.accentTheme),
        },
        editingAcc?.id
      );

      if (res.ok) {
        setAccountModalOpen(false);
      } else {
        setFormError(res.errorMessage || 'Não foi possível salvar os dados da conta.');
      }
    } finally {
      setIsSavingAcc(false);
    }
  };

  const handleAdjustSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustTarget || isSavingAcc) return;

    const val = parseBrlBalanceInput(adjustValue);
    if (!Number.isFinite(val)) {
      setAdjustError('Informe um saldo inicial numérico válido (ex: 0, 1500 ou 1.500,50).');
      return;
    }

    setIsSavingAcc(true);
    setAdjustError(null);
    try {
      const res = await onUpdateAccountBalance(adjustTarget.id, val);
      if (res.ok) {
        setAdjustTarget(null);
      } else {
        setAdjustError(res.errorMessage || 'Não foi possível atualizar o saldo inicial.');
      }
    } finally {
      setIsSavingAcc(false);
    }
  };

  const isBusySyncing = syncing || isLoading;

  return (
    <div className="flex flex-col w-full space-y-space-lg">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-space-md">
        <div>
          <div className="flex items-center gap-1.5 text-on-surface-variant text-xs uppercase tracking-wider mb-1">
            <span>Gestão Patrimonial</span>
            <span>/</span>
            <span className="text-primary font-semibold">Portfólio &amp; Saldos</span>
          </div>
          <h1 className="text-[32px] leading-10 font-bold text-on-surface tracking-tight">
            Contas &amp; Carteiras
          </h1>
          <p className="text-sm text-on-surface-variant mt-1">
            Saldos bancários, carteiras e cartões atualizados automaticamente a partir do saldo inicial e das movimentações vinculadas.
          </p>
        </div>

        <div className="flex items-center gap-space-sm self-start md:self-auto flex-wrap">
          <button
            type="button"
            disabled={isBusySyncing}
            onClick={() => void handleSyncNow()}
            className="inline-flex items-center gap-2 px-space-md py-2.5 rounded-xl bg-surface-container-lowest text-on-surface text-sm font-semibold shadow-xs hover:bg-surface-container-low transition-all cursor-pointer whitespace-nowrap disabled:opacity-60"
          >
            <Icon
              name="sync_alt"
              className={`text-lg text-secondary ${isBusySyncing ? 'animate-spin' : ''}`}
            />
            <span>{isBusySyncing ? 'Sincronizando...' : 'Sincronizar Saldos'}</span>
          </button>
          <button
            type="button"
            onClick={openNewAccountModal}
            className="inline-flex items-center gap-2 px-space-md py-2.5 rounded-xl bg-primary text-on-primary text-sm font-semibold shadow-xs hover:bg-primary-container transition-all cursor-pointer whitespace-nowrap"
          >
            <Icon name="add_circle" className="text-lg" />
            <span>Nova Conta</span>
          </button>
        </div>
      </div>

      {/* 4 KPI Cards */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-space-md">
        <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-xs flex flex-col justify-between relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs text-on-surface-variant uppercase font-semibold">
              Saldo Calculado Consolidado
            </span>
            <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary">
              <Icon name="account_balance_wallet" className="text-lg" />
            </div>
          </div>
          <div className="mt-4">
            <div
              className={`text-3xl font-bold tracking-tight tabular-nums ${
                netWorth < 0 ? 'text-error' : 'text-on-surface'
              }`}
            >
              {formatBRL(netWorth, netWorth < 0 ? 'minus' : undefined)}
            </div>
            <div className="flex items-center gap-1.5 mt-2 text-xs">
              <span className="text-secondary tabular-nums">
                Saldo inicial total:{' '}
                <strong className="text-on-surface">
                  {formatBRL(totalInitialSum, totalInitialSum < 0 ? 'minus' : undefined)}
                </strong>
              </span>
            </div>
          </div>
        </div>

        <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs text-on-surface-variant uppercase font-semibold">
              Saldo Disponível (Contas &amp; Carteiras)
            </span>
            <div className="w-9 h-9 rounded-full bg-tertiary/10 flex items-center justify-center text-tertiary">
              <Icon name="payments" className="text-lg" />
            </div>
          </div>
          <div className="mt-4">
            <div
              className={`text-3xl font-bold tracking-tight tabular-nums ${
                liquidBalance < 0 ? 'text-error' : 'text-on-surface'
              }`}
            >
              {formatBRL(liquidBalance, liquidBalance < 0 ? 'minus' : undefined)}
            </div>
            <div className="flex items-center gap-1.5 mt-2 text-xs text-secondary">
              <Icon name="check_circle" className="text-sm text-primary" />
              <span>
                {
                  accounts.filter((a) => ['checking', 'savings', 'business'].includes(a.type))
                    .length
                }{' '}
                contas operacionais ({monthNetDeltaPct >= 0 ? '+' : ''}
                {monthNetDeltaPct.toFixed(1).replace('.', ',')}% no mês)
              </span>
            </div>
          </div>
        </div>

        <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs text-on-surface-variant uppercase font-semibold">
              Fatura de Cartões (A vencer)
            </span>
            <div className="w-9 h-9 rounded-full bg-error/10 flex items-center justify-center text-error">
              <Icon name="credit_card" className="text-lg" />
            </div>
          </div>
          <div className="mt-4">
            <div className="text-3xl text-on-surface font-bold tracking-tight tabular-nums">
              {formatBRL(creditInvoiceTotal)}
            </div>
            <div className="flex items-center justify-between mt-2 gap-2">
              <span className="text-xs text-secondary tabular-nums">
                {creditLimitTotal > 0
                  ? `Limite utilizado: ${creditUsagePct}%`
                  : `${accounts.filter((a) => a.type === 'credit').length} cartão(ões)`}
              </span>
              <div className="w-20 bg-surface-container rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-error h-full rounded-full"
                  style={{ width: `${creditUsagePct}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs text-on-surface-variant uppercase font-semibold">
              Carteira de Investimentos
            </span>
            <div className="w-9 h-9 rounded-full bg-secondary-container flex items-center justify-center text-on-secondary-container">
              <Icon name="trending_up" className="text-lg" />
            </div>
          </div>
          <div className="mt-4">
            <div className="text-3xl text-on-surface font-bold tracking-tight tabular-nums">
              {formatBRL(investmentTotal)}
            </div>
            <div className="flex items-center gap-1.5 mt-2 text-xs">
              <span className="inline-flex items-center gap-0.5 text-on-primary-fixed-variant font-semibold">
                <Icon name="trending_up" className="text-xs" />{' '}
                {accounts.filter((a) => a.type === 'investment').length} carteira(s)
              </span>
              <span className="text-secondary">· longo prazo</span>
            </div>
          </div>
        </div>
      </section>

      {/* Conciliação & Importação Bar */}
      <div className="bg-surface-container-low rounded-xl p-space-md shadow-xs flex flex-col sm:flex-row items-center justify-between gap-space-md">
        <div className="flex items-center gap-space-md">
          <div className="w-10 h-10 rounded-xl bg-surface-container-lowest flex items-center justify-center text-primary shadow-2xs shrink-0">
            <Icon name="hub" className="text-xl" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-on-surface">
                Conciliação Bancária &amp; Extratos
              </span>
              <span className="text-[11px] text-primary font-bold uppercase tracking-wider">
                {dataSourceMode === 'supabase' ? 'Nuvem Supabase' : 'Modo Local'}
              </span>
            </div>
            <p className="text-xs text-secondary">
              {accounts.length}{' '}
              {accounts.length === 1 ? 'conta cadastrada' : 'contas cadastradas'} • {lastSyncTime}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-space-sm w-full sm:w-auto">
          <label className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-space-md py-2 rounded-lg bg-surface-container-lowest text-on-surface text-xs font-semibold hover:bg-surface-container transition-colors shadow-2xs cursor-pointer whitespace-nowrap">
            <Icon name="file_upload" className="text-base text-secondary" />
            <span>Importar CSV</span>
            <input
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  void handleCsvFileImport(file);
                  e.target.value = '';
                }
              }}
            />
          </label>
          <button
            type="button"
            onClick={() => void handleSyncNow()}
            disabled={isBusySyncing}
            className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-space-md py-2 rounded-lg bg-surface-container-lowest text-primary text-xs font-semibold hover:bg-surface-container transition-colors shadow-2xs cursor-pointer whitespace-nowrap disabled:opacity-60"
          >
            <Icon name="refresh" className={`text-base ${isBusySyncing ? 'animate-spin' : ''}`} />
            <span>{isBusySyncing ? 'Atualizando...' : 'Atualizar Agora'}</span>
          </button>
        </div>
      </div>

      {/* Accounts Grid */}
      <section className="space-y-space-md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-space-sm">
            <h2 className="text-xl text-on-surface font-bold">Suas Contas e Carteiras</h2>
            <span className="text-xs text-secondary font-semibold tabular-nums">
              ({filteredAccounts.length}{' '}
              {filteredAccounts.length === 1 ? 'exibida' : 'exibidas'})
            </span>
          </div>

          <div className="flex items-center gap-1 bg-surface-container-low p-1 rounded-lg self-start overflow-x-auto max-w-full">
            {(
              [
                { id: 'all', label: `Todas (${accounts.length})` },
                { id: 'checking', label: 'Contas & Carteiras' },
                { id: 'credit', label: 'Cartões' },
                { id: 'investment', label: 'Investimentos' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilterTab(tab.id)}
                className={`px-3 py-1 rounded-md text-xs transition-colors cursor-pointer whitespace-nowrap ${
                  filterTab === tab.id
                    ? 'bg-surface-container-lowest text-on-surface font-semibold shadow-2xs'
                    : 'text-on-surface-variant hover:text-on-surface font-medium'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {filteredAccounts.length === 0 ? (
          <EmptyState
            icon="account_balance_wallet"
            title={
              accounts.length === 0
                ? 'Nenhuma conta ou carteira cadastrada'
                : 'Nenhuma conta nesta modalidade'
            }
            description={
              accounts.length === 0
                ? 'Cadastre suas contas bancárias e carteiras informando o nome e o saldo inicial para acompanhar os saldos calculados em tempo real no Supabase.'
                : 'Altere o filtro acima ou cadastre uma nova conta ou carteira.'
            }
            actionLabel="Nova Conta"
            onAction={openNewAccountModal}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-space-md">
            {filteredAccounts.map((acc) => {
              const isCredit = acc.type === 'credit';
              const isInvest = acc.type === 'investment';
              const usedLimitPct =
                isCredit && acc.limit
                  ? Math.min(100, Math.round((acc.balance / acc.limit) * 100))
                  : 0;
              const availableLimit =
                isCredit && acc.limit ? Math.max(0, acc.limit - acc.balance) : 0;
              const inflows = acc.calculatedInflows || 0;
              const outflows = acc.calculatedOutflows || 0;
              const netMovements = isCredit ? outflows - inflows : inflows - outflows;
              const accTxCount = transactions.filter((t) => {
                if (t.accountId && acc.id) return t.accountId === acc.id;
                if (t.accountId) return false;
                const norm = (t.account || '').trim().toLowerCase();
                if (!norm || norm === 'sem conta') return false;
                return norm === acc.name.trim().toLowerCase();
              }).length;

              return (
                <div
                  key={acc.id}
                  className="bg-surface-container-lowest rounded-xl p-space-lg shadow-xs flex flex-col justify-between hover:shadow-md hover:-translate-y-0.5 transition-all"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-space-sm min-w-0">
                        <div
                          className={`w-12 h-12 rounded-xl ${
                            ACCENT_STYLES[acc.accentTheme] || ACCENT_STYLES.blue
                          } flex items-center justify-center font-bold text-lg shrink-0`}
                        >
                          {acc.institutionCode === 'CARD' ? (
                            <Icon name="credit_card" className="text-2xl" />
                          ) : (
                            acc.institutionCode
                          )}
                        </div>
                        <div className="min-w-0">
                          <h3 className="text-lg text-on-surface font-bold leading-tight truncate">
                            {acc.name}
                          </h3>
                          <div className="flex items-center gap-1.5 mt-0.5 text-xs text-secondary">
                            <span className="font-medium truncate">{acc.badgeText}</span>
                            <span>·</span>
                            <span className="tabular-nums shrink-0">
                              {accTxCount}{' '}
                              {accTxCount === 1 ? 'movimentação' : 'movimentações'}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-0.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => openEditAccountModal(acc)}
                          aria-label={`Editar ${acc.name}`}
                          title="Editar nome e saldo inicial"
                          className="text-on-surface-variant hover:text-primary p-1.5 rounded-lg hover:bg-surface-container-low transition-colors cursor-pointer"
                        >
                          <Icon name="edit" className="text-base" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteAccount(acc)}
                          aria-label={`Excluir ${acc.name}`}
                          title="Excluir conta"
                          className="text-on-surface-variant hover:text-error p-1.5 rounded-lg hover:bg-error-container transition-colors cursor-pointer"
                        >
                          <Icon name="delete" className="text-base" />
                        </button>
                      </div>
                    </div>

                    {/* Calculated Current Balance / Invoice */}
                    <div className="mt-5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-secondary uppercase font-semibold">
                          {isCredit
                            ? 'Fatura Atual Calculada'
                            : isInvest
                            ? 'Saldo Atual (Investido)'
                            : 'Saldo Atual da Conta'}
                        </span>
                        <span className="text-[11px] font-semibold text-primary">
                          Tempo real
                        </span>
                      </div>
                      <div
                        className={`text-2xl font-bold mt-0.5 tabular-nums ${
                          isCredit
                            ? 'text-error'
                            : acc.balance < 0
                            ? 'text-error'
                            : 'text-on-surface'
                        }`}
                      >
                        {formatBRL(acc.balance, !isCredit && acc.balance < 0 ? 'minus' : undefined)}
                      </div>
                    </div>

                    {/* Explicit Saldo Inicial + Movimentações Breakdown */}
                    <div className="mt-3 bg-surface-container-low/70 rounded-lg p-2.5 space-y-1.5 text-xs tabular-nums">
                      <div className="flex items-center justify-between text-secondary">
                        <span>Saldo Inicial (cadastrado)</span>
                        <span className="font-semibold text-on-surface">
                          {formatBRL(
                            acc.initialBalance,
                            acc.initialBalance < 0 ? 'minus' : undefined
                          )}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-secondary">
                        <span>Movimentações vinculadas ({accTxCount})</span>
                        <span
                          className={`font-semibold ${
                            isCredit
                              ? netMovements > 0
                                ? 'text-error'
                                : 'text-primary'
                              : netMovements >= 0
                              ? 'text-primary'
                              : 'text-error'
                          }`}
                        >
                          {netMovements === 0 ? formatBRL(0) : formatBRL(netMovements, 'auto')}
                        </span>
                      </div>
                      {(inflows > 0 || outflows > 0) && (
                        <div className="flex items-center justify-between text-[11px] text-secondary pt-1 border-t border-surface-container">
                          <span className="text-primary">Receitas: +{formatBRL(inflows)}</span>
                          <span className="text-error">Despesas: -{formatBRL(outflows)}</span>
                        </div>
                      )}
                      {isCredit && acc.limit ? (
                        <div className="pt-1.5 space-y-1 border-t border-surface-container">
                          <div className="w-full bg-surface-container rounded-full h-1.5 overflow-hidden">
                            <div
                              className="bg-primary h-full rounded-full"
                              style={{ width: `${usedLimitPct}%` }}
                            />
                          </div>
                          <div className="flex items-center justify-between text-[11px] text-secondary">
                            <span>Limite: {formatBRL(acc.limit)}</span>
                            <span>Disp.: {formatBRL(availableLimit)}</span>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {/* Card Actions */}
                  <div className="mt-5 flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => onViewAccountStatement(acc.name)}
                      className="flex-1 py-2 px-3 rounded-lg bg-surface-container-low text-on-surface text-xs font-semibold hover:bg-surface-container transition-colors flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap"
                    >
                      <Icon name={isInvest ? 'show_chart' : 'receipt_long'} className="text-base" />
                      <span>{isCredit ? 'Ver Fatura' : 'Ver Extrato'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAdjustTarget(acc);
                        setAdjustValue(formatNumericForInput(acc.initialBalance));
                        setAdjustError(null);
                      }}
                      className="py-2 px-3 rounded-lg bg-surface-container-low text-on-surface text-xs font-semibold hover:bg-surface-container transition-colors flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap"
                    >
                      <Icon name="tune" className="text-base" />
                      <span>Saldo Inicial</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Bottom Distribution + Health */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-space-md">
        <div className="lg:col-span-2 bg-surface-container-lowest rounded-xl p-space-lg shadow-xs">
          <div className="flex items-center justify-between mb-space-md">
            <div>
              <h3 className="text-lg text-on-surface font-bold">
                Distribuição Patrimonial por Modalidade
              </h3>
              <p className="text-xs text-secondary mt-0.5">
                Proporção calculada sobre os saldos atuais das suas contas e carteiras
              </p>
            </div>
            <span className="text-xs text-secondary font-semibold tabular-nums">
              Ativos Brutos: {formatBRL(Math.max(0, grossAssets))}
            </span>
          </div>

          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-xs mb-1.5 tabular-nums">
                <span className="font-medium text-on-surface flex items-center gap-2">
                  <span className="w-3 h-3 rounded-xs bg-blue-600" />
                  Investimentos &amp; Ativos de Longo Prazo
                </span>
                <span className="font-semibold text-on-surface">
                  {formatBRL(investmentTotal)} ({investSharePct}%)
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-surface-container overflow-hidden">
                <div
                  className="h-full bg-blue-600 rounded-full"
                  style={{ width: `${Math.max(0, Math.min(100, Number(investSharePct)))}%` }}
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1.5 tabular-nums">
                <span className="font-medium text-on-surface flex items-center gap-2">
                  <span className="w-3 h-3 rounded-xs bg-primary" />
                  Liquidez Imediata (Contas &amp; Carteiras)
                </span>
                <span className="font-semibold text-on-surface">
                  {formatBRL(liquidBalance, liquidBalance < 0 ? 'minus' : undefined)} ({liquidSharePct}%)
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-surface-container overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full"
                  style={{ width: `${Math.max(0, Math.min(100, Number(liquidSharePct)))}%` }}
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1.5 tabular-nums">
                <span className="font-medium text-on-surface flex items-center gap-2">
                  <span className="w-3 h-3 rounded-xs bg-error" />
                  Faturas Comprometidas (A Pagar)
                </span>
                <span className="font-semibold text-error">
                  -{formatBRL(creditInvoiceTotal)} ({invoiceSharePct}% dos ativos)
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-surface-container overflow-hidden">
                <div
                  className="h-full bg-error rounded-full"
                  style={{ width: `${Math.max(0, Math.min(100, Number(invoiceSharePct)))}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-space-sm">
              <h3 className="text-lg text-on-surface font-bold">Resumo de Contas</h3>
              <Icon name="verified_user" className="text-primary text-xl" />
            </div>
            <p className="text-xs text-secondary leading-relaxed">
              Qualquer receita ou despesa adicionada, editada ou excluída ajusta automaticamente o saldo atual da conta ou carteira vinculada.
            </p>
            <div className="mt-4 space-y-2">
              {accounts.length === 0 ? (
                <p className="text-xs text-secondary">Nenhuma conta cadastrada no momento.</p>
              ) : (
                accounts.slice(0, 4).map((acc) => (
                  <div
                    key={acc.id}
                    className="flex items-center justify-between p-2.5 rounded-lg bg-surface-container-low"
                  >
                    <span className="text-xs font-semibold text-on-surface truncate pr-2">
                      {acc.name}
                    </span>
                    <span
                      className={`text-xs font-semibold tabular-nums shrink-0 ${
                        acc.type === 'credit' || acc.balance < 0 ? 'text-error' : 'text-primary'
                      }`}
                    >
                      {formatBRL(acc.balance, acc.type !== 'credit' && acc.balance < 0 ? 'minus' : undefined)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="mt-4 pt-2">
            <button
              type="button"
              onClick={() => setConsentsOpen(true)}
              className="w-full py-2.5 px-space-md rounded-xl bg-surface-container-low text-on-surface text-xs font-semibold hover:bg-surface-container transition-colors flex items-center justify-center gap-2 cursor-pointer"
            >
              <Icon name="security" className="text-lg text-secondary" />
              <span>Ver Regras de Conciliação</span>
            </button>
          </div>
        </div>
      </section>

      {/* Modal: Nova / Editar Conta ou Carteira */}
      {accountModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-inverse-surface/40 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => {
            if (!isSavingAcc) setAccountModalOpen(false);
          }}
        >
          <form
            onSubmit={handleSaveAccountForm}
            onClick={(e) => e.stopPropagation()}
            className="bg-surface-container-lowest rounded-2xl max-w-md w-full p-space-lg shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-on-surface">
                  {editingAcc ? 'Editar Conta ou Carteira' : 'Nova Conta ou Carteira'}
                </h3>
                <p className="text-xs text-secondary mt-0.5">
                  {editingAcc
                    ? 'Altere o nome ou o saldo inicial persistido no Supabase'
                    : 'Informe o nome e o saldo inicial para calcular o saldo automaticamente'}
                </p>
              </div>
              <button
                type="button"
                disabled={isSavingAcc}
                onClick={() => setAccountModalOpen(false)}
                className="w-8 h-8 rounded-lg hover:bg-surface-container-low flex items-center justify-center text-secondary cursor-pointer disabled:opacity-50"
              >
                <Icon name="close" className="text-lg" />
              </button>
            </div>

            {formError && (
              <div
                role="alert"
                className="p-3 rounded-xl bg-error-container/60 text-error text-xs font-semibold flex items-start gap-2"
              >
                <Icon name="error" className="text-base shrink-0 mt-0.5" />
                <span>{formError}</span>
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-secondary block mb-1">
                  Nome da Conta ou Carteira
                </label>
                <input
                  type="text"
                  required
                  disabled={isSavingAcc}
                  value={formName}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="Ex: Nubank, Carteira Física, Itaú..."
                  className="w-full bg-surface-container-low px-3 py-2 rounded-xl text-sm text-on-surface focus:outline-none focus:bg-surface-container"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-secondary block mb-1">
                    {formType === 'credit' ? 'Fatura Inicial (R$)' : 'Saldo Inicial (R$)'}
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-secondary">
                      R$
                    </span>
                    <input
                      type="text"
                      inputMode="decimal"
                      required
                      disabled={isSavingAcc}
                      value={formBalance}
                      onChange={(e) => {
                        setFormBalance(e.target.value);
                        if (formError) setFormError(null);
                      }}
                      placeholder="0,00"
                      className="w-full bg-surface-container-low pl-9 pr-3 py-2 rounded-xl text-sm font-semibold text-on-surface tabular-nums focus:outline-none focus:bg-surface-container"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-secondary block mb-1">
                    Modalidade
                  </label>
                  <select
                    disabled={isSavingAcc}
                    value={formType}
                    onChange={(e) => handleModalityChange(e.target.value as AccountType)}
                    className="w-full bg-surface-container-low px-3 py-2 rounded-xl text-sm text-on-surface focus:outline-none cursor-pointer"
                  >
                    <option value="checking">Conta Corrente</option>
                    <option value="savings">Carteira / Reserva</option>
                    <option value="business">Conta PJ</option>
                    <option value="investment">Investimentos</option>
                    <option value="credit">Cartão de Crédito</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-secondary block mb-1">
                    Sigla (2-3 letras)
                  </label>
                  <input
                    type="text"
                    maxLength={4}
                    disabled={isSavingAcc || formType === 'credit'}
                    value={formType === 'credit' ? 'CARD' : formCode}
                    onChange={(e) => {
                      setFormCode(e.target.value.toUpperCase());
                      setCodeManuallyEdited(true);
                    }}
                    className="w-full bg-surface-container-low px-3 py-2 rounded-xl text-sm text-on-surface uppercase focus:outline-none disabled:opacity-60"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-secondary block mb-1">
                    {formType === 'credit' ? 'Limite Opcional (R$)' : 'Identificação Curta'}
                  </label>
                  {formType === 'credit' ? (
                    <input
                      type="text"
                      inputMode="decimal"
                      disabled={isSavingAcc}
                      value={formLimit}
                      onChange={(e) => {
                        setFormLimit(e.target.value);
                        if (formError) setFormError(null);
                      }}
                      placeholder="Opcional"
                      className="w-full bg-surface-container-low px-3 py-2 rounded-xl text-sm text-on-surface tabular-nums focus:outline-none"
                    />
                  ) : (
                    <input
                      type="text"
                      disabled={isSavingAcc}
                      value={formMeta}
                      onChange={(e) => {
                        setFormMeta(e.target.value);
                        setMetaManuallyEdited(true);
                      }}
                      placeholder="Ex: Carteira Pessoal"
                      className="w-full bg-surface-container-low px-3 py-2 rounded-xl text-sm text-on-surface focus:outline-none"
                    />
                  )}
                </div>
              </div>

              {/* Live Calculated Balance Preview */}
              <div className="p-3 rounded-xl bg-surface-container-low space-y-1 text-xs tabular-nums">
                <div className="flex items-center justify-between text-secondary">
                  <span>Saldo Inicial informado</span>
                  <span className="font-semibold text-on-surface">
                    {modalPreviewStats.isValid
                      ? formatBRL(
                          modalPreviewStats.safeInitial,
                          modalPreviewStats.safeInitial < 0 ? 'minus' : undefined
                        )
                      : '—'}
                  </span>
                </div>
                {editingAcc && (
                  <div className="flex items-center justify-between text-secondary">
                    <span>Impacto das movimentações vinculadas</span>
                    <span
                      className={`font-semibold ${
                        modalPreviewStats.netMovements >= 0 ? 'text-primary' : 'text-error'
                      }`}
                    >
                      {modalPreviewStats.netMovements === 0
                        ? formatBRL(0)
                        : formatBRL(modalPreviewStats.netMovements, 'auto')}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between pt-1 border-t border-surface-container">
                  <span className="font-semibold text-on-surface">
                    {formType === 'credit' ? 'Fatura Atual Resultante' : 'Saldo Atual Resultante'}
                  </span>
                  <span className="font-bold text-primary">
                    {modalPreviewStats.isValid
                      ? formatBRL(
                          modalPreviewStats.resultingBalance,
                          formType !== 'credit' && modalPreviewStats.resultingBalance < 0
                            ? 'minus'
                            : undefined
                        )
                      : '—'}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              {editingAcc ? (
                <button
                  type="button"
                  disabled={isSavingAcc}
                  onClick={() => {
                    const target = editingAcc;
                    setAccountModalOpen(false);
                    onDeleteAccount(target);
                  }}
                  className="px-3 py-2 rounded-xl text-xs font-semibold text-error hover:bg-error-container transition-colors cursor-pointer disabled:opacity-50"
                >
                  Excluir Conta
                </button>
              ) : (
                <span />
              )}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={isSavingAcc}
                  onClick={() => setAccountModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-sm font-medium text-secondary hover:bg-surface-container-low cursor-pointer disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSavingAcc}
                  className="px-5 py-2 rounded-xl bg-primary text-on-primary text-sm font-semibold hover:bg-primary-container cursor-pointer inline-flex items-center gap-1.5 disabled:opacity-60"
                >
                  {isSavingAcc ? (
                    <>
                      <Icon name="progress_activity" className="text-base animate-spin" />
                      <span>Salvando...</span>
                    </>
                  ) : (
                    <span>{editingAcc ? 'Salvar Alterações' : 'Salvar Conta'}</span>
                  )}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Ajustar Saldo Inicial */}
      {adjustTarget && (
        <div
          className="fixed inset-0 z-50 bg-inverse-surface/40 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => !isSavingAcc && setAdjustTarget(null)}
        >
          <form
            onSubmit={handleAdjustSubmit}
            onClick={(e) => e.stopPropagation()}
            className="bg-surface-container-lowest rounded-2xl max-w-sm w-full p-space-lg shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-on-surface truncate pr-2">
                Saldo Inicial — {adjustTarget.name}
              </h3>
              <button
                type="button"
                disabled={isSavingAcc}
                onClick={() => setAdjustTarget(null)}
                className="w-8 h-8 rounded-lg hover:bg-surface-container-low flex items-center justify-center text-secondary cursor-pointer shrink-0"
              >
                <Icon name="close" className="text-lg" />
              </button>
            </div>

            {adjustError && (
              <div
                role="alert"
                className="p-2.5 rounded-xl bg-error-container/60 text-error text-xs font-semibold flex items-start gap-2"
              >
                <Icon name="error" className="text-base shrink-0 mt-0.5" />
                <span>{adjustError}</span>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-xs font-semibold text-secondary block">
                {adjustTarget.type === 'credit'
                  ? 'Fatura Inicial Base (R$)'
                  : 'Saldo Inicial da Conta (R$)'}
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-secondary">
                  R$
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  required
                  disabled={isSavingAcc}
                  value={adjustValue}
                  onChange={(e) => {
                    setAdjustValue(e.target.value);
                    if (adjustError) setAdjustError(null);
                  }}
                  className="w-full bg-surface-container-low pl-10 pr-3.5 py-2.5 rounded-xl text-lg font-bold text-on-surface tabular-nums focus:outline-none focus:bg-surface-container"
                />
              </div>

              {adjustPreviewStats && (
                <div className="p-2.5 rounded-xl bg-surface-container-low text-xs space-y-1 tabular-nums">
                  <div className="flex justify-between text-secondary">
                    <span>Movimentações vinculadas</span>
                    <span className="font-semibold text-on-surface">
                      {adjustPreviewStats.netMovements === 0
                        ? formatBRL(0)
                        : formatBRL(adjustPreviewStats.netMovements, 'auto')}
                    </span>
                  </div>
                  <div className="flex justify-between pt-1 border-t border-surface-container">
                    <span className="font-semibold text-on-surface">Novo saldo atual</span>
                    <span className="font-bold text-primary">
                      {adjustPreviewStats.isValid
                        ? formatBRL(
                            adjustPreviewStats.resultingBalance,
                            adjustTarget.type !== 'credit' &&
                              adjustPreviewStats.resultingBalance < 0
                              ? 'minus'
                              : undefined
                          )
                        : '—'}
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={isSavingAcc}
                onClick={() => setAdjustTarget(null)}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold text-secondary hover:bg-surface-container-low cursor-pointer disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isSavingAcc}
                className="px-4 py-2 rounded-xl bg-primary text-on-primary text-sm font-semibold cursor-pointer inline-flex items-center gap-1.5 disabled:opacity-60"
              >
                {isSavingAcc ? (
                  <>
                    <Icon name="progress_activity" className="text-base animate-spin" />
                    <span>Salvando...</span>
                  </>
                ) : (
                  <span>Salvar Saldo Inicial</span>
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Regras de Conciliação */}
      {consentsOpen && (
        <div
          className="fixed inset-0 z-50 bg-inverse-surface/40 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setConsentsOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-surface-container-lowest rounded-2xl max-w-md w-full p-space-lg shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-on-surface">Regras de Conciliação Automática</h3>
              <button
                type="button"
                onClick={() => setConsentsOpen(false)}
                className="w-8 h-8 rounded-lg hover:bg-surface-container-low flex items-center justify-center text-secondary cursor-pointer"
              >
                <Icon name="close" className="text-lg" />
              </button>
            </div>
            <p className="text-xs text-secondary leading-relaxed">
              O FinanCerto mantém o saldo de cada conta ou carteira sincronizado automaticamente com suas movimentações reais no Supabase:
            </p>
            <div className="space-y-2 text-xs">
              <div className="p-3 rounded-xl bg-surface-container-low">
                <p className="font-semibold text-on-surface">Contas Correntes, Carteiras, Reserva e PJ</p>
                <p className="text-secondary mt-0.5">
                  Saldo Atual = Saldo Inicial + Receitas vinculadas − Despesas vinculadas.
                </p>
              </div>
              <div className="p-3 rounded-xl bg-surface-container-low">
                <p className="font-semibold text-on-surface">Cartões de Crédito</p>
                <p className="text-secondary mt-0.5">
                  Compras vinculadas aumentam a fatura calculada; pagamentos/estornos reduzem a fatura.
                </p>
              </div>
              <div className="p-3 rounded-xl bg-surface-container-low">
                <p className="font-semibold text-on-surface">Proteção de Movimentações na Exclusão</p>
                <p className="text-secondary mt-0.5">
                  Ao excluir uma conta, os lançamentos vinculados têm apenas o vínculo de conta removido, preservando 100% do histórico no seu extrato.
                </p>
              </div>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setConsentsOpen(false)}
                className="px-4 py-2 rounded-xl bg-primary text-on-primary text-sm font-semibold cursor-pointer"
              >
                Entendi
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

