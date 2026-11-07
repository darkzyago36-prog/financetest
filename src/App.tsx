import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  buildMonthsCatalog,
  createEmptyUserProfile,
  formatDateGroupPT,
  formatDateLabelPT,
  getCurrentMonthKey,
  getMonthLabelFromKey,
  getTodayIso,
} from './data/initialData';
import {
  computeAccountsWithCalculatedBalance,
  computeCategoriesWithSpending,
} from './services/analyticsService';
import {
  createAccountInDb,
  createCategoryInDb,
  createGoalInDb,
  createTransactionInDb,
  deleteAccountInDb,
  deleteCategoryInDb,
  deleteGoalInDb,
  deleteTransactionsInDb,
  fetchUserProfileFromDb,
  FinanceServiceError,
  getDataSourceMode,
  loadUserFinanceData,
  updateAccountInDb,
  updateCategoryInDb,
  updateGoalInDb,
  updateGoalProgressInDb,
  updateProfileInDb,
  updateTransactionInDb,
} from './services/financeService';
import {
  AccountItem,
  Category,
  DataSourceMode,
  GoalItem,
  NotificationItem,
  ScreenId,
  Transaction,
  UserProfile,
} from './types/finance';
import { useAuth } from './contexts/AuthContext';
import { BrandLogo, Icon } from './components/Icon';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { TransactionModal } from './components/TransactionModal';
import { ConfirmDialog } from './components/ui/ConfirmDialog';
import { AuthView } from './views/AuthView';
import { DashboardView } from './views/DashboardView';
import { MovimentacoesView } from './views/MovimentacoesView';
import { CategoriasView, SaveCategoryResult } from './views/CategoriasView';
import { ContasView, SaveAccountResult } from './views/ContasView';
import { MetasView, SaveGoalResult } from './views/MetasView';
import { RelatoriosView } from './views/RelatoriosView';
import { ConfiguracoesView, SaveProfileResult } from './views/ConfiguracoesView';

interface ConfirmState {
  title: string;
  description: string;
  confirmLabel?: string;
  tone?: 'danger' | 'primary';
  onConfirm: () => void | Promise<void>;
}

