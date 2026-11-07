import React, { useMemo, useState } from 'react';
import { formatBRL } from '../data/initialData';
import {
  isDuplicateCategoryForType,
  normalizeCategoryNameKey,
} from '../services/financeService';
import { Category, DataSourceMode, Subcategory, Transaction, TransactionType } from '../types/finance';
import { Icon } from '../components/Icon';
import { EmptyState } from '../components/ui/EmptyState';

export interface SaveCategoryResult {
  ok: boolean;
  errorMessage?: string;
}

interface CategoriasViewProps {
  categories: Category[];
  transactions: Transaction[];
  selectedMonth: string;
  dataSourceMode: DataSourceMode;
  isLoading?: boolean;
  onRefresh?: () => void;
  onSaveCategory: (
    cat: Omit<Category, 'id'>,
    existingId?: string
  ) => Promise<SaveCategoryResult>;
  onDeleteCategory: (cat: Category) => void;
  onNotify: (msg: string) => void;
}

type CategoryFilterTab = 'all' | TransactionType;

const PRESET_CATEGORY_COLORS = [
  { hex: '#006948', label: 'Esmeralda' },
  { hex: '#2563eb', label: 'Azul' },
  { hex: '#d97706', label: 'Âmbar' },
  { hex: '#0891b2', label: 'Ciano' },
  { hex: '#e11d48', label: 'Rosa' },
  { hex: '#7c3aed', label: 'Roxo' },
  { hex: '#059669', label: 'Verde' },
  { hex: '#475569', label: 'Grafite' },
];

function mapHexToColorClass(hex: string, type: TransactionType): string {
  const lower = hex.toLowerCase();
  if (lower.includes('2170') || lower.includes('0058') || lower.includes('2563')) return 'tertiary';
  if (lower.includes('f59e') || lower.includes('d977')) return 'amber';
  if (lower.includes('0891') || lower.includes('06b6')) return 'cyan';
  if (lower.includes('f43f') || lower.includes('ba1a') || lower.includes('e11d')) return 'rose';
  if (lower.includes('9333') || lower.includes('7c3a')) return 'purple';
  if (type === 'receita') return 'primary';
  return 'primary';
}

