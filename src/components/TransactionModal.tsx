import React, { useState, useEffect, useMemo } from 'react';
import {
  formatDateGroupPT,
  formatDateLabelPT,
  getTodayIso,
} from '../data/initialData';
import {
  AccountItem,
  Category,
  Transaction,
  TransactionStatus,
  TransactionType,
} from '../types/finance';
import { parsePositiveBrlAmount } from '../services/financeService';
import { Icon } from './Icon';

interface TransactionModalProps {
  isOpen: boolean;
  editingTransaction: Transaction | null;
  isSubmitting?: boolean;
  onClose: () => void;
  onSave: (
    txData: Omit<Transaction, 'id'>,
    existingId?: string
  ) => Promise<{ ok: boolean; errorMessage?: string }>;
  onRequestDelete?: (tx: Transaction) => void;
  categoriesList: Category[];
  accountsList: AccountItem[];
  defaultDate?: string;
  isMobileSheet?: boolean;
}

const PAYMENT_METHODS = [
  'Pix',
  'Cartão Crédito',
  'Débito',
  'Boleto DDA',
  'TED',
  'Débito Automático',
  'Proventos',
  'Dinheiro',
];

export const TransactionModal: React.FC<TransactionModalProps> = ({
  isOpen,
  editingTransaction,
  isSubmitting = false,
  onClose,
  onSave,
  onRequestDelete,
  categoriesList,
  accountsList,
  defaultDate = getTodayIso(),
  isMobileSheet = false,
}) => {
  const [type, setType] = useState<TransactionType>('despesa');
  const [amountInput, setAmountInput] = useState('');
  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [subcategory, setSubcategory] = useState('');
  const [accountId, setAccountId] = useState('');
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState('14:30');
  const [method, setMethod] = useState('Pix');
  const [status, setStatus] = useState<TransactionStatus>('efetivado');
  const [recurring, setRecurring] = useState(false);
  const [tags, setTags] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const filteredCategories = useMemo(
    () => categoriesList.filter((c) => c.type === type),
    [categoriesList, type]
  );

  const selectedCategoryObj = useMemo(
    () => categoriesList.find((c) => c.id === categoryId),
    [categoriesList, categoryId]
  );

  useEffect(() => {
    if (!isOpen) return;
    setErrorMsg(null);

    if (editingTransaction) {
      setType(editingTransaction.type);
      setAmountInput(
        editingTransaction.amount.toLocaleString('pt-BR', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      );
      setTitle(editingTransaction.title);
      const matchedCat = categoriesList.find(
        (c) =>
          (editingTransaction.categoryId && c.id === editingTransaction.categoryId) ||
          c.name.toLowerCase() === editingTransaction.category.toLowerCase()
      );
      setCategoryId(matchedCat?.id || '');
      setSubcategory(editingTransaction.subcategory || '');
      const matchedAcc = accountsList.find(
        (a) =>
          (editingTransaction.accountId && a.id === editingTransaction.accountId) ||
          a.name.toLowerCase() === editingTransaction.account.toLowerCase()
      );
      setAccountId(matchedAcc?.id || '');
      setDate(editingTransaction.date);
      setTime(editingTransaction.time || '14:30');
      setMethod(editingTransaction.method || 'Pix');
      setStatus(editingTransaction.status || 'efetivado');
      setRecurring(Boolean(editingTransaction.recurring));
      setTags(editingTransaction.notes ?? editingTransaction.tags ?? '');
    } else {
      const initialType: TransactionType = 'despesa';
      const defaultCat = categoriesList.find((c) => c.type === initialType);
      const defaultAcc = accountsList[0];

      setType(initialType);
      setAmountInput('');
      setTitle('');
      setCategoryId(defaultCat?.id || '');
      setSubcategory(defaultCat?.subcategories[0]?.name || '');
      setAccountId(defaultAcc?.id || '');
      setDate(defaultDate);
      const now = new Date();
      setTime(
        `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
      );
      setMethod(defaultAcc?.type === 'credit' ? 'Cartão Crédito' : 'Pix');
      setStatus('efetivado');
      setRecurring(false);
      setTags('');
    }
  }, [editingTransaction, isOpen, categoriesList, accountsList, defaultDate]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen) return null;

  const handleTypeChange = (nextType: TransactionType) => {
    setType(nextType);
    const matchingCats = categoriesList.filter((c) => c.type === nextType);
    if (categoryId && !matchingCats.some((c) => c.id === categoryId)) {
      const firstMatch = matchingCats[0];
      setCategoryId(firstMatch?.id || '');
      setSubcategory(firstMatch?.subcategories[0]?.name || '');
    }
    if (nextType === 'receita' && method === 'Cartão Crédito') {
      setMethod('Pix');
    }
  };

  const handleCategoryChange = (nextCatId: string) => {
    setCategoryId(nextCatId);
    const catObj = categoriesList.find((c) => c.id === nextCatId);
    setSubcategory(catObj?.subcategories[0]?.name || '');
  };

  const handleAccountChange = (nextAccId: string) => {
    setAccountId(nextAccId);
    const acc = accountsList.find((a) => a.id === nextAccId);
    if (acc?.type === 'credit' && type === 'despesa') {
      setMethod('Cartão Crédito');
    }
  };

  const parseAmount = (raw: string): number => parsePositiveBrlAmount(raw);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    if (amountInput.trim().startsWith('-')) {
      setErrorMsg('O valor da movimentação deve ser positivo (maior que R$ 0,00).');
      return;
    }

    const numericAmount = parseAmount(amountInput);

    if (!title.trim()) {
      setErrorMsg('Informe uma descrição para a movimentação.');
      return;
    }
    if (numericAmount <= 0) {
      setErrorMsg('Informe um valor positivo maior que R$ 0,00.');
      return;
    }
    if (!date) {
      setErrorMsg('Informe a data da movimentação.');
      return;
    }

    const chosenAcc = accountId ? accountsList.find((a) => a.id === accountId) : undefined;
    const accName = chosenAcc?.name || 'Sem conta';
    const chosenCat = categoryId ? categoriesList.find((c) => c.id === categoryId) : undefined;
    const catName = chosenCat?.name || 'Sem categoria';
    const catIcon =
      chosenCat?.icon || (type === 'receita' ? 'payments' : 'storefront');
    const accIcon =
      chosenAcc?.type === 'credit'
        ? 'credit_card'
        : chosenAcc?.type === 'investment'
        ? 'trending_up'
        : chosenAcc?.type === 'business'
        ? 'hub'
        : 'account_balance';

    setErrorMsg(null);

    const notesClean = tags.trim() || undefined;
    const subtitleParts = [
      notesClean || subcategory || (type === 'receita' ? 'Receita' : 'Despesa'),
      ...(chosenAcc ? [accName] : []),
    ];

    const result = await onSave(
      {
        title: title.trim(),
        subtitle: subtitleParts.join(' · '),
        category: catName,
        categoryId: chosenCat?.id,
        subcategory: subcategory || undefined,
        account: accName,
        accountId: chosenAcc?.id,
        accountIcon: accIcon,
        type,
        amount: numericAmount,
        date,
        dateLabel: formatDateLabelPT(date),
        dateGroup: formatDateGroupPT(date),
        time,
        method,
        icon: catIcon,
        status,
        recurring,
        tags: notesClean,
        notes: notesClean,
      },
      editingTransaction?.id
    );

    if (!result.ok) {
      setErrorMsg(
        result.errorMessage ||
          'Não foi possível salvar a movimentação no Supabase. Verifique sua sessão e tente novamente.'
      );
    }
  };

  // Mobile Quick-Entry Bottom Sheet
  if (isMobileSheet) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-end justify-center bg-inverse-surface/40 backdrop-blur-xs"
        onClick={() => !isSubmitting && onClose()}
      >
        <form
          onSubmit={handleSubmit}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-lg bg-surface-container-lowest rounded-t-3xl p-space-lg shadow-2xl flex flex-col gap-3.5 max-h-[92dvh] overflow-y-auto"
        >
          <div className="w-12 h-1.5 bg-outline-variant rounded-full mx-auto -mt-1 shrink-0" />
          <div className="flex items-center justify-between">
            <h2 className="text-xl text-on-surface font-bold">
              {editingTransaction ? 'Editar Movimentação' : 'Lançar Movimentação'}
            </h2>
            <button
              type="button"
              disabled={isSubmitting}
              onClick={onClose}
              aria-label="Fechar painel"
              className="w-8 h-8 rounded-full bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-on-surface cursor-pointer disabled:opacity-50"
            >
              <Icon name="close" className="text-[20px]" />
            </button>
          </div>

          {errorMsg && (
            <div className="p-2.5 rounded-xl bg-error-container text-on-error-container text-xs font-semibold flex items-center gap-2">
              <Icon name="error" className="text-base text-error" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Type Switcher */}
          <div className="grid grid-cols-2 p-1 bg-surface-container rounded-xl gap-1">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => handleTypeChange('despesa')}
              className={`py-2 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-1 cursor-pointer ${
                type === 'despesa'
                  ? 'bg-surface-container-lowest text-error shadow-xs'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <Icon name="arrow_outward" className="text-[18px]" />
              Despesa
            </button>
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => handleTypeChange('receita')}
              className={`py-2 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-1 cursor-pointer ${
                type === 'receita'
                  ? 'bg-surface-container-lowest text-primary shadow-xs'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <Icon name="arrow_downward" className="text-[18px]" />
              Receita
            </button>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-on-surface-variant">Valor (R$)</label>
            <div className="flex items-center gap-2 bg-surface-container-low rounded-xl px-space-md py-2.5">
              <span className="text-lg text-on-surface-variant font-bold">R$</span>
              <input
                type="text"
                inputMode="decimal"
                disabled={isSubmitting}
                value={amountInput}
                onChange={(e) => {
                  setAmountInput(e.target.value);
                  if (errorMsg) setErrorMsg(null);
                }}
                placeholder="0,00"
                className={`w-full bg-transparent text-2xl font-bold focus:outline-none tabular-nums ${
                  type === 'despesa' ? 'text-error' : 'text-primary'
                }`}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-on-surface-variant">Descrição *</label>
            <input
              type="text"
              disabled={isSubmitting}
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (errorMsg) setErrorMsg(null);
              }}
              placeholder="Ex: Supermercado, Salário, Farmácia..."
              className="bg-surface-container-low rounded-xl px-3 py-2.5 text-sm text-on-surface focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-on-surface-variant">
                Categoria (Opcional)
              </label>
              <select
                disabled={isSubmitting}
                value={categoryId}
                onChange={(e) => handleCategoryChange(e.target.value)}
                className="bg-surface-container-low rounded-xl px-3 py-2.5 text-sm text-on-surface focus:outline-none"
              >
                <option value="">Sem categoria</option>
                {filteredCategories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-on-surface-variant">
                Conta (Opcional)
              </label>
              <select
                disabled={isSubmitting}
                value={accountId}
                onChange={(e) => handleAccountChange(e.target.value)}
                className="bg-surface-container-low rounded-xl px-3 py-2.5 text-sm text-on-surface focus:outline-none"
              >
                <option value="">Sem conta vinculada</option>
                {accountsList.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-on-surface-variant">Data</label>
              <input
                type="date"
                disabled={isSubmitting}
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="bg-surface-container-low rounded-xl px-3 py-2 text-sm text-on-surface tabular-nums focus:outline-none"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-on-surface-variant">Situação</label>
              <select
                disabled={isSubmitting}
                value={status}
                onChange={(e) => setStatus(e.target.value as TransactionStatus)}
                className="bg-surface-container-low rounded-xl px-3 py-2 text-sm text-on-surface focus:outline-none"
              >
                <option value="efetivado">Efetivado / Pago</option>
                <option value="conciliado">Conciliado</option>
                <option value="pendente">Pendente / Agendado</option>
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-on-surface-variant">Observações (opcional)</label>
            <input
              type="text"
              disabled={isSubmitting}
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="Detalhes adicionais ou tags..."
              className="bg-surface-container-low rounded-xl px-3 py-2 text-sm text-on-surface focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-2 pt-1">
            {editingTransaction && onRequestDelete && (
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => {
                  onClose();
                  onRequestDelete(editingTransaction);
                }}
                className="px-4 py-3 rounded-xl bg-error-container text-error text-sm font-bold flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
              >
                <Icon name="delete" className="text-lg" />
                <span>Excluir</span>
              </button>
            )}
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 py-3 rounded-xl bg-primary text-on-primary text-sm font-bold active:scale-[0.98] transition-all shadow-md flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
            >
              {isSubmitting ? (
                <>
                  <Icon name="progress_activity" className="text-lg animate-spin" />
                  <span>Salvando...</span>
                </>
              ) : (
                <span>
                  {editingTransaction
                    ? 'Salvar Alterações'
                    : type === 'receita'
                    ? 'Salvar Receita'
                    : 'Salvar Despesa'}
                </span>
              )}
            </button>
          </div>
        </form>
      </div>
    );
  }

  // Desktop Full Modal
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-space-md"
      onClick={() => !isSubmitting && onClose()}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="bg-surface-container-lowest w-full max-w-xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
      >
        {/* Modal Header */}
        <div className="p-space-lg bg-surface-container-low flex items-center justify-between">
          <div className="flex items-center gap-space-sm">
            <div className="w-10 h-10 rounded-xl bg-primary-fixed/50 flex items-center justify-center text-primary">
              <Icon name="account_balance_wallet" className="text-2xl" />
            </div>
            <div>
              <h2 className="text-xl text-on-surface font-bold">
                {editingTransaction ? 'Editar Movimentação' : 'Nova Movimentação'}
              </h2>
              <p className="text-xs text-secondary">
                Registre uma despesa ou receita sincronizada com seu banco de dados.
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onClose}
            className="w-8 h-8 rounded-xl bg-surface-container hover:bg-surface-container-high text-secondary hover:text-on-surface flex items-center justify-center transition-all cursor-pointer disabled:opacity-50"
          >
            <Icon name="close" className="text-lg" />
          </button>
        </div>

        {/* Form Body */}
        <div className="p-space-lg overflow-y-auto space-y-space-md flex-1">
          {errorMsg && (
            <div className="p-3 rounded-xl bg-error-container text-on-error-container text-xs font-semibold flex items-center gap-2">
              <Icon name="error" className="text-base text-error" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Toggle Type: Despesa vs Receita */}
          <div className="grid grid-cols-2 gap-space-sm p-1 bg-surface-container-low rounded-xl">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => handleTypeChange('despesa')}
              className={`py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                type === 'despesa'
                  ? 'text-error bg-error-container shadow-xs'
                  : 'text-secondary hover:text-on-surface'
              }`}
            >
              <Icon name="trending_down" className="text-lg" />
              Despesa
            </button>
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => handleTypeChange('receita')}
              className={`py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                type === 'receita'
                  ? 'text-primary bg-primary-fixed/50 shadow-xs'
                  : 'text-secondary hover:text-on-surface'
              }`}
            >
              <Icon name="trending_up" className="text-lg" />
              Receita
            </button>
          </div>

          {/* Big Amount Input Field */}
          <div className="bg-surface-container-low rounded-2xl p-space-md flex flex-col items-center justify-center text-center">
            <span className="text-[11px] text-secondary uppercase font-semibold mb-1 tracking-wider">
              Valor da Operação
            </span>
            <div className="flex items-baseline justify-center gap-1.5 text-on-surface">
              <span className="text-xl text-secondary font-semibold">R$</span>
              <input
                type="text"
                inputMode="decimal"
                disabled={isSubmitting}
                placeholder="0,00"
                value={amountInput}
                onChange={(e) => {
                  setAmountInput(e.target.value);
                  if (errorMsg) setErrorMsg(null);
                }}
                className={`bg-transparent text-4xl font-bold text-center w-56 focus:outline-none tabular-nums ${
                  type === 'despesa' ? 'text-error' : 'text-primary'
                }`}
              />
            </div>
            <span className="text-xs text-secondary mt-1">
              Lançamento em moeda corrente nacional (BRL)
            </span>
          </div>

          {/* Descrição / Estabelecimento */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-on-surface block">
              Descrição &amp; Estabelecimento *
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary flex items-center">
                <Icon name="storefront" className="text-lg" />
              </span>
              <input
                type="text"
                disabled={isSubmitting}
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (errorMsg) setErrorMsg(null);
                }}
                placeholder="Ex: Supermercado, Salário, Uber..."
                className="w-full bg-surface-container-low text-on-surface rounded-xl pl-10 pr-space-md py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
          </div>

          {/* Categoria & Conta */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-space-md">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-on-surface block">
                Categoria (Opcional)
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary flex items-center">
                  <Icon name="category" className="text-lg" />
                </span>
                <select
                  disabled={isSubmitting}
                  value={categoryId}
                  onChange={(e) => handleCategoryChange(e.target.value)}
                  className="w-full bg-surface-container-low text-on-surface rounded-xl pl-10 pr-space-md py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
                >
                  <option value="">Sem categoria (Opcional)</option>
                  {filteredCategories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>
              {filteredCategories.length === 0 && (
                <p className="text-[11px] text-secondary">
                  Nenhuma categoria cadastrada ainda — será salvo sem categoria vinculada.
                </p>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-on-surface block">
                Conta / Carteira (Opcional)
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary flex items-center">
                  <Icon name="credit_card" className="text-lg" />
                </span>
                <select
                  disabled={isSubmitting}
                  value={accountId}
                  onChange={(e) => handleAccountChange(e.target.value)}
                  className="w-full bg-surface-container-low text-on-surface rounded-xl pl-10 pr-space-md py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
                >
                  <option value="">Sem conta vinculada (Opcional)</option>
                  {accountsList.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name}
                    </option>
                  ))}
                </select>
              </div>
              {accountsList.length === 0 && (
                <p className="text-[11px] text-secondary">
                  Nenhuma conta cadastrada ainda — será salvo sem conta vinculada.
                </p>
              )}
            </div>
          </div>

          {/* Subcategoria, Método e Situação */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-space-sm">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-on-surface block">Subcategoria</label>
              <select
                disabled={isSubmitting}
                value={subcategory}
                onChange={(e) => setSubcategory(e.target.value)}
                className="w-full bg-surface-container-low text-on-surface rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
              >
                <option value="">Geral</option>
                {(selectedCategoryObj?.subcategories || []).map((sub) => (
                  <option key={sub.id} value={sub.name}>
                    {sub.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-on-surface block">Método</label>
              <select
                disabled={isSubmitting}
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="w-full bg-surface-container-low text-on-surface rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-on-surface block">Situação</label>
              <select
                disabled={isSubmitting}
                value={status}
                onChange={(e) => setStatus(e.target.value as TransactionStatus)}
                className="w-full bg-surface-container-low text-on-surface rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
              >
                <option value="efetivado">Efetivado / Pago</option>
                <option value="conciliado">Conciliado</option>
                <option value="pendente">Pendente / Agendado</option>
              </select>
            </div>
          </div>

          {/* Data e Horário */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-space-md">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-on-surface block">Data do Lançamento</label>
              <input
                type="date"
                disabled={isSubmitting}
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full bg-surface-container-low text-on-surface rounded-xl px-space-md py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 tabular-nums"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-on-surface block">Horário</label>
              <input
                type="time"
                disabled={isSubmitting}
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full bg-surface-container-low text-on-surface rounded-xl px-space-md py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 tabular-nums"
              />
            </div>
          </div>

          {/* Checkbox Repetir */}
          <label className="p-3 bg-surface-container-low rounded-xl flex items-center justify-between cursor-pointer">
            <div className="flex items-center gap-space-sm">
              <input
                type="checkbox"
                disabled={isSubmitting}
                checked={recurring}
                onChange={(e) => setRecurring(e.target.checked)}
                className="w-4 h-4 rounded text-primary focus:ring-primary/20 accent-primary cursor-pointer"
              />
              <div>
                <span className="text-sm font-semibold text-on-surface block select-none">
                  Repetir esta movimentação
                </span>
                <p className="text-xs text-secondary">
                  Definir como lançamento fixo mensal ou parcelamento
                </p>
              </div>
            </div>
            <Icon name="event_repeat" className="text-secondary text-xl" />
          </label>

          {/* Tags & Observações */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-on-surface block">Tags &amp; Observações</label>
            <input
              type="text"
              disabled={isSubmitting}
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="#mercado, #fixo, observação adicional..."
              className="w-full bg-surface-container-low text-on-surface rounded-xl px-space-md py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-space-md bg-surface-container-low flex items-center justify-between gap-space-sm">
          <div>
            {editingTransaction && onRequestDelete && (
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => {
                  onClose();
                  onRequestDelete(editingTransaction);
                }}
                className="px-3.5 py-2 rounded-xl bg-error-container/70 hover:bg-error-container text-error text-xs font-semibold transition-all inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
              >
                <Icon name="delete" className="text-base" />
                <span>Excluir Lançamento</span>
              </button>
            )}
          </div>
          <div className="flex items-center gap-space-sm">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={onClose}
              className="px-space-md py-2 rounded-xl bg-surface-container hover:bg-surface-container-high text-on-surface text-sm font-medium transition-all cursor-pointer disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-space-lg py-2.5 rounded-xl bg-primary hover:bg-primary-container disabled:opacity-60 text-on-primary text-sm font-semibold shadow-md transition-all flex items-center gap-1.5 cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <Icon name="progress_activity" className="text-base animate-spin" />
                  <span>Salvando...</span>
                </>
              ) : (
                <>
                  <Icon name="check" className="text-base" />
                  <span>
                    {editingTransaction
                      ? 'Salvar Alterações'
                      : type === 'receita'
                      ? 'Salvar Receita'
                      : 'Salvar Despesa'}
                  </span>
                </>
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