export default function App() {
  const {
    user,
    loading: authLoading,
    isPasswordRecovery,
    handleSessionExpired,
    signOut,
  } = useAuth();

  const [activeScreen, setActiveScreen] = useState<ScreenId>('dashboard');
  const [selectedMonthKey, setSelectedMonthKey] = useState<string>(getCurrentMonthKey);
  const [forceMobilePreview, setForceMobilePreview] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [dataSourceMode, setDataSourceMode] = useState<DataSourceMode>(getDataSourceMode);

  // Authenticated user's real records from Supabase (zero demo data)
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [goals, setGoals] = useState<GoalItem[]>([]);
  const [userProfile, setUserProfile] = useState<UserProfile>(() => createEmptyUserProfile());
  const [readNotifIds, setReadNotifIds] = useState<string[]>([]);

  // Data loading & mutation states
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSavingTx, setIsSavingTx] = useState(false);

  // Pre-selected account filter when navigating from ContasView -> MovimentacoesView
  const [pendingAccountFilter, setPendingAccountFilter] = useState<string | undefined>(undefined);

  // Transaction Modal
  const [txModalOpen, setTxModalOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);

  // Centralized Confirmation Dialog
  const [confirmDialog, setConfirmDialog] = useState<ConfirmState | null>(null);
  const [isConfirmingAction, setIsConfirmingAction] = useState(false);

  // Toast Notification (Portuguese success & error feedback)
  const [toast, setToast] = useState<{
    message: string;
    tone: 'success' | 'error';
  } | null>(null);

  const showToast = useCallback((message: string, tone: 'success' | 'error' = 'success') => {
    setToast({ message, tone });
    setTimeout(() => {
      setToast((prev) => (prev?.message === message ? null : prev));
    }, 3800);
  }, []);

  const handleServiceError = useCallback(
    async (err: unknown, fallbackMessagePT: string) => {
      if (err instanceof FinanceServiceError) {
        if (err.isSessionExpired) {
          await handleSessionExpired(err.messagePT);
          return;
        }
        showToast(err.messagePT, 'error');
        return;
      }
      const message =
        err instanceof Error && err.message ? err.message : fallbackMessagePT;
      showToast(message, 'error');
    },
    [handleSessionExpired, showToast]
  );

  // Keep latest User reference without resetting state on in-place metadata/password updates
  const userRef = useRef(user);
  userRef.current = user;
  const activeUserId = user?.id ?? null;

  // Load authenticated user's data from Supabase
  const refreshFinanceData = useCallback(
    async (silent = false) => {
      const currentUser = userRef.current;
      if (!currentUser || !activeUserId) return;
      if (!silent) setIsLoadingData(true);
      setLoadError(null);
      try {
        const payload = await loadUserFinanceData(currentUser);
        setDataSourceMode(payload.mode);
        setTransactions(payload.transactions);
        setCategories(payload.categories);
        setAccounts(payload.accounts);
        setGoals(payload.goals);
        setUserProfile(payload.profile);

        if (payload.transactions.length > 0) {
          setSelectedMonthKey((prevKey) => {
            const hasInCurrent = payload.transactions.some(
              (t) => t.date.slice(0, 7) === prevKey
            );
            if (hasInCurrent) return prevKey;
            const latestKey = payload.transactions[0]?.date.slice(0, 7);
            return latestKey || prevKey;
          });
        }
      } catch (err) {
        if (err instanceof FinanceServiceError && err.isSessionExpired) {
          await handleSessionExpired(err.messagePT);
          return;
        }
        const messagePT =
          err instanceof FinanceServiceError
            ? err.messagePT
            : 'Não foi possível carregar seus dados financeiros. Verifique sua conexão e tente novamente.';
        setLoadError(messagePT);
        showToast(messagePT, 'error');
      } finally {
        setIsLoadingData(false);
      }
    },
    [activeUserId, handleSessionExpired, showToast]
  );

  useEffect(() => {
    const currentUser = userRef.current;
    if (!currentUser || !activeUserId || isPasswordRecovery) {
      setTransactions([]);
      setCategories([]);
      setAccounts([]);
      setGoals([]);
      setUserProfile(createEmptyUserProfile());
      setReadNotifIds([]);
      setPendingAccountFilter(undefined);
      setSelectedMonthKey(getCurrentMonthKey());
      setLoadError(null);
      setTxModalOpen(false);
      setEditingTx(null);
      setConfirmDialog(null);
      return;
    }

    setUserProfile(
      createEmptyUserProfile({
        id: currentUser.id,
        fullName:
          typeof currentUser.user_metadata?.full_name === 'string'
            ? currentUser.user_metadata.full_name
            : undefined,
        email: currentUser.email,
        createdAt: currentUser.created_at,
      })
    );
    void refreshFinanceData();
  }, [activeUserId, isPasswordRecovery, refreshFinanceData]);

  useEffect(() => {
    const checkViewport = () => setIsMobileViewport(window.innerWidth < 1024);
    checkViewport();
    window.addEventListener('resize', checkViewport);
    return () => window.removeEventListener('resize', checkViewport);
  }, []);

  // Dynamic calendar catalog expanding automatically to include all user transaction dates
  const monthsCatalog = useMemo(
    () => buildMonthsCatalog(transactions.map((t) => t.date)),
    [transactions]
  );

  const availableMonths = useMemo(
    () => monthsCatalog.map((m) => m.label),
    [monthsCatalog]
  );

  const availableMonthKeys = useMemo(
    () => monthsCatalog.map((m) => m.key),
    [monthsCatalog]
  );

  const monthIndex = useMemo(() => {
    const idx = monthsCatalog.findIndex((m) => m.key === selectedMonthKey);
    if (idx >= 0) return idx;
    const currIdx = monthsCatalog.findIndex((m) => m.key === getCurrentMonthKey());
    return currIdx >= 0 ? currIdx : Math.max(0, monthsCatalog.length - 1);
  }, [monthsCatalog, selectedMonthKey]);

  const selectedMonth = useMemo(
    () => monthsCatalog[monthIndex]?.label || getMonthLabelFromKey(selectedMonthKey),
    [monthsCatalog, monthIndex, selectedMonthKey]
  );

  // Live computed accounts: initialBalance (from `accounts.initial_balance`) + linked `transactions`
  const computedAccounts = useMemo(
    () => computeAccountsWithCalculatedBalance(accounts, transactions),
    [accounts, transactions]
  );

  // Live computed categories for the active month
  const computedCategories = useMemo(
    () => computeCategoriesWithSpending(categories, transactions, selectedMonthKey),
    [categories, transactions, selectedMonthKey]
  );

  // Dynamic notifications derived strictly from real user data
  const notifications = useMemo<NotificationItem[]>(() => {
    const list: NotificationItem[] = [];
    if (userProfile.budgetCeilingAlert) {
      for (const cat of computedCategories) {
        if (cat.type === 'despesa' && cat.budget > 0 && cat.spent >= cat.budget * 0.8) {
          const pct = Math.round((cat.spent / cat.budget) * 100);
          const id = `notif-budget-${cat.id}-${selectedMonthKey}`;
          list.push({
            id,
            title:
              pct >= 100
                ? `Limite excedido em ${cat.name}`
                : `Alerta de orçamento em ${cat.name}`,
            description: `${pct}% do teto mensal utilizado em ${selectedMonth}.`,
            time: 'Tempo real',
            read: readNotifIds.includes(id),
            icon: 'warning',
            tone: 'warning',
          });
        }
      }
    }
    const pendingCount = transactions.filter((t) => t.status === 'pendente').length;
    if (pendingCount > 0) {
      const id = `notif-pending-${pendingCount}`;
      list.push({
        id,
        title: `${pendingCount} ${
          pendingCount === 1 ? 'lançamento pendente' : 'lançamentos pendentes'
        }`,
        description: 'Confira os lançamentos aguardando efetivação em Movimentações.',
        time: 'Extrato',
        read: readNotifIds.includes(id),
        icon: 'schedule',
        tone: 'info',
      });
    }
    return list;
  }, [
    computedCategories,
    transactions,
    userProfile.budgetCeilingAlert,
    selectedMonthKey,
    selectedMonth,
    readNotifIds,
  ]);

  // Total consolidated balance across all accounts (including unlinked transactions if any)
  const totalConsolidatedBalance = useMemo(() => {
    if (computedAccounts.length === 0) {
      const inc = transactions
        .filter((t) => t.type === 'receita')
        .reduce((sum, t) => sum + t.amount, 0);
      const exp = transactions
        .filter((t) => t.type === 'despesa')
        .reduce((sum, t) => sum + t.amount, 0);
      return Number((inc - exp).toFixed(2));
    }

    const accountsSum = computedAccounts.reduce((acc, a) => {
      if (a.type === 'credit') return acc - a.balance;
      return acc + a.balance;
    }, 0);

    // Also include any transactions not linked to a registered account ("Carteira Geral")
    const knownAccountIds = new Set(computedAccounts.map((a) => a.id));
    const knownAccountNames = new Set(
      computedAccounts.map((a) => a.name.trim().toLowerCase())
    );
    const unlinkedNet = transactions
      .filter((t) => {
        if (t.accountId && knownAccountIds.has(t.accountId)) return false;
        if (!t.accountId && knownAccountNames.has(t.account.trim().toLowerCase())) {
          return false;
        }
        return true;
      })
      .reduce((sum, t) => sum + (t.type === 'receita' ? t.amount : -t.amount), 0);

    return Number((accountsSum + unlinkedNet).toFixed(2));
  }, [computedAccounts, transactions]);

  const totalRecordsCount =
    transactions.length + categories.length + accounts.length + goals.length;

  const defaultTxDateForMonth = useMemo(() => {
    const todayIso = getTodayIso();
    if (selectedMonthKey === todayIso.slice(0, 7)) return todayIso;
    return `${selectedMonthKey}-01`;
  }, [selectedMonthKey]);

  const handleSelectMonthByIndex = useCallback(
    (idx: number) => {
      const target = monthsCatalog[idx];
      if (target) {
        setSelectedMonthKey(target.key);
      }
    },
    [monthsCatalog]
  );

  const handlePrevMonth = useCallback(() => {
    const prevIdx = Math.max(0, monthIndex - 1);
    if (monthsCatalog[prevIdx]) {
      setSelectedMonthKey(monthsCatalog[prevIdx].key);
    }
  }, [monthIndex, monthsCatalog]);

  const handleNextMonth = useCallback(() => {
    const nextIdx = Math.min(monthsCatalog.length - 1, monthIndex + 1);
    if (monthsCatalog[nextIdx]) {
      setSelectedMonthKey(monthsCatalog[nextIdx].key);
    }
  }, [monthIndex, monthsCatalog]);

  const handleSelectMonthKey = useCallback((monthKey: string) => {
    setSelectedMonthKey(monthKey);
  }, []);

  // === TRANSACTION CRUD (CONNECTED TO SUPABASE `transactions`) ===

  const handleOpenNewTx = () => {
    setEditingTx(null);
    setTxModalOpen(true);
  };

  const handleOpenEditTx = (tx: Transaction) => {
    setEditingTx(tx);
    setTxModalOpen(true);
  };

  const handleSaveTransaction = async (
    txData: Omit<Transaction, 'id'>,
    existingId?: string
  ): Promise<{ ok: boolean; errorMessage?: string }> => {
    setIsSavingTx(true);
    try {
      if (existingId) {
        const result = await updateTransactionInDb(existingId, txData, categories, accounts);
        setTransactions((prev) =>
          prev.map((item) => (item.id === existingId ? result.transaction : item))
        );
        const txMonthKey = result.transaction.date.slice(0, 7);
        if (txMonthKey && txMonthKey !== selectedMonthKey) {
          setSelectedMonthKey(txMonthKey);
        }
        showToast('Movimentação atualizada com sucesso!', 'success');
      } else {
        const result = await createTransactionInDb(txData, categories, accounts);
        setTransactions((prev) => [result.transaction, ...prev]);

        const txMonthKey = result.transaction.date.slice(0, 7);
        if (txMonthKey && txMonthKey !== selectedMonthKey) {
          setSelectedMonthKey(txMonthKey);
        }

        showToast(
          `${result.transaction.type === 'receita' ? 'Receita' : 'Despesa'} cadastrada com sucesso!`,
          'success'
        );
      }

      setTxModalOpen(false);
      setEditingTx(null);
      void refreshFinanceData(true);
      return { ok: true };
    } catch (err) {
      const errorMessage =
        err instanceof FinanceServiceError
          ? err.messagePT
          : err instanceof Error && err.message
          ? err.message
          : 'Não foi possível salvar a movimentação.';
      await handleServiceError(err, 'Não foi possível salvar a movimentação.');
      return { ok: false, errorMessage };
    } finally {
      setIsSavingTx(false);
    }
  };

  const requestDeleteTransaction = (tx: Transaction) => {
    setConfirmDialog({
      title: 'Excluir movimentação?',
      description: `Deseja remover "${tx.title}" (${
        tx.type === 'receita' ? '+' : '-'
      } R$ ${tx.amount.toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
      })})? Esta operação excluirá o registro na tabela transactions e atualizará o dashboard automaticamente.`,
      confirmLabel: 'Excluir Lançamento',
      tone: 'danger',
      onConfirm: async () => {
        setIsConfirmingAction(true);
        try {
          const deletedIds = await deleteTransactionsInDb([tx.id]);
          const deletedSet = new Set(deletedIds);
          setTransactions((prev) => prev.filter((t) => !deletedSet.has(t.id)));
          if (editingTx && deletedSet.has(editingTx.id)) {
            setTxModalOpen(false);
            setEditingTx(null);
          }
          setConfirmDialog(null);
          void refreshFinanceData(true);
          showToast('Movimentação excluída com sucesso.', 'success');
        } catch (err) {
          setConfirmDialog(null);
          await handleServiceError(err, 'Não foi possível excluir a movimentação.');
        } finally {
          setIsConfirmingAction(false);
        }
      },
    });
  };

  const requestDeleteBatch = (ids: string[]) => {
    if (ids.length === 0) return;
    setConfirmDialog({
      title: `Excluir ${ids.length} lançamentos selecionados?`,
      description:
        'Esta ação removerá permanentemente as movimentações selecionadas no banco de dados e atualizará o dashboard automaticamente.',
      confirmLabel: `Excluir (${ids.length})`,
      tone: 'danger',
      onConfirm: async () => {
        setIsConfirmingAction(true);
        try {
          const deletedIds = await deleteTransactionsInDb(ids);
          const deletedSet = new Set(deletedIds);
          setTransactions((prev) => prev.filter((t) => !deletedSet.has(t.id)));
          setConfirmDialog(null);
          void refreshFinanceData(true);
          showToast(`${deletedIds.length} lançamentos excluídos com sucesso.`, 'success');
        } catch (err) {
          setConfirmDialog(null);
          await handleServiceError(err, 'Não foi possível excluir os lançamentos selecionados.');
        } finally {
          setIsConfirmingAction(false);
        }
      },
    });
  };

  const handleImportTransactions = async (importedRows: Omit<Transaction, 'id'>[]) => {
    if (importedRows.length === 0) return;
    try {
      const createdList: Transaction[] = [];
      let workingCategories = [...categories];
      let workingAccounts = [...accounts];

      for (const row of importedRows) {
        const res = await createTransactionInDb(row, workingCategories, workingAccounts);
        if (res.autoCreatedCategory) {
          workingCategories = [...workingCategories, res.autoCreatedCategory];
        }
        if (res.autoCreatedAccount) {
          workingAccounts = [...workingAccounts, res.autoCreatedAccount];
        }
        createdList.push(res.transaction);
      }

      setCategories(workingCategories);
      setAccounts(workingAccounts);
      setTransactions((prev) => [...createdList, ...prev]);
      void refreshFinanceData(true);
      showToast(`${createdList.length} movimentações importadas com sucesso!`, 'success');
    } catch (err) {
      await handleServiceError(err, 'Erro ao importar movimentações do arquivo CSV.');
    }
  };

  const handleMarkBatchPaid = async (ids: string[]) => {
    if (ids.length === 0) return;
    try {
      const targets = transactions.filter((t) => ids.includes(t.id));
      const updatedMap = new Map<string, Transaction>();
      for (const tx of targets) {
        const { id, ...rest } = tx;
        const res = await updateTransactionInDb(
          id,
          { ...rest, status: 'conciliado' },
          categories,
          accounts
        );
        updatedMap.set(id, res.transaction);
      }
      setTransactions((prev) => prev.map((t) => updatedMap.get(t.id) || t));
      void refreshFinanceData(true);
      showToast(`${ids.length} lançamentos marcados como pagos e conciliados!`, 'success');
    } catch (err) {
      await handleServiceError(err, 'Não foi possível atualizar o status dos lançamentos.');
    }
  };

  const handleChangeBatchCategory = async (ids: string[], category: string) => {
    if (ids.length === 0) return;
    try {
      const isClearing = category.trim().toLowerCase() === 'sem categoria';
      const matchedCat = isClearing
        ? undefined
        : categories.find((c) => c.name.trim().toLowerCase() === category.trim().toLowerCase());
      const targets = transactions.filter((t) => ids.includes(t.id));
      const updatedMap = new Map<string, Transaction>();

      for (const tx of targets) {
        const { id, ...rest } = tx;
        const res = await updateTransactionInDb(
          id,
          {
            ...rest,
            category: isClearing ? 'Sem categoria' : matchedCat?.name || category,
            categoryId: isClearing ? undefined : matchedCat?.id,
          },
          categories,
          accounts
        );
        updatedMap.set(id, res.transaction);
      }
      setTransactions((prev) => prev.map((t) => updatedMap.get(t.id) || t));
      void refreshFinanceData(true);
      showToast(
        isClearing
          ? `Vínculo de categoria removido em ${ids.length} itens.`
          : `Categoria alterada para "${category}" em ${ids.length} itens.`,
        'success'
      );
    } catch (err) {
      await handleServiceError(err, 'Não foi possível atualizar a categoria dos lançamentos.');
    }
  };

  // === CATEGORY CRUD (CONNECTED TO SUPABASE `categories`) ===

  const handleSaveCategory = async (
    catData: Omit<Category, 'id'>,
    existingId?: string
  ): Promise<SaveCategoryResult> => {
    try {
      if (existingId) {
        const updated = await updateCategoryInDb(existingId, catData);
        setCategories((prev) =>
          prev
            .map((c) => (c.id === existingId ? updated : c))
            .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
        );
        // Update displayed category name & icon on linked transactions in memory
        setTransactions((prev) =>
          prev.map((tx) =>
            tx.categoryId === existingId
              ? { ...tx, category: updated.name, icon: updated.icon }
              : tx
          )
        );
        void refreshFinanceData(true);
        showToast('Categoria atualizada com sucesso!', 'success');
      } else {
        const created = await createCategoryInDb(catData);
        setCategories((prev) =>
          [...prev, created].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
        );
        void refreshFinanceData(true);
        showToast('Nova categoria salva no banco de dados!', 'success');
      }
      return { ok: true };
    } catch (err) {
      await handleServiceError(err, 'Não foi possível salvar a categoria.');
      const errorMessage =
        err instanceof FinanceServiceError
          ? err.messagePT
          : 'Não foi possível salvar a categoria.';
      return { ok: false, errorMessage };
    }
  };

  const requestDeleteCategory = (cat: Category) => {
    setConfirmDialog({
      title: `Excluir categoria "${cat.name}"?`,
      description:
        'A categoria será removida permanentemente da tabela categories no Supabase. Os lançamentos existentes continuarão preservados no seu extrato.',
      confirmLabel: 'Excluir Categoria',
      tone: 'danger',
      onConfirm: async () => {
        setIsConfirmingAction(true);
        try {
          await deleteCategoryInDb(cat.id);
          setCategories((prev) => prev.filter((c) => c.id !== cat.id));
          setTransactions((prev) =>
            prev.map((tx) =>
              tx.categoryId === cat.id
                ? { ...tx, categoryId: undefined, category: 'Sem categoria' }
                : tx
            )
          );
          setConfirmDialog(null);
          void refreshFinanceData(true);
          showToast('Categoria excluída com sucesso.', 'success');
        } catch (err) {
          setConfirmDialog(null);
          await handleServiceError(err, 'Não foi possível excluir a categoria.');
        } finally {
          setIsConfirmingAction(false);
        }
      },
    });
  };

  // === ACCOUNT CRUD (CONNECTED TO SUPABASE `accounts`) ===

  const handleSaveAccount = async (
    accData: Omit<AccountItem, 'id'>,
    existingId?: string
  ): Promise<SaveAccountResult> => {
    try {
      if (existingId) {
        const updated = await updateAccountInDb(existingId, accData);
        setAccounts((prev) => prev.map((a) => (a.id === existingId ? updated : a)));
        setTransactions((prev) =>
          prev.map((tx) =>
            tx.accountId === existingId
              ? {
                  ...tx,
                  account: updated.name,
                  accountIcon: updated.type === 'credit' ? 'credit_card' : 'account_balance',
                }
              : tx
          )
        );
        void refreshFinanceData(true);
        showToast('Dados da conta atualizados com sucesso!', 'success');
      } else {
        const created = await createAccountInDb(accData);
        setAccounts((prev) => [...prev, created]);
        void refreshFinanceData(true);
        showToast('Nova conta cadastrada com sucesso!', 'success');
      }
      return { ok: true };
    } catch (err) {
      await handleServiceError(err, 'Não foi possível salvar os dados da conta.');
      const errorMessage =
        err instanceof FinanceServiceError
          ? err.messagePT
          : 'Não foi possível salvar os dados da conta.';
      return { ok: false, errorMessage };
    }
  };

  const requestDeleteAccount = (acc: AccountItem) => {
    const linkedCount = transactions.filter((t) => {
      if (t.accountId && acc.id) return t.accountId === acc.id;
      if (t.accountId) return false;
      const norm = (t.account || '').trim().toLowerCase();
      if (!norm || norm === 'sem conta') return false;
      return norm === acc.name.trim().toLowerCase();
    }).length;

    const description =
      linkedCount > 0
        ? `Esta conta possui ${linkedCount} ${
            linkedCount === 1 ? 'movimentação vinculada' : 'movimentações vinculadas'
          }. A conta será removida da tabela accounts no Supabase, mas todas as suas movimentações serão preservadas intactas no seu extrato (sem vínculo de conta).`
        : 'A conta será removida permanentemente da tabela accounts no Supabase.';

    setConfirmDialog({
      title: `Excluir conta "${acc.name}"?`,
      description,
      confirmLabel: 'Excluir Conta',
      tone: 'danger',
      onConfirm: async () => {
        setIsConfirmingAction(true);
        try {
          const { unlinkedTransactionsCount } = await deleteAccountInDb(acc.id);
          setAccounts((prev) => prev.filter((a) => a.id !== acc.id));
          setTransactions((prev) =>
            prev.map((tx) =>
              tx.accountId === acc.id ||
              (!tx.accountId && tx.account.trim().toLowerCase() === acc.name.trim().toLowerCase())
                ? { ...tx, accountId: undefined, account: 'Sem conta' }
                : tx
            )
          );
          setConfirmDialog(null);
          void refreshFinanceData(true);
          showToast(
            unlinkedTransactionsCount > 0
              ? `Conta excluída com sucesso. ${unlinkedTransactionsCount} ${
                  unlinkedTransactionsCount === 1
                    ? 'movimentação foi preservada'
                    : 'movimentações foram preservadas'
                } no extrato.`
              : 'Conta excluída com sucesso.',
            'success'
          );
        } catch (err) {
          setConfirmDialog(null);
          await handleServiceError(err, 'Não foi possível excluir a conta.');
        } finally {
          setIsConfirmingAction(false);
        }
      },
    });
  };

  const handleUpdateAccountInitialBalance = async (
    id: string,
    newInitialBalance: number
  ): Promise<SaveAccountResult> => {
    const target = accounts.find((a) => a.id === id);
    if (!target) {
      return { ok: false, errorMessage: 'Conta não encontrada.' };
    }
    try {
      const { id: accId, ...rest } = target;
      const saved = await updateAccountInDb(accId, {
        ...rest,
        initialBalance: newInitialBalance,
        balance: newInitialBalance,
      });
      setAccounts((prev) => prev.map((a) => (a.id === accId ? saved : a)));
      void refreshFinanceData(true);
      showToast('Saldo inicial da conta atualizado com sucesso!', 'success');
      return { ok: true };
    } catch (err) {
      await handleServiceError(err, 'Não foi possível atualizar o saldo inicial da conta.');
      const errorMessage =
        err instanceof FinanceServiceError
          ? err.messagePT
          : 'Não foi possível atualizar o saldo inicial da conta.';
      return { ok: false, errorMessage };
    }
  };

  // === GOAL CRUD (CONNECTED TO SUPABASE `goals`) ===

  const handleSaveGoal = async (
    goalData: Omit<GoalItem, 'id'>,
    existingId?: string
  ): Promise<SaveGoalResult> => {
    try {
      if (existingId) {
        const updated = await updateGoalInDb(existingId, goalData);
        setGoals((prev) => prev.map((g) => (g.id === existingId ? updated : g)));
        void refreshFinanceData(true);
        showToast('Meta atualizada com sucesso!', 'success');
      } else {
        const created = await createGoalInDb(goalData);
        setGoals((prev) => [created, ...prev]);
        void refreshFinanceData(true);
        showToast('Nova meta cadastrada no banco de dados!', 'success');
      }
      return { ok: true };
    } catch (err) {
      await handleServiceError(err, 'Não foi possível salvar a meta.');
      const errorMessage =
        err instanceof FinanceServiceError
          ? err.messagePT
          : 'Não foi possível salvar a meta.';
      return { ok: false, errorMessage };
    }
  };

  const handleUpdateGoalProgress = async (
    id: string,
    newCurrentAmount: number,
    accountDebit?: {
      amount: number;
      sourceAccountId: string;
      dateIso: string;
    }
  ): Promise<SaveGoalResult> => {
    const targetGoal = goals.find((g) => g.id === id);
    if (!targetGoal) {
      return { ok: false, errorMessage: 'Meta não encontrada.' };
    }

    try {
      const done = newCurrentAmount >= targetGoal.targetAmount;
      const savedGoal = await updateGoalProgressInDb(
        id,
        newCurrentAmount,
        done ? `Concluído em ${selectedMonth}` : undefined
      );

      setGoals((prev) => prev.map((g) => (g.id === id ? savedGoal : g)));

      if (accountDebit && accountDebit.sourceAccountId && accountDebit.amount > 0) {
        const sourceAcc = accounts.find((a) => a.id === accountDebit.sourceAccountId);
        if (sourceAcc) {
          const iso = accountDebit.dateIso || defaultTxDateForMonth;
          const res = await createTransactionInDb(
            {
              title: `Aporte Meta: ${targetGoal.name}`,
              subtitle: `Reserva direcionada · ${sourceAcc.name}`,
              category: 'Metas & Reservas',
              subcategory: 'Aporte Meta',
              account: sourceAcc.name,
              accountId: sourceAcc.id,
              accountIcon: 'savings',
              type: 'despesa',
              amount: accountDebit.amount,
              date: iso,
              dateLabel: formatDateLabelPT(iso),
              dateGroup: formatDateGroupPT(iso),
              time: '12:00',
              method: 'Transferência Meta',
              icon: 'savings',
              status: 'conciliado',
              notes: `Aporte para a meta "${targetGoal.name}"`,
            },
            categories,
            accounts
          );
          if (res.autoCreatedCategory) {
            setCategories((prev) =>
              prev.some((c) => c.id === res.autoCreatedCategory!.id)
                ? prev
                : [...prev, res.autoCreatedCategory!]
            );
          }
          setTransactions((prev) => [res.transaction, ...prev]);
        }
      }

      void refreshFinanceData(true);
      showToast(
        `Progresso atualizado para R$ ${savedGoal.currentAmount.toLocaleString('pt-BR', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}!`,
        'success'
      );
      return { ok: true };
    } catch (err) {
      await handleServiceError(err, 'Não foi possível atualizar o progresso da meta.');
      const errorMessage =
        err instanceof FinanceServiceError
          ? err.messagePT
          : 'Não foi possível atualizar o progresso da meta.';
      return { ok: false, errorMessage };
    }
  };

  const handleTogglePauseGoal = async (id: string) => {
    const target = goals.find((g) => g.id === id);
    if (!target) return;
    try {
      const { id: goalId, ...rest } = target;
      const saved = await updateGoalInDb(goalId, {
        ...rest,
        status: target.status === 'paused' ? 'active' : 'paused',
      });
      setGoals((prev) => prev.map((g) => (g.id === goalId ? saved : g)));
      void refreshFinanceData(true);
      showToast('Status da meta atualizado com sucesso.', 'success');
    } catch (err) {
      await handleServiceError(err, 'Não foi possível atualizar o status da meta.');
    }
  };

  const requestDeleteGoal = (goal: GoalItem) => {
    setConfirmDialog({
      title: `Excluir meta "${goal.name}"?`,
      description: `Esta meta (acumulado R$ ${goal.currentAmount.toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
      })} de R$ ${goal.targetAmount.toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
      })}) será removida permanentemente da tabela goals no Supabase.`,
      confirmLabel: 'Excluir Meta',
      tone: 'danger',
      onConfirm: async () => {
        setIsConfirmingAction(true);
        try {
          await deleteGoalInDb(goal.id);
          setGoals((prev) => prev.filter((g) => g.id !== goal.id));
          setConfirmDialog(null);
          void refreshFinanceData(true);
          showToast('Meta excluída com sucesso.', 'success');
        } catch (err) {
          setConfirmDialog(null);
          await handleServiceError(err, 'Não foi possível excluir a meta.');
        } finally {
          setIsConfirmingAction(false);
        }
      },
    });
  };

  // === PROFILE UPDATE (CONNECTED TO SUPABASE `profiles` + AUTH METADATA) ===

  const handleUpdateProfile = async (nextProfile: UserProfile): Promise<SaveProfileResult> => {
    const currentUser = userRef.current;
    if (!currentUser) {
      const msg = 'Sua sessão expirou. Faça login novamente para salvar seu perfil.';
      showToast(msg, 'error');
      return { ok: false, messagePT: msg };
    }
    try {
      const saved = await updateProfileInDb(nextProfile, currentUser);
      setUserProfile(saved);
      const successMsg = 'Perfil atualizado com sucesso no Supabase!';
      showToast(successMsg, 'success');
      return { ok: true, profile: saved, messagePT: successMsg };
    } catch (err) {
      const errorMsg =
        err instanceof FinanceServiceError
          ? err.messagePT
          : err instanceof Error && err.message
          ? err.message
          : 'Não foi possível salvar as alterações do perfil.';
      await handleServiceError(err, 'Não foi possível salvar as alterações do perfil.');
      return { ok: false, messagePT: errorMsg };
    }
  };

  const handleRefreshProfile = async () => {
    const currentUser = userRef.current;
    if (!currentUser) return;
    try {
      const refreshed = await fetchUserProfileFromDb(currentUser);
      setUserProfile(refreshed);
      showToast('Dados do perfil sincronizados com o Supabase!', 'success');
    } catch (err) {
      await handleServiceError(err, 'Não foi possível sincronizar os dados do perfil.');
    }
  };

  const handleSignOutRequest = async () => {
    setActiveScreen('dashboard');
    await signOut();
  };

  // Export Helpers
  const triggerFileDownload = (filename: string, content: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleExportTransactionsCsv = (rowsToExport?: Transaction[]) => {
    const list = rowsToExport || transactions;
    const header = 'Data,Horario,Descricao,Categoria,Conta,Tipo,Valor\n';
    const rows = list
      .map(
        (t) =>
          `"${t.date}","${t.time}","${t.title.replace(/"/g, '""')}","${t.category}","${t.account}","${t.type}","${t.amount.toFixed(2)}"`
      )
      .join('\n');
    triggerFileDownload(
      `financerto-movimentacoes-${selectedMonthKey}.csv`,
      header + rows,
      'text/csv;charset=utf-8;'
    );
    showToast(`Extrato CSV exportado (${list.length} itens)!`, 'success');
  };

  const handleNavigate = (screen: ScreenId) => {
    setActiveScreen(screen);
    if (screen !== 'movimentacoes' && forceMobilePreview) {
      setForceMobilePreview(false);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleViewAccountStatement = (accountName: string) => {
    setPendingAccountFilter(accountName);
    handleNavigate('movimentacoes');
  };

  // === AUTHENTICATION GUARD (PROTECTS ALL FINANCIAL SCREENS) ===

  if (authLoading) {
    return (
      <div className="min-h-screen bg-surface flex flex-col items-center justify-center p-6 text-center">
        <div className="bg-surface-container-lowest rounded-2xl p-8 shadow-sm border border-surface-container max-w-sm w-full flex flex-col items-center space-y-4">
          <BrandLogo />
          <div className="flex items-center gap-2 text-primary font-semibold text-sm">
            <Icon name="progress_activity" className="text-xl animate-spin" />
            <span>Verificando sua sessão segura...</span>
          </div>
          <p className="text-xs text-secondary">
            Conectando com o serviço de autenticação FinanCerto.
          </p>
        </div>
      </div>
    );
  }

  if (!user || isPasswordRecovery) {
    return <AuthView />;
  }

  return (
    <div
      className={`min-h-screen bg-background text-on-surface ${
        forceMobilePreview ? 'bg-surface-container py-0' : ''
      }`}
    >
      <Sidebar
        activeScreen={activeScreen}
        onNavigate={handleNavigate}
        onOpenNewTransaction={handleOpenNewTx}
        onSignOut={handleSignOutRequest}
        forceMobilePreview={forceMobilePreview}
        dataSourceMode={dataSourceMode}
        totalRecordsCount={totalRecordsCount}
        userProfile={userProfile}
      />

      <div
        className={
          forceMobilePreview
            ? 'max-w-[430px] mx-auto bg-surface min-h-screen shadow-2xl'
            : 'lg:pl-64'
        }
      >
        <Header
          activeScreen={activeScreen}
          availableMonths={availableMonths}
          selectedMonth={selectedMonth}
          onSelectMonthByIndex={handleSelectMonthByIndex}
          onPrevMonth={handlePrevMonth}
          onNextMonth={handleNextMonth}
          onResetCurrentMonth={() => {
            const currentKey = getCurrentMonthKey();
            setSelectedMonthKey(currentKey);
            showToast(
              `Período redefinido para ${getMonthLabelFromKey(currentKey)}.`,
              'success'
            );
          }}
          onOpenNewTransaction={handleOpenNewTx}
          onNavigate={handleNavigate}
          onSignOut={handleSignOutRequest}
          userProfile={userProfile}
          notifications={notifications}
          onMarkAllRead={() => {
            setReadNotifIds(notifications.map((n) => n.id));
            showToast('Todas as notificações foram marcadas como lidas.', 'success');
          }}
          forceMobilePreview={forceMobilePreview}
          onToggleMobilePreview={() => setForceMobilePreview((v) => !v)}
        />

        <main
          className={`w-full pt-20 pb-24 lg:pb-10 ${
            forceMobilePreview ? 'px-4 pb-24' : 'px-4 sm:px-gutter'
          } min-h-screen`}
        >
          {/* Connection error banner with retry button */}
          {loadError && (
            <div className="mb-space-md bg-error-container/60 text-on-error-container rounded-xl p-space-md flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
              <div className="flex items-start gap-2.5 text-xs sm:text-sm">
                <Icon name="cloud_off" className="text-xl shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">Falha ao sincronizar com o banco de dados</p>
                  <p className="opacity-90">{loadError}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void refreshFinanceData()}
                className="self-start sm:self-center px-4 py-2 rounded-xl bg-surface-container-lowest text-on-surface text-xs font-bold hover:bg-surface-container transition-colors inline-flex items-center gap-1.5 cursor-pointer shrink-0"
              >
                <Icon name="refresh" className="text-base text-primary" />
                <span>Tentar novamente</span>
              </button>
            </div>
          )}

          {activeScreen === 'dashboard' && (
            <DashboardView
              transactions={transactions}
              categories={computedCategories}
              goals={goals}
              accounts={computedAccounts}
              availableMonthKeys={availableMonthKeys}
              selectedMonth={selectedMonth}
              selectedMonthKey={selectedMonthKey}
              totalConsolidatedBalance={totalConsolidatedBalance}
              isLoading={isLoadingData}
              onRefresh={() => void refreshFinanceData()}
              onNavigate={handleNavigate}
              onSelectMonthKey={handleSelectMonthKey}
              onOpenNewTransaction={handleOpenNewTx}
              onEditTransaction={handleOpenEditTx}
              onDeleteTransaction={requestDeleteTransaction}
              onExportCsv={() => handleExportTransactionsCsv()}
            />
          )}

          {activeScreen === 'movimentacoes' && (
            <MovimentacoesView
              transactions={transactions}
              categories={computedCategories}
              accounts={computedAccounts}
              availableMonthKeys={availableMonthKeys}
              selectedMonth={selectedMonth}
              selectedMonthKey={selectedMonthKey}
              isLoading={isLoadingData}
              onRefresh={() => void refreshFinanceData()}
              initialAccountFilter={pendingAccountFilter}
              onClearInitialAccountFilter={() => setPendingAccountFilter(undefined)}
              onSelectMonthKey={handleSelectMonthKey}
              onPrevMonth={handlePrevMonth}
              onNextMonth={handleNextMonth}
              onOpenNewTransaction={handleOpenNewTx}
              onEditTransaction={handleOpenEditTx}
              onDeleteTransaction={requestDeleteTransaction}
              onDeleteBatch={requestDeleteBatch}
              onMarkBatchPaid={handleMarkBatchPaid}
              onChangeBatchCategory={handleChangeBatchCategory}
              onExportCsv={handleExportTransactionsCsv}
              forceMobilePreview={forceMobilePreview}
            />
          )}

          {activeScreen === 'categorias' && (
            <CategoriasView
              categories={computedCategories}
              transactions={transactions}
              selectedMonth={selectedMonth}
              dataSourceMode={dataSourceMode}
              isLoading={isLoadingData}
              onRefresh={() => void refreshFinanceData()}
              onSaveCategory={handleSaveCategory}
              onDeleteCategory={requestDeleteCategory}
              onNotify={(msg) => showToast(msg, 'success')}
            />
          )}

          {activeScreen === 'contas' && (
            <ContasView
              accounts={computedAccounts}
              transactions={transactions}
              selectedMonthKey={selectedMonthKey}
              dataSourceMode={dataSourceMode}
              isLoading={isLoadingData}
              onRefresh={() => refreshFinanceData()}
              onSaveAccount={handleSaveAccount}
              onDeleteAccount={requestDeleteAccount}
              onUpdateAccountBalance={handleUpdateAccountInitialBalance}
              onImportTransactions={handleImportTransactions}
              onViewAccountStatement={handleViewAccountStatement}
              onNavigate={handleNavigate}
              onNotify={(msg) => showToast(msg, 'success')}
            />
          )}

          {activeScreen === 'metas' && (
            <MetasView
              goals={goals}
              accounts={computedAccounts}
              transactions={transactions}
              availableMonthKeys={availableMonthKeys}
              selectedMonth={selectedMonth}
              selectedMonthKey={selectedMonthKey}
              isLoading={isLoadingData}
              onRefresh={() => refreshFinanceData()}
              onSaveGoal={handleSaveGoal}
              onUpdateGoalProgress={handleUpdateGoalProgress}
              onTogglePauseGoal={handleTogglePauseGoal}
              onDeleteGoal={requestDeleteGoal}
              onNotify={(msg) => showToast(msg, 'success')}
            />
          )}

          {activeScreen === 'relatorios' && (
            <RelatoriosView
              transactions={transactions}
              categories={computedCategories}
              accounts={computedAccounts}
              goals={goals}
              availableMonthKeys={availableMonthKeys}
              selectedMonthKey={selectedMonthKey}
              isLoading={isLoadingData}
              onRefresh={() => refreshFinanceData()}
              onSelectMonthKey={handleSelectMonthKey}
              onOpenNewTransaction={handleOpenNewTx}
              onNavigate={handleNavigate}
              onExportCsv={handleExportTransactionsCsv}
              onNotify={(msg) => showToast(msg, 'success')}
            />
          )}

          {activeScreen === 'configuracoes' && (
            <ConfiguracoesView
              userProfile={userProfile}
              accounts={computedAccounts}
              dataSourceMode={dataSourceMode}
              isLoading={isLoadingData}
              onUpdateProfile={handleUpdateProfile}
              onRefreshProfile={handleRefreshProfile}
              onExportCsv={() => handleExportTransactionsCsv()}
              onSignOut={handleSignOutRequest}
              onNavigate={handleNavigate}
              onNotify={showToast}
            />
          )}
        </main>
      </div>

      {/* Global Nova / Editar Movimentação Modal or Mobile Bottom Sheet */}
      <TransactionModal
        isOpen={txModalOpen}
        editingTransaction={editingTx}
        isSubmitting={isSavingTx}
        onClose={() => {
          setTxModalOpen(false);
          setEditingTx(null);
        }}
        onSave={handleSaveTransaction}
        onRequestDelete={requestDeleteTransaction}
        categoriesList={computedCategories}
        accountsList={computedAccounts}
        defaultDate={defaultTxDateForMonth}
        isMobileSheet={isMobileViewport || forceMobilePreview}
      />

      {/* Safe Confirmation Dialog */}
      <ConfirmDialog
        isOpen={Boolean(confirmDialog)}
        title={confirmDialog?.title || ''}
        description={confirmDialog?.description || ''}
        confirmLabel={confirmDialog?.confirmLabel}
        tone={confirmDialog?.tone}
        isLoading={isConfirmingAction}
        onConfirm={() => {
          void confirmDialog?.onConfirm();
        }}
        onCancel={() => {
          if (!isConfirmingAction) setConfirmDialog(null);
        }}
      />

      {/* Global Toast Notification (Portuguese success & error feedback) */}
      <div
        role="status"
        aria-live="polite"
        className={`fixed bottom-20 lg:bottom-6 right-6 max-w-md px-space-md py-3 rounded-xl shadow-2xl flex items-center gap-2.5 transition-all duration-200 z-50 ${
          toast?.tone === 'error'
            ? 'bg-error text-on-error'
            : 'bg-inverse-surface text-inverse-on-surface'
        } ${
          toast
            ? 'translate-y-0 opacity-100'
            : 'translate-y-8 opacity-0 pointer-events-none'
        }`}
      >
        <Icon
          name={toast?.tone === 'error' ? 'error' : 'check_circle'}
          className={`text-xl shrink-0 ${
            toast?.tone === 'error' ? 'text-on-error' : 'text-primary-fixed'
          }`}
        />
        <span className="text-sm font-semibold">{toast?.message}</span>
      </div>
    </div>
  );
}