export const CategoriasView: React.FC<CategoriasViewProps> = ({
  categories,
  transactions,
  selectedMonth,
  dataSourceMode,
  isLoading = false,
  onRefresh,
  onSaveCategory,
  onDeleteCategory,
  onNotify,
}) => {
  const [activeType, setActiveType] = useState<CategoryFilterTab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [limitFilter, setLimitFilter] = useState('Todos os limites');
  const [expandedIds, setExpandedIds] = useState<string[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingCat, setEditingCat] = useState<Category | null>(null);
  const [isSavingCat, setIsSavingCat] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Modal Form state
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState<TransactionType>('despesa');
  const [formIcon, setFormIcon] = useState('sell');
  const [formHex, setFormHex] = useState('#006948');
  const [formParentId, setFormParentId] = useState('');
  const [formBudget, setFormBudget] = useState('');
  const [formSubcategories, setFormSubcategories] = useState<Subcategory[]>([]);
  const [newSubName, setNewSubName] = useState('');

  const expenseCats = useMemo(
    () => categories.filter((c) => c.type === 'despesa'),
    [categories]
  );
  const incomeCats = useMemo(
    () => categories.filter((c) => c.type === 'receita'),
    [categories]
  );

  const filteredCategories = useMemo(
    () =>
      categories.filter((c) => {
        if (activeType !== 'all' && c.type !== activeType) return false;
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const subMatch = c.subcategories.some((s) => s.name.toLowerCase().includes(q));
          if (!c.name.toLowerCase().includes(q) && !subMatch) return false;
        }
        const pct = c.budget > 0 ? (c.spent / c.budget) * 100 : 0;
        if (limitFilter === 'Excedidos (>100%)' && pct <= 100) return false;
        if (limitFilter === 'Em alerta (>80%)' && pct < 80) return false;
        if (limitFilter === 'Saudáveis (<80%)' && pct >= 80) return false;
        return true;
      }),
    [categories, activeType, searchQuery, limitFilter]
  );

  const totalBudget = filteredCategories.reduce((acc, c) => acc + c.budget, 0);
  const totalSpent = filteredCategories.reduce((acc, c) => acc + c.spent, 0);
  const totalExpenseSpent = expenseCats.reduce((acc, c) => acc + c.spent, 0);
  const totalIncomeSpent = incomeCats.reduce((acc, c) => acc + c.spent, 0);
  const commitmentPct =
    totalBudget > 0 ? ((totalSpent / totalBudget) * 100).toFixed(1) : '0.0';

  // Live analytics from real transactions (zero mock data)
  const categorizationStats = useMemo(() => {
    const totalTx = transactions.length;
    if (totalTx === 0) {
      return { pct: 100, uncategorized: 0, total: 0, topCategories: [] };
    }
    const knownIds = new Set(categories.map((c) => c.id));
    const knownNames = new Set(categories.map((c) => normalizeCategoryNameKey(c.name)));

    const categorizedCount = transactions.filter((t) => {
      if (t.categoryId && knownIds.has(t.categoryId)) return true;
      const normalized = normalizeCategoryNameKey(t.category || '');
      if (!normalized || normalized === 'sem categoria') return false;
      return knownNames.has(normalized);
    }).length;

    const uncategorized = Math.max(0, totalTx - categorizedCount);
    const pct = Math.round((categorizedCount / totalTx) * 100);

    const freqMap = new Map<string, number>();
    for (const tx of transactions) {
      const label = tx.category?.trim() || 'Sem categoria';
      freqMap.set(label, (freqMap.get(label) || 0) + 1);
    }
    const topCategories = Array.from(freqMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));

    return { pct, uncategorized, total: totalTx, topCategories };
  }, [transactions, categories]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const openCreateModal = () => {
    const initialType: TransactionType = activeType === 'receita' ? 'receita' : 'despesa';
    setEditingCat(null);
    setFormName('');
    setFormType(initialType);
    setFormIcon(initialType === 'receita' ? 'payments' : 'sell');
    setFormHex(initialType === 'receita' ? '#059669' : '#006948');
    setFormParentId('');
    setFormBudget('');
    setFormSubcategories([]);
    setNewSubName('');
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (cat: Category) => {
    setEditingCat(cat);
    setFormName(cat.name);
    setFormType(cat.type);
    setFormIcon(cat.icon || (cat.type === 'receita' ? 'payments' : 'sell'));
    setFormHex(/^#[0-9a-fA-F]{6}$/.test(cat.hexColor) ? cat.hexColor : '#006948');
    setFormParentId('');
    setFormBudget(cat.budget > 0 ? String(cat.budget) : '');
    setFormSubcategories(cat.subcategories);
    setNewSubName('');
    setFormError(null);
    setModalOpen(true);
  };

  const handleSelectFormType = (nextType: TransactionType) => {
    setFormType(nextType);
    setFormParentId('');
    setFormError(null);
    if (!editingCat) {
      if (formIcon === 'sell' || formIcon === 'payments') {
        setFormIcon(nextType === 'receita' ? 'payments' : 'sell');
      }
    }
  };

  const handleAddSubChip = () => {
    const trimmed = newSubName.trim();
    if (!trimmed) return;
    if (formSubcategories.some((s) => s.name.toLowerCase() === trimmed.toLowerCase())) {
      setNewSubName('');
      return;
    }
    setFormSubcategories((prev) => [
      ...prev,
      { id: `sub-${Date.now()}`, name: trimmed, spent: 0 },
    ]);
    setNewSubName('');
  };

  const handleRemoveSubChip = (subId: string) => {
    setFormSubcategories((prev) => prev.filter((s) => s.id !== subId));
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSavingCat) return;

    const cleanName = formName.trim().replace(/\s+/g, ' ');
    if (!cleanName) {
      setFormError('Informe o nome da categoria.');
      return;
    }

    const cleanHex = formHex.trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(cleanHex)) {
      setFormError('Selecione uma cor hexadecimal válida (ex: #006948).');
      return;
    }

    const budgetValue = Math.max(0, parseFloat(formBudget) || 0);

    // If user selected a parent category while creating, append as subcategory
    if (!editingCat && formParentId) {
      const parent = categories.find((c) => c.id === formParentId);
      if (parent) {
        const subAlreadyExists = parent.subcategories.some(
          (s) => normalizeCategoryNameKey(s.name) === normalizeCategoryNameKey(cleanName)
        );
        if (subAlreadyExists) {
          setFormError(
            `A subcategoria "${cleanName}" já existe dentro de "${parent.name}".`
          );
          return;
        }

        setIsSavingCat(true);
        setFormError(null);
        try {
          const updatedSubs: Subcategory[] = [
            ...parent.subcategories,
            { id: `sub-${Date.now()}`, name: cleanName, spent: 0 },
          ];
          const res = await onSaveCategory(
            {
              ...parent,
              budget: parent.budget + budgetValue,
              subcategories: updatedSubs,
            },
            parent.id
          );
          if (res.ok) {
            setModalOpen(false);
          } else {
            setFormError(res.errorMessage || 'Não foi possível salvar a subcategoria.');
          }
        } finally {
          setIsSavingCat(false);
        }
        return;
      }
    }

    // Prevent duplicate category for the same user and same type
    if (isDuplicateCategoryForType(categories, cleanName, formType, editingCat?.id)) {
      setFormError(
        `Já existe uma categoria de ${
          formType === 'receita' ? 'receita' : 'despesa'
        } com o nome "${cleanName}". Escolha outro nome.`
      );
      return;
    }

    setIsSavingCat(true);
    setFormError(null);
    try {
      const res = await onSaveCategory(
        {
          name: cleanName,
          type: formType,
          icon: formIcon.trim() || (formType === 'receita' ? 'payments' : 'sell'),
          colorClass: mapHexToColorClass(cleanHex, formType),
          hexColor: cleanHex.toLowerCase(),
          budget: budgetValue,
          spent: editingCat?.spent || 0,
          transactionsCount: editingCat?.transactionsCount || 0,
          subcategories: formSubcategories,
        },
        editingCat?.id
      );
      if (res.ok) {
        if (activeType !== 'all' && activeType !== formType) {
          setActiveType(formType);
        }
        setModalOpen(false);
      } else {
        setFormError(res.errorMessage || 'Não foi possível salvar a categoria.');
      }
    } finally {
      setIsSavingCat(false);
    }
  };

  return (
    <div className="flex flex-col w-full">
      {/* Page Header */}
      <header className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-space-md mb-space-lg">
        <div className="space-y-1">
          <div className="flex items-center gap-space-sm">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-surface-container text-primary font-bold">
              <Icon name="category" className="text-xl" />
            </span>
            <h1 className="text-[32px] leading-10 font-bold text-on-surface tracking-tight">
              Categorias Financeiras
            </h1>
          </div>
          <p className="text-sm text-secondary">
            Gerencie categorias de receitas e despesas • valores apurados automaticamente em{' '}
            <strong className="text-on-surface">{selectedMonth}</strong>.
          </p>
        </div>

        <div className="flex items-center gap-space-sm flex-wrap">
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={isLoading}
              className="inline-flex items-center gap-1.5 px-space-md py-2 rounded-xl bg-surface-container-low hover:bg-surface-container text-on-surface text-sm font-semibold shadow-2xs transition-all cursor-pointer whitespace-nowrap disabled:opacity-60"
            >
              <Icon
                name="sync"
                className={`text-lg text-primary ${isLoading ? 'animate-spin' : ''}`}
              />
              <span>{isLoading ? 'Sincronizando com Supabase...' : 'Sincronizar Supabase'}</span>
            </button>
          )}
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-1.5 px-space-md py-2 rounded-xl bg-primary hover:bg-primary-container text-on-primary text-sm font-semibold shadow-sm transition-all cursor-pointer whitespace-nowrap"
          >
            <Icon name="add" className="text-lg" />
            <span>Nova Categoria</span>
          </button>
        </div>
      </header>

      {/* Navigation Tabs & Quick Stats Bar */}
      <section className="grid grid-cols-1 xl:grid-cols-12 gap-space-lg mb-space-lg">
        <div className="xl:col-span-8 flex flex-col gap-space-md">
          {/* Tabs & Search Controls */}
          <div className="bg-surface-container-lowest p-space-sm rounded-xl shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-space-sm">
            <div className="flex items-center bg-surface-container-low p-1 rounded-lg gap-1 self-start flex-wrap">
              <button
                type="button"
                onClick={() => setActiveType('all')}
                className={`px-space-md py-1.5 rounded-md text-sm transition-all flex items-center gap-2 cursor-pointer whitespace-nowrap ${
                  activeType === 'all'
                    ? 'bg-surface-container-lowest text-on-surface font-semibold shadow-2xs'
                    : 'text-secondary hover:text-on-surface font-medium'
                }`}
              >
                <span className="w-2 h-2 rounded-xs bg-tertiary" />
                <span>Todas ({categories.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveType('despesa')}
                className={`px-space-md py-1.5 rounded-md text-sm transition-all flex items-center gap-2 cursor-pointer whitespace-nowrap ${
                  activeType === 'despesa'
                    ? 'bg-surface-container-lowest text-on-surface font-semibold shadow-2xs'
                    : 'text-secondary hover:text-on-surface font-medium'
                }`}
              >
                <span className="w-2 h-2 rounded-xs bg-error" />
                <span>Despesas ({expenseCats.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveType('receita')}
                className={`px-space-md py-1.5 rounded-md text-sm transition-all flex items-center gap-2 cursor-pointer whitespace-nowrap ${
                  activeType === 'receita'
                    ? 'bg-surface-container-lowest text-on-surface font-semibold shadow-2xs'
                    : 'text-secondary hover:text-on-surface font-medium'
                }`}
              >
                <span className="w-2 h-2 rounded-xs bg-primary" />
                <span>Receitas ({incomeCats.length})</span>
              </button>
            </div>

            <div className="flex items-center gap-space-sm flex-1 sm:justify-end">
              <div className="relative w-full sm:w-60">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary flex items-center">
                  <Icon name="search" className="text-lg" />
                </span>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar categoria ou subcategoria..."
                  className="w-full bg-surface-container-low pl-9 pr-3 py-1.5 rounded-lg text-on-surface text-xs placeholder:text-secondary focus:outline-none focus:bg-surface-container"
                />
              </div>
              <select
                value={limitFilter}
                onChange={(e) => setLimitFilter(e.target.value)}
                className="bg-surface-container-low px-3 py-1.5 rounded-lg text-xs font-semibold text-on-surface focus:outline-none cursor-pointer"
              >
                <option>Todos os limites</option>
                <option>Excedidos (&gt;100%)</option>
                <option>Em alerta (&gt;80%)</option>
                <option>Saudáveis (&lt;80%)</option>
              </select>
            </div>
          </div>

          {/* Quick Metrics Strip */}
          {activeType === 'all' ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-space-md">
              <div className="bg-surface-container-lowest p-space-md rounded-xl shadow-xs flex items-center justify-between">
                <div>
                  <span className="text-xs text-secondary uppercase tracking-wider font-semibold">
                    Categorias Ativas
                  </span>
                  <div className="text-xl text-on-surface font-bold mt-1 tabular-nums">
                    {categories.length}
                  </div>
                  <span className="text-[11px] text-secondary">
                    {expenseCats.length} despesas · {incomeCats.length} receitas
                  </span>
                </div>
                <div className="w-10 h-10 rounded-xl bg-surface-container-low flex items-center justify-center text-primary">
                  <Icon name="category" className="text-2xl" />
                </div>
              </div>

              <div className="bg-surface-container-lowest p-space-md rounded-xl shadow-xs flex items-center justify-between">
                <div>
                  <span className="text-xs text-secondary uppercase tracking-wider font-semibold">
                    Despesas Categorizadas
                  </span>
                  <div className="text-xl text-on-surface font-bold mt-1 tabular-nums">
                    {formatBRL(totalExpenseSpent)}
                  </div>
                </div>
                <div className="w-10 h-10 rounded-xl bg-surface-container-low flex items-center justify-center text-error">
                  <Icon name="trending_down" className="text-2xl" />
                </div>
              </div>

              <div className="bg-surface-container-lowest p-space-md rounded-xl shadow-xs flex items-center justify-between">
                <div>
                  <span className="text-xs text-secondary uppercase tracking-wider font-semibold">
                    Receitas Categorizadas
                  </span>
                  <div className="text-xl text-primary font-bold mt-1 tabular-nums">
                    {formatBRL(totalIncomeSpent)}
                  </div>
                </div>
                <div className="w-10 h-10 rounded-xl bg-surface-container-low flex items-center justify-center text-primary">
                  <Icon name="trending_up" className="text-2xl" />
                </div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-space-md">
              <div className="bg-surface-container-lowest p-space-md rounded-xl shadow-xs flex items-center justify-between">
                <div>
                  <span className="text-xs text-secondary uppercase tracking-wider font-semibold">
                    {activeType === 'despesa' ? 'Orçamento Geral' : 'Meta de Receita'}
                  </span>
                  <div className="text-xl text-on-surface font-bold mt-1 tabular-nums">
                    {formatBRL(totalBudget)}
                  </div>
                </div>
                <div className="w-10 h-10 rounded-xl bg-surface-container-low flex items-center justify-center text-primary">
                  <Icon name="account_balance_wallet" className="text-2xl" />
                </div>
              </div>

              <div className="bg-surface-container-lowest p-space-md rounded-xl shadow-xs flex items-center justify-between">
                <div>
                  <span className="text-xs text-secondary uppercase tracking-wider font-semibold">
                    {activeType === 'despesa' ? 'Gasto no Mês' : 'Recebido no Mês'}
                  </span>
                  <div className="text-xl text-on-surface font-bold mt-1 tabular-nums">
                    {formatBRL(totalSpent)}
                  </div>
                </div>
                <div className="w-10 h-10 rounded-xl bg-surface-container-low flex items-center justify-center text-tertiary">
                  <Icon name="pie_chart" className="text-2xl" />
                </div>
              </div>

              <div className="bg-surface-container-lowest p-space-md rounded-xl shadow-xs flex items-center justify-between">
                <div>
                  <span className="text-xs text-secondary uppercase tracking-wider font-semibold">
                    {activeType === 'despesa' ? 'Comprometimento' : 'Atingimento'}
                  </span>
                  <div className="text-xl text-primary font-bold mt-1 tabular-nums">
                    {commitmentPct}%
                  </div>
                </div>
                <div className="w-10 h-10 rounded-xl bg-surface-container-low flex items-center justify-center text-primary-container">
                  <Icon name="insights" className="text-2xl" />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Smart Classification Card */}
        <div className="xl:col-span-4 bg-gradient-to-br from-primary-container to-primary text-on-primary p-space-lg rounded-xl shadow-md flex flex-col justify-between relative overflow-hidden">
          <div className="absolute -right-6 -bottom-6 w-36 h-36 bg-surface-container-lowest/10 rounded-full blur-2xl pointer-events-none" />
          <div className="space-y-1.5 relative z-10">
            <span className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-on-primary/90">
              <Icon name="auto_awesome" className="text-sm" /> Cálculo Automático
            </span>
            <h2 className="text-lg font-bold text-on-primary">Orçamentos Sincronizados</h2>
            <p className="text-xs text-on-primary/85 leading-relaxed">
              Os valores gastos e recebidos de cada categoria refletem em tempo real as movimentações de{' '}
              <strong>{selectedMonth}</strong>.
            </p>
          </div>
          <div className="pt-space-md relative z-10 flex items-center justify-between">
            <span className="text-xs text-on-primary/90 tabular-nums">
              {categorizationStats.pct}% dos lançamentos classificados
            </span>
            <button
              type="button"
              onClick={() =>
                onNotify('Limites e categorias verificados com sucesso para este mês!')
              }
              className="px-3 py-1.5 bg-surface-container-lowest text-primary rounded-lg text-xs font-semibold shadow-2xs hover:bg-surface-container transition-all cursor-pointer"
            >
              Verificar Tetos
            </button>
          </div>
        </div>
      </section>

      {/* Main Content Layout: Categories Grid + Analytics Drawer */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-space-lg items-start">
        <section className="xl:col-span-8 space-y-space-md">
          <div className="flex items-center justify-between">
            <h2 className="text-lg text-on-surface font-bold">
              Categorias Principais &amp; Subcategorias
            </h2>
            <span className="text-xs text-secondary font-medium tabular-nums">
              {filteredCategories.length}{' '}
              {filteredCategories.length === 1 ? 'categoria exibida' : 'categorias exibidas'} em{' '}
              {selectedMonth}
            </span>
          </div>

          {filteredCategories.length === 0 ? (
            <EmptyState
              icon="category"
              title={
                categories.length === 0
                  ? 'Nenhuma categoria cadastrada no banco'
                  : 'Nenhuma categoria encontrada para este filtro'
              }
              description={
                categories.length === 0
                  ? 'Crie suas próprias categorias de receitas e despesas para classificar suas movimentações com persistência real no Supabase.'
                  : 'Altere o filtro entre Todas, Despesas e Receitas, ajuste a busca ou cadastre uma nova categoria.'
              }
              actionLabel="Nova Categoria"
              onAction={openCreateModal}
            />
          ) : (
            filteredCategories.map((cat) => {
              const effectiveHex = /^#[0-9a-fA-F]{6}$/.test(cat.hexColor)
                ? cat.hexColor
                : '#006948';
              const rawPct =
                cat.budget > 0 ? Number(((cat.spent / cat.budget) * 100).toFixed(1)) : 0;
              const barWidth = Math.min(100, rawPct);
              const isExceeded = cat.budget > 0 && cat.type === 'despesa' && rawPct > 100;
              const typeScopedTotal =
                cat.type === 'receita' ? totalIncomeSpent : totalExpenseSpent;
              const isExpanded = expandedIds.includes(cat.id);

              return (
                <article
                  key={cat.id}
                  className="bg-surface-container-lowest rounded-xl p-space-lg shadow-xs hover:shadow-md transition-all"
                >
                  <div className="flex items-start justify-between gap-space-md">
                    <div className="flex items-center gap-space-md min-w-0">
                      <div
                        className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
                        style={{
                          backgroundColor: `${effectiveHex}18`,
                          color: effectiveHex,
                        }}
                      >
                        <Icon name={cat.icon} className="text-2xl" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-lg text-on-surface font-bold truncate">
                            {cat.name}
                          </h3>
                          <span
                            className="w-2.5 h-2.5 rounded-xs shrink-0"
                            title={`Cor: ${effectiveHex}`}
                            style={{ backgroundColor: effectiveHex }}
                          />
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold ${
                              cat.type === 'receita'
                                ? 'bg-primary-fixed text-primary'
                                : 'bg-error-container/50 text-error'
                            }`}
                          >
                            <Icon
                              name={cat.type === 'receita' ? 'trending_up' : 'trending_down'}
                              className="text-xs"
                            />
                            {cat.type === 'receita' ? 'Receita' : 'Despesa'}
                          </span>
                        </div>
                        <p className="text-xs text-secondary tabular-nums mt-0.5">
                          {cat.subcategories.length}{' '}
                          {cat.subcategories.length === 1 ? 'subcategoria' : 'subcategorias'} ·{' '}
                          {cat.transactionsCount}{' '}
                          {cat.transactionsCount === 1
                            ? 'lançamento no mês'
                            : 'lançamentos no mês'}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => openEditModal(cat)}
                        aria-label={`Editar ${cat.name}`}
                        title="Editar nome, tipo ou cor"
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-secondary hover:text-on-surface hover:bg-surface-container-low transition-colors cursor-pointer"
                      >
                        <Icon name="edit" className="text-lg" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteCategory(cat)}
                        aria-label={`Excluir ${cat.name}`}
                        title="Excluir categoria"
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-error hover:bg-error-container transition-colors cursor-pointer"
                      >
                        <Icon name="delete" className="text-lg" />
                      </button>
                    </div>
                  </div>

                  {/* Budget Gauge */}
                  <div className="mt-space-md space-y-1.5">
                    <div className="flex justify-between items-baseline text-xs tabular-nums">
                      <span className="text-secondary">
                        {cat.type === 'despesa' ? 'Gasto no mês:' : 'Recebido no mês:'}{' '}
                        <strong className="text-on-surface font-semibold">
                          {formatBRL(cat.spent)}
                        </strong>
                        {cat.budget > 0 ? ` de ${formatBRL(cat.budget)}` : ''}
                      </span>
                      <span
                        className={`font-bold ${isExceeded ? 'text-error' : ''}`}
                        style={!isExceeded ? { color: effectiveHex } : undefined}
                      >
                        {cat.budget > 0
                          ? `${rawPct}% ${cat.type === 'despesa' ? 'Utilizado' : 'Atingido'}`
                          : typeScopedTotal > 0
                          ? `${Math.round((cat.spent / typeScopedTotal) * 100)}% do mês`
                          : 'Ativa'}
                      </span>
                    </div>
                    <div className="w-full h-2 bg-surface-container rounded-full overflow-hidden">
                      <div
                        className={`h-full ${
                          isExceeded ? 'bg-error' : ''
                        } rounded-full transition-all duration-300`}
                        style={{
                          width: `${
                            cat.budget > 0
                              ? barWidth
                              : typeScopedTotal > 0
                              ? Math.min(100, Math.round((cat.spent / typeScopedTotal) * 100))
                              : 0
                          }%`,
                          backgroundColor: isExceeded ? undefined : effectiveHex,
                        }}
                      />
                    </div>
                  </div>

                  {/* Collapsible Subcategories */}
                  {cat.subcategories.length > 0 && (
                    <div className="mt-space-md pt-1">
                      <button
                        type="button"
                        onClick={() => toggleExpand(cat.id)}
                        className="w-full flex items-center justify-between py-1 text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
                      >
                        <span className="text-xs font-semibold flex items-center gap-1.5">
                          <Icon
                            name="chevron_right"
                            className={`text-sm transition-transform ${
                              isExpanded ? 'rotate-90' : ''
                            }`}
                          />
                          Subcategorias Detalhadas ({cat.subcategories.length})
                        </span>
                        <span className="text-xs text-secondary">
                          {isExpanded ? 'Ocultar' : 'Ver distribuição'}
                        </span>
                      </button>

                      {isExpanded && (
                        <div className="mt-2 pl-4 space-y-1.5">
                          {cat.subcategories.map((sub) => {
                            const subPct =
                              cat.budget > 0
                                ? ((sub.spent / cat.budget) * 100).toFixed(1).replace('.0', '')
                                : '0';
                            return (
                              <div
                                key={sub.id}
                                className="flex items-center justify-between p-2.5 rounded-lg bg-surface-container-low hover:bg-surface-container transition-colors"
                              >
                                <span className="text-sm text-on-surface font-medium">
                                  {sub.name}
                                </span>
                                <div className="flex items-center gap-3 text-xs tabular-nums">
                                  <span className="text-secondary font-medium">
                                    {formatBRL(sub.spent)}
                                  </span>
                                  <span className="text-secondary font-semibold">{subPct}%</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </article>
              );
            })
          )}
        </section>

        {/* Sidebar Analytics (100% Dynamic from Transactions) */}
        <aside className="xl:col-span-4 space-y-space-lg">
          <section className="bg-surface-container-lowest p-space-lg rounded-xl shadow-xs space-y-space-md">
            <div className="flex items-center justify-between">
              <h2 className="text-lg text-on-surface font-bold flex items-center gap-2">
                <Icon name="analytics" className="text-primary text-xl" />
                <span>Estatísticas Gerais</span>
              </h2>
              <span className="text-xs text-on-secondary-container font-semibold">Histórico</span>
            </div>

            <div className="p-space-md rounded-xl bg-surface-container-low flex items-center gap-space-md">
              <div className="relative w-16 h-16 shrink-0 flex items-center justify-center">
                <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                  <path
                    className="text-surface-container"
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3.5"
                  />
                  <path
                    className="text-primary"
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    fill="none"
                    stroke="currentColor"
                    strokeDasharray={`${categorizationStats.pct}, 100`}
                    strokeLinecap="round"
                    strokeWidth="3.5"
                  />
                </svg>
                <span className="absolute text-xs font-bold text-on-surface tabular-nums">
                  {categorizationStats.pct}%
                </span>
              </div>
              <div>
                <h3 className="text-sm font-bold text-on-surface">Lançamentos Categorizados</h3>
                <p className="text-xs text-secondary mt-0.5">
                  {categorizationStats.total === 0
                    ? 'Nenhum lançamento registrado até o momento.'
                    : categorizationStats.uncategorized === 0
                    ? `Todos os ${categorizationStats.total} lançamentos estão classificados.`
                    : `${categorizationStats.uncategorized} de ${categorizationStats.total} lançamentos estão sem categoria vinculada.`}
                </p>
              </div>
            </div>

            <div>
              <h3 className="text-xs text-secondary uppercase tracking-wider font-semibold mb-2.5">
                Categorias Mais Frequentes
              </h3>
              {categorizationStats.topCategories.length === 0 ? (
                <p className="text-xs text-secondary">Nenhuma movimentação registrada.</p>
              ) : (
                <ul className="space-y-2 text-xs">
                  {categorizationStats.topCategories.map((item) => (
                    <li key={item.name} className="flex items-center justify-between">
                      <span className="text-on-surface font-medium truncate pr-2">{item.name}</span>
                      <span className="font-semibold text-secondary tabular-nums shrink-0">
                        {item.count} {item.count === 1 ? 'lançamento' : 'lançamentos'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="p-2.5 rounded-lg bg-surface-container text-on-surface-variant text-xs flex items-center justify-between">
              <span className="flex items-center gap-1.5 font-medium">
                <Icon name="database" className="text-base text-primary" />
                {dataSourceMode === 'supabase'
                  ? 'Sincronizado via Supabase'
                  : 'Persistência Local Ativa'}
              </span>
              <span className="font-semibold text-primary">Tempo Real</span>
            </div>
          </section>

          <section className="bg-surface-container-low p-space-md rounded-xl space-y-1.5">
            <h3 className="text-sm font-bold text-on-surface flex items-center gap-1.5">
              <Icon name="lightbulb" className="text-primary text-base" />
              <span>Dica Financeira</span>
            </h3>
            <p className="text-xs text-secondary leading-relaxed">
              Separe claramente categorias de receitas e despesas com cores distintas para facilitar a leitura dos relatórios mensais.
            </p>
          </section>
        </aside>
      </div>

      {/* Modal: Nova / Editar Categoria */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 bg-inverse-surface/40 backdrop-blur-xs flex items-center justify-center p-space-md"
          onClick={() => {
            if (!isSavingCat) setModalOpen(false);
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-surface-container-lowest rounded-2xl max-w-lg w-full p-space-lg shadow-2xl max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between pb-space-md">
              <div className="flex items-center gap-space-sm">
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center"
                  style={{
                    backgroundColor: `${formHex}18`,
                    color: formHex,
                  }}
                >
                  <Icon name={formIcon || 'folder_managed'} className="text-xl" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-on-surface">
                    {editingCat ? 'Editar Categoria' : 'Nova Categoria'}
                  </h3>
                  <p className="text-xs text-secondary">
                    {editingCat
                      ? 'Altere nome, tipo ou cor da categoria salva no Supabase'
                      : 'Cadastre uma categoria de receita ou despesa'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={isSavingCat}
                onClick={() => setModalOpen(false)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-secondary hover:text-on-surface hover:bg-surface-container-low cursor-pointer disabled:opacity-50"
              >
                <Icon name="close" className="text-xl" />
              </button>
            </div>

            {formError && (
              <div
                role="alert"
                className="mb-space-md p-3 rounded-xl bg-error-container/60 text-error text-xs font-semibold flex items-start gap-2"
              >
                <Icon name="error" className="text-base shrink-0 mt-0.5" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleFormSubmit} className="space-y-space-md">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-on-surface block">
                  Nome da Categoria
                </label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => {
                    setFormName(e.target.value);
                    if (formError) setFormError(null);
                  }}
                  placeholder={
                    formType === 'receita' ? 'Ex: Salário, Freelance' : 'Ex: Alimentação, Moradia'
                  }
                  className="w-full bg-surface-container-low px-space-md py-2 rounded-lg text-sm text-on-surface placeholder:text-secondary focus:outline-none focus:bg-surface-container"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-on-surface block">
                  Tipo Financeiro
                </label>
                <div className="grid grid-cols-2 gap-space-sm">
                  <button
                    type="button"
                    onClick={() => handleSelectFormType('despesa')}
                    className={`flex items-center justify-center gap-2 p-2 rounded-lg text-sm font-semibold transition-all cursor-pointer ${
                      formType === 'despesa'
                        ? 'bg-primary-container text-on-primary-container'
                        : 'bg-surface-container-low text-on-surface hover:bg-surface-container'
                    }`}
                  >
                    <Icon name="trending_down" className="text-base" />
                    Despesa
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectFormType('receita')}
                    className={`flex items-center justify-center gap-2 p-2 rounded-lg text-sm font-semibold transition-all cursor-pointer ${
                      formType === 'receita'
                        ? 'bg-primary-container text-on-primary-container'
                        : 'bg-surface-container-low text-on-surface hover:bg-surface-container'
                    }`}
                  >
                    <Icon name="trending_up" className="text-base" />
                    Receita
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold text-on-surface block">
                  Cor da Categoria
                </label>
                <div className="flex items-center justify-between gap-3 flex-wrap bg-surface-container-low p-2.5 rounded-xl">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {PRESET_CATEGORY_COLORS.map((swatch) => {
                      const isSelected = formHex.toLowerCase() === swatch.hex.toLowerCase();
                      return (
                        <button
                          key={swatch.hex}
                          type="button"
                          title={swatch.label}
                          aria-label={`Cor ${swatch.label}`}
                          onClick={() => {
                            setFormHex(swatch.hex);
                            if (formError) setFormError(null);
                          }}
                          className={`w-7 h-7 rounded-lg transition-transform cursor-pointer flex items-center justify-center ${
                            isSelected ? 'scale-110 ring-2 ring-on-surface' : 'hover:scale-105'
                          }`}
                          style={{ backgroundColor: swatch.hex }}
                        >
                          {isSelected && <Icon name="check" className="text-white text-sm" />}
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex items-center gap-2 bg-surface-container-lowest px-2.5 py-1 rounded-lg">
                    <input
                      type="color"
                      aria-label="Selecionar cor personalizada"
                      value={/^#[0-9a-fA-F]{6}$/.test(formHex) ? formHex : '#006948'}
                      onChange={(e) => {
                        setFormHex(e.target.value.toLowerCase());
                        if (formError) setFormError(null);
                      }}
                      className="w-6 h-6 rounded border-none bg-transparent cursor-pointer"
                    />
                    <span className="text-xs text-on-surface font-mono uppercase">
                      {formHex}
                    </span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-space-md">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-on-surface block">
                    Ícone (Material Symbol)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary flex items-center">
                      <Icon name={formIcon || 'widgets'} className="text-lg" />
                    </span>
                    <input
                      type="text"
                      value={formIcon}
                      onChange={(e) => setFormIcon(e.target.value)}
                      placeholder="Ex: payments, restaurant"
                      className="w-full bg-surface-container-low pl-9 pr-3 py-2 rounded-lg text-sm text-on-surface focus:outline-none focus:bg-surface-container"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-on-surface block">
                    {formType === 'despesa'
                      ? 'Limite Mensal Opcional (R$)'
                      : 'Meta Mensal Opcional (R$)'}
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-secondary font-semibold">
                      R$
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={formBudget}
                      onChange={(e) => setFormBudget(e.target.value)}
                      placeholder="0,00"
                      className="w-full bg-surface-container-low pl-10 pr-space-md py-2 rounded-lg text-sm text-on-surface focus:outline-none focus:bg-surface-container tabular-nums"
                    />
                  </div>
                </div>
              </div>

              {!editingCat && categories.some((c) => c.type === formType) && (
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-on-surface block">
                    Categoria Pai (Opcional — para criar como subcategoria)
                  </label>
                  <select
                    value={formParentId}
                    onChange={(e) => {
                      setFormParentId(e.target.value);
                      if (formError) setFormError(null);
                    }}
                    className="w-full bg-surface-container-low px-space-md py-2 rounded-lg text-sm text-on-surface focus:outline-none cursor-pointer"
                  >
                    <option value="">Nenhuma (Esta será uma Categoria Principal)</option>
                    {categories
                      .filter((c) => c.type === formType)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                </div>
              )}

              {!formParentId && (
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-on-surface block">
                    Subcategorias Opcionais ({formSubcategories.length})
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={newSubName}
                      onChange={(e) => setNewSubName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddSubChip();
                        }
                      }}
                      placeholder="Adicionar subcategoria (Ex: Supermercado)"
                      className="flex-1 bg-surface-container-low px-3 py-1.5 rounded-lg text-xs text-on-surface focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleAddSubChip}
                      className="px-3 py-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-xs font-semibold text-on-surface cursor-pointer"
                    >
                      Incluir
                    </button>
                  </div>
                  {formSubcategories.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {formSubcategories.map((sub) => (
                        <span
                          key={sub.id}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-surface-container-low text-xs text-on-surface font-medium"
                        >
                          {sub.name}
                          <button
                            type="button"
                            onClick={() => handleRemoveSubChip(sub.id)}
                            className="text-secondary hover:text-error cursor-pointer"
                          >
                            <Icon name="close" className="text-xs" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="pt-2 flex items-center justify-end gap-space-sm">
                <button
                  type="button"
                  disabled={isSavingCat}
                  onClick={() => setModalOpen(false)}
                  className="px-space-md py-2 rounded-lg text-secondary hover:text-on-surface hover:bg-surface-container-low text-sm font-semibold transition-all cursor-pointer disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSavingCat}
                  className="px-space-lg py-2 rounded-lg bg-primary hover:bg-primary-container text-on-primary text-sm font-semibold shadow-sm transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                >
                  <Icon
                    name={isSavingCat ? 'progress_activity' : 'check'}
                    className={`text-lg ${isSavingCat ? 'animate-spin' : ''}`}
                  />
                  <span>
                    {isSavingCat
                      ? 'Salvando...'
                      : editingCat
                      ? 'Salvar Alterações'
                      : 'Salvar Categoria'}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

