import { User } from '@supabase/supabase-js';
import {
  createEmptyUserProfile,
  formatDateGroupPT,
  formatDateLabelPT,
  getMonthLabelFromKey,
  getTodayIso,
} from '../data/initialData';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import {
  AccountItem,
  AccountType,
  Category,
  DataSourceMode,
  GoalItem,
  GoalStatus,
  Subcategory,
  Transaction,
  TransactionStatus,
  TransactionType,
  UserProfile,
} from '../types/finance';
import { computeMonthsRemaining } from './analyticsService';

export class FinanceServiceError extends Error {
  public readonly isSessionExpired: boolean;
  public readonly isNetworkError: boolean;
  public readonly messagePT: string;

  constructor(params: {
    messagePT: string;
    isSessionExpired?: boolean;
    isNetworkError?: boolean;
    cause?: unknown;
  }) {
    super(params.messagePT);
    this.name = 'FinanceServiceError';
    this.messagePT = params.messagePT;
    this.isSessionExpired = Boolean(params.isSessionExpired);
    this.isNetworkError = Boolean(params.isNetworkError);
  }
}

export interface UserFinancePayload {
  mode: DataSourceMode;
  transactions: Transaction[];
  categories: Category[];
  accounts: AccountItem[];
  goals: GoalItem[];
  profile: UserProfile;
}

export interface TransactionMutationResult {
  transaction: Transaction;
  autoCreatedCategory?: Category;
  autoCreatedAccount?: AccountItem;
}

export function getDataSourceMode(): DataSourceMode {
  return isSupabaseConfigured && supabase ? 'supabase' : 'local';
}

// === OPTIONAL DISPLAY METADATA KEYED BY REAL SUPABASE ROW UUID ===
// Keeps non-schema visual preferences (icons, budgets, account modality badges, goal status)
// associated with real database UUIDs without adding extra columns or tables.

interface CategoryUiMeta {
  icon?: string;
  colorClass?: string;
  budget?: number;
  subcategories?: Subcategory[];
}

interface AccountUiMeta {
  institutionCode?: string;
  badgeText?: string;
  type?: AccountType;
  limit?: number;
  dueDate?: string;
  statusText?: string;
  accentTheme?: AccountItem['accentTheme'];
}

interface GoalUiMeta {
  category?: string;
  priorityBadge?: string;
  icon?: string;
  theme?: GoalItem['theme'];
  status?: GoalStatus;
  linkedAccount?: string;
  completedDateLabel?: string;
}

interface TransactionUiMeta {
  subcategory?: string;
  time?: string;
  method?: string;
  icon?: string;
  status?: TransactionStatus;
  recurring?: boolean;
}

interface ProfileUiMeta {
  avatarHeaderUrl?: string;
  avatarPortraitUrl?: string;
}

interface UserUiMetaStore {
  categories: Record<string, CategoryUiMeta>;
  accounts: Record<string, AccountUiMeta>;
  goals: Record<string, GoalUiMeta>;
  transactions: Record<string, TransactionUiMeta>;
  profile?: ProfileUiMeta;
}

function getUiMetaStorageKey(userId: string): string {
  return `financerto_ui_meta_${userId}`;
}

function readUserUiMeta(userId: string): UserUiMetaStore {
  const empty: UserUiMetaStore = {
    categories: {},
    accounts: {},
    goals: {},
    transactions: {},
    profile: undefined,
  };
  if (typeof window === 'undefined' || !userId) return empty;
  try {
    const raw = window.localStorage.getItem(getUiMetaStorageKey(userId));
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<UserUiMetaStore>;
    return {
      categories: parsed.categories || {},
      accounts: parsed.accounts || {},
      goals: parsed.goals || {},
      transactions: parsed.transactions || {},
      profile: parsed.profile,
    };
  } catch {
    return empty;
  }
}

function writeUserUiMeta(userId: string, store: UserUiMetaStore): void {
  if (typeof window === 'undefined' || !userId) return;
  try {
    window.localStorage.setItem(getUiMetaStorageKey(userId), JSON.stringify(store));
  } catch {
    // Ignore storage quota errors
  }
}

// === TYPE CHECK-CONSTRAINT CONVENTION DETECTION ('en' vs 'pt') ===
type DbTypeConvention = 'en' | 'pt';
let detectedTypeConvention: DbTypeConvention = 'en';

function recordObservedTypeValue(rawType: unknown): void {
  const lower = String(rawType || '').trim().toLowerCase();
  if (lower === 'income' || lower === 'expense') {
    detectedTypeConvention = 'en';
  } else if (lower === 'receita' || lower === 'despesa') {
    detectedTypeConvention = 'pt';
  }
}

function toDbTypeValue(type: TransactionType, convention: DbTypeConvention): string {
  if (convention === 'en') {
    return type === 'receita' ? 'income' : 'expense';
  }
  return type;
}

export function getDetectedDbTypeConvention(): DbTypeConvention {
  return detectedTypeConvention;
}

function isTypeConstraintError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String((error as { code?: unknown }).code || '') : '';
  const msg =
    'message' in error
      ? String((error as { message?: unknown }).message || '').toLowerCase()
      : '';
  return (
    code === '23514' ||
    code === '22P02' ||
    msg.includes('check constraint') ||
    msg.includes('type_check') ||
    msg.includes('invalid input value for enum')
  );
}

function isNotNullColumnError(error: unknown, columnName: string): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String((error as { code?: unknown }).code || '') : '';
  const msg =
    'message' in error
      ? String((error as { message?: unknown }).message || '').toLowerCase()
      : '';
  return code === '23502' && msg.includes(columnName.toLowerCase());
}

function classifySupabaseError(error: unknown, fallbackMessagePT: string): FinanceServiceError {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code || '')
      : '';
  const msg =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message?: unknown }).message || '')
      : String(error || '');
  const lower = msg.toLowerCase();

  if (lower.includes('invalid api key') || lower.includes('no api key found')) {
    return new FinanceServiceError({
      messagePT:
        'Configuração inválida: a chave pública VITE_SUPABASE_ANON_KEY foi rejeitada pelo projeto Supabase.',
      cause: error,
    });
  }

  if (
    code === 'PGRST301' ||
    code === '401' ||
    lower.includes('jwt expired') ||
    lower.includes('invalid jwt') ||
    lower.includes('session_not_found') ||
    lower.includes('refresh_token_not_found')
  ) {
    return new FinanceServiceError({
      messagePT: 'Sua sessão expirou por segurança. Faça login novamente.',
      isSessionExpired: true,
      cause: error,
    });
  }

  if (
    lower.includes('failed to fetch') ||
    lower.includes('fetch failed') ||
    lower.includes('networkerror') ||
    lower.includes('network request failed') ||
    lower.includes('load failed')
  ) {
    const isOffline =
      typeof navigator !== 'undefined' && navigator.onLine === false;
    return new FinanceServiceError({
      messagePT: isOffline
        ? 'Sem conexão com a internet. Verifique sua rede e tente novamente.'
        : 'Falha de conexão com o servidor do Supabase. Verifique sua conexão e tente novamente.',
      isNetworkError: true,
      cause: error,
    });
  }

  if (code === '42501' || lower.includes('row-level security')) {
    return new FinanceServiceError({
      messagePT:
        'Operação bloqueada pelas políticas de segurança (RLS). Confirme se as políticas do banco permitem acesso ao seu user_id.',
      cause: error,
    });
  }

  if (code === '42P01' || code === 'PGRST205') {
    return new FinanceServiceError({
      messagePT:
        'Tabela não encontrada no esquema público do Supabase. Verifique se todas as tabelas do projeto foram criadas.',
      cause: error,
    });
  }

  if (code === '23503' || lower.includes('foreign key constraint')) {
    return new FinanceServiceError({
      messagePT:
        'Não foi possível concluir a operação devido a um vínculo entre conta/categoria e movimentação.',
      cause: error,
    });
  }

  if (code === '23514' || lower.includes('check constraint')) {
    return new FinanceServiceError({
      messagePT:
        'Dados inválidos para o banco de dados: verifique se o tipo (income/expense) e o valor positivo estão corretos.',
      cause: error,
    });
  }

  if (code === '23505' || lower.includes('duplicate key')) {
    return new FinanceServiceError({
      messagePT: 'Já existe um registro com esses mesmos dados.',
      cause: error,
    });
  }

  if (code === 'PGRST116') {
    return new FinanceServiceError({
      messagePT:
        'Nenhum registro foi atualizado. Verifique se o lançamento existe e se a política RLS de edição (FOR UPDATE) está ativa.',
      cause: error,
    });
  }

  return new FinanceServiceError({
    messagePT: code ? `${fallbackMessagePT} (código: ${code})` : fallbackMessagePT,
    cause: error,
  });
}

async function requireAuthenticatedUserId(): Promise<string> {
  if (!isSupabaseConfigured || !supabase) {
    throw new FinanceServiceError({
      messagePT: 'Conexão com o Supabase não configurada.',
    });
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  let activeSession = sessionData.session;

  const isExpiringSoon =
    activeSession?.expires_at !== undefined &&
    activeSession.expires_at * 1000 < Date.now() + 10_000;

  if ((!activeSession || isExpiringSoon) && !sessionError) {
    const refreshed = await supabase.auth.refreshSession();
    if (!refreshed.error && refreshed.data.session) {
      activeSession = refreshed.data.session;
    }
  }

  if (
    activeSession?.user?.id &&
    isValidUuid(activeSession.user.id) &&
    Boolean(activeSession.access_token)
  ) {
    return activeSession.user.id;
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user?.id || !isValidUuid(userData.user.id)) {
    throw new FinanceServiceError({
      messagePT: 'Sessão inválida ou expirada. Faça login novamente para continuar.',
      isSessionExpired: true,
    });
  }

  return userData.user.id;
}

function isValidUuid(val?: string): boolean {
  if (!val) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
}

/**
 * Safely parses Brazilian currency strings ("3.500,00", "3.500", "150,50") and decimal inputs ("150.50").
 * Returns 0 for empty, zero, negative, or non-numeric inputs.
 */
export function parsePositiveBrlAmount(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith('-')) return 0;

  // Strip currency symbol and spaces while keeping digits, dots, commas, and minus sign check
  const cleanedTokens = trimmed.replace(/[R$\s]/g, '');
  if (!cleanedTokens || cleanedTokens.startsWith('-')) return 0;

  let normalized: string;
  if (cleanedTokens.includes(',')) {
    // Brazilian format: dots are thousands separators, comma is decimal separator ("3.500,75" -> "3500.75")
    normalized = cleanedTokens.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(cleanedTokens)) {
    // Ambiguous thousands-grouped integer in pt-BR ("3.500" or "1.250.000" -> "3500" / "1250000")
    normalized = cleanedTokens.replace(/\./g, '');
  } else {
    // Plain number or dot-decimal ("3500" or "420.50")
    normalized = cleanedTokens;
  }

  const sanitized = normalized.replace(/[^\d.]/g, '');
  const parts = sanitized.split('.');
  if (parts.length > 2) return 0;

  const parsed = Number.parseFloat(sanitized);
  return Number.isFinite(parsed) && parsed > 0 ? Number(parsed.toFixed(2)) : 0;
}

function inferCategoryIcon(name: string, type: TransactionType): string {
  const lower = name.toLowerCase();
  if (type === 'receita') {
    if (lower.includes('salár') || lower.includes('salar') || lower.includes('remunera')) {
      return 'payments';
    }
    if (lower.includes('freela') || lower.includes('servi') || lower.includes('projeto')) {
      return 'design_services';
    }
    if (lower.includes('rendim') || lower.includes('invest') || lower.includes('dividend')) {
      return 'trending_up';
    }
    return 'payments';
  }
  if (lower.includes('moradia') || lower.includes('aluguel') || lower.includes('casa')) return 'home';
  if (lower.includes('alimenta') || lower.includes('mercado') || lower.includes('restaur')) {
    return 'restaurant';
  }
  if (lower.includes('transp') || lower.includes('uber') || lower.includes('carro')) {
    return 'directions_car';
  }
  if (lower.includes('saúde') || lower.includes('saude') || lower.includes('farm')) return 'favorite';
  if (lower.includes('lazer') || lower.includes('viagem') || lower.includes('stream')) {
    return 'sports_esports';
  }
  if (lower.includes('educa') || lower.includes('curso') || lower.includes('escola')) return 'school';
  if (lower.includes('meta') || lower.includes('reserva')) return 'savings';
  return 'sell';
}

function inferColorClassFromHex(hex: string, type: TransactionType): string {
  const lower = hex.toLowerCase();
  if (type === 'receita') return 'primary';
  if (lower.includes('2170') || lower.includes('0058') || lower.includes('2563')) return 'tertiary';
  if (lower.includes('f59e') || lower.includes('d977')) return 'amber';
  if (lower.includes('0891') || lower.includes('06b6')) return 'cyan';
  if (lower.includes('f43f') || lower.includes('ba1a') || lower.includes('ef44')) return 'rose';
  if (lower.includes('9333') || lower.includes('7c3a')) return 'purple';
  return 'primary';
}

function inferAccountDefaultsFromName(name: string): {
  type: AccountType;
  code: string;
  badge: string;
  theme: AccountItem['accentTheme'];
} {
  const lower = name.toLowerCase();
  const cleanLetters = name.replace(/[^a-zA-ZÀ-ÿ]/g, '').slice(0, 2).toUpperCase() || 'BK';

  if (
    lower.includes('invest') ||
    lower.includes('corretora') ||
    lower.includes('btg') ||
    lower.includes('xp')
  ) {
    return {
      type: 'investment',
      code: name.replace(/[^a-zA-ZÀ-ÿ]/g, '').slice(0, 3).toUpperCase() || 'INV',
      badge: 'Investimentos',
      theme: 'blue',
    };
  }
  if (lower.includes('carteira')) {
    return { type: 'savings', code: 'CT', badge: 'Carteira', theme: 'amber' };
  }
  if (lower.includes('poup') || lower.includes('reserva') || lower.includes('caixinha')) {
    return {
      type: 'savings',
      code: cleanLetters || 'SV',
      badge: 'Reserva / Poupança',
      theme: 'amber',
    };
  }
  if (lower.includes('pj') || lower.includes('empresa')) {
    return { type: 'business', code: 'PJ', badge: 'Conta PJ', theme: 'slate' };
  }

  const theme: AccountItem['accentTheme'] = lower.includes('nu')
    ? 'purple'
    : lower.includes('ita') || lower.includes('inter')
    ? 'orange'
    : 'blue';
  return { type: 'checking', code: cleanLetters, badge: 'Conta Corrente', theme };
}

// === ROW MAPPERS (EXACT SUPABASE SCHEMA) ===

export function mapCategoryRow(
  row: Record<string, unknown>,
  uiMeta?: CategoryUiMeta
): Category {
  recordObservedTypeValue(row.type);
  const rawType = String(row.type || 'expense').toLowerCase();
  const type: TransactionType =
    rawType === 'receita' || rawType === 'income' ? 'receita' : 'despesa';
  const name = String(row.name || 'Categoria').trim() || 'Categoria';
  const rawColor = String(row.color || '#006948').trim();
  const hexColor = /^#[0-9a-fA-F]{6}$/.test(rawColor) ? rawColor.toLowerCase() : '#006948';

  const subcategories: Subcategory[] =
    uiMeta?.subcategories && uiMeta.subcategories.length > 0 ? uiMeta.subcategories : [];

  return {
    id: String(row.id),
    name,
    type,
    icon: uiMeta?.icon || inferCategoryIcon(name, type),
    colorClass: uiMeta?.colorClass || inferColorClassFromHex(hexColor, type),
    hexColor,
    budget: Number(uiMeta?.budget ?? 0),
    spent: 0,
    transactionsCount: 0,
    subcategories,
  };
}

export function mapAccountRow(
  row: Record<string, unknown>,
  uiMeta?: AccountUiMeta
): AccountItem {
  const name = String(row.name || 'Conta').trim() || 'Conta';
  const inferred = inferAccountDefaultsFromName(name);
  const type: AccountType = uiMeta?.type || inferred.type;
  const rawInitial = Number(row.initial_balance ?? 0);
  const initialBalance = Number.isFinite(rawInitial) ? Number(rawInitial.toFixed(2)) : 0;

  return {
    id: String(row.id),
    name,
    institutionCode: uiMeta?.institutionCode || inferred.code,
    badgeText: uiMeta?.badgeText || inferred.badge,
    type,
    openFinance: false,
    initialBalance,
    balance: initialBalance, // Dynamically enriched with transactions by computeAccountsWithCalculatedBalance
    calculatedInflows: 0,
    calculatedOutflows: 0,
    limit: uiMeta?.limit,
    dueDate: uiMeta?.dueDate,
    statusText: uiMeta?.statusText,
    metaRow1Label: 'Saldo Inicial',
    metaRow1Value: `R$ ${initialBalance.toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`,
    metaRow2Label: 'Status',
    metaRow2Value: 'Sincronizada',
    metaRow2Highlight: true,
    accentTheme: uiMeta?.accentTheme || inferred.theme,
  };
}

export function mapTransactionRow(
  row: Record<string, unknown>,
  categoriesById: Map<string, Category>,
  accountsById: Map<string, AccountItem>,
  uiMeta?: TransactionUiMeta
): Transaction {
  recordObservedTypeValue(row.type);
  const rawDate = String(row.transaction_date || row.date || getTodayIso()).slice(0, 10);
  const rawType = String(row.type || 'expense').toLowerCase();
  const type: TransactionType =
    rawType === 'receita' || rawType === 'income' ? 'receita' : 'despesa';

  const categoryId = row.category_id ? String(row.category_id) : undefined;
  const accountId = row.account_id ? String(row.account_id) : undefined;

  const joinedCategory =
    row.categories && typeof row.categories === 'object' && !Array.isArray(row.categories)
      ? (row.categories as Record<string, unknown>)
      : undefined;
  const joinedAccount =
    row.accounts && typeof row.accounts === 'object' && !Array.isArray(row.accounts)
      ? (row.accounts as Record<string, unknown>)
      : undefined;

  const matchedCat = categoryId ? categoriesById.get(categoryId) : undefined;
  const matchedAcc = accountId ? accountsById.get(accountId) : undefined;

  const categoryName = String(
    matchedCat?.name || joinedCategory?.name || 'Sem categoria'
  );
  const accountName = String(
    matchedAcc?.name || joinedAccount?.name || 'Sem conta'
  );

  const notesStr =
    row.notes !== null && row.notes !== undefined ? String(row.notes).trim() : '';

  const title = String(row.description || '').trim() || (type === 'receita' ? 'Receita' : 'Despesa');
  const status: TransactionStatus = uiMeta?.status || 'efetivado';
  const method = uiMeta?.method || (matchedAcc?.type === 'credit' ? 'Cartão Crédito' : 'Pix');
  const time =
    uiMeta?.time ||
    (typeof row.created_at === 'string' && row.created_at.length >= 16
      ? new Date(row.created_at).toLocaleTimeString('pt-BR', {
          hour: '2-digit',
          minute: '2-digit',
        })
      : '12:00');

  const subtitleParts: string[] = [];
  if (notesStr) {
    subtitleParts.push(notesStr);
  } else if (uiMeta?.subcategory) {
    subtitleParts.push(uiMeta.subcategory);
  } else {
    subtitleParts.push(type === 'receita' ? 'Receita' : 'Despesa');
  }
  if (accountId || joinedAccount?.name) {
    subtitleParts.push(accountName);
  }
  const subtitle = subtitleParts.join(' · ');

  return {
    id: String(row.id),
    userId: row.user_id ? String(row.user_id) : undefined,
    title,
    subtitle,
    category: categoryName,
    categoryId,
    subcategory: uiMeta?.subcategory,
    account: accountName,
    accountId,
    accountIcon: matchedAcc?.type === 'credit' ? 'credit_card' : 'account_balance',
    type,
    amount: Math.abs(Number(row.amount || 0)),
    date: rawDate,
    dateLabel: formatDateLabelPT(rawDate),
    dateGroup: formatDateGroupPT(rawDate),
    time,
    method,
    icon:
      uiMeta?.icon ||
      matchedCat?.icon ||
      inferCategoryIcon(categoryName, type),
    status,
    recurring: Boolean(uiMeta?.recurring),
    tags: notesStr || undefined,
    notes: notesStr || undefined,
  };
}

export function formatGoalDateBR(isoDate: string): string {
  const clean = (isoDate || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) return 'Sem data limite';
  const [yr, mm, dd] = clean.split('-');
  return `${dd}/${mm}/${yr}`;
}

/**
 * Parses Brazilian ("10.000,50", "1500,50", "0") and standard decimal ("1500.50") inputs
 * for goal `target_amount` and `current_amount`.
 * Returns `NaN` when empty (unless `allowEmptyAsZero` is true) or non-numeric.
 */
export function parseGoalAmountInput(
  raw: string | number,
  allowEmptyAsZero = false
): number {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? Number(raw.toFixed(2)) : Number.NaN;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return allowEmptyAsZero ? 0 : Number.NaN;
  }

  const withoutCurrency = trimmed.replace(/[R$\s]/g, '');
  if (!withoutCurrency) {
    return allowEmptyAsZero ? 0 : Number.NaN;
  }

  const isNegative = withoutCurrency.startsWith('-');
  const unsigned = withoutCurrency.replace(/^[+-]/, '');
  if (!unsigned || !/\d/.test(unsigned)) return Number.NaN;

  let normalized: string;
  if (unsigned.includes(',')) {
    normalized = unsigned.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(unsigned)) {
    normalized = unsigned.replace(/\./g, '');
  } else {
    normalized = unsigned;
  }

  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    return Number.NaN;
  }

  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed)) return Number.NaN;
  const signed = isNegative ? -parsed : parsed;
  return signed === 0 ? 0 : Number(signed.toFixed(2));
}

export function validateGoalPayload(params: {
  name: string;
  targetAmount: string | number;
  currentAmount: string | number;
  targetDateIso?: string | null;
  requireDate?: boolean;
}): {
  cleanName: string;
  targetAmount: number;
  currentAmount: number;
  targetDate: string | null;
} {
  const cleanName = (params.name || '').trim().replace(/\s+/g, ' ');
  if (!cleanName) {
    throw new FinanceServiceError({
      messagePT: 'Informe o nome da meta financeira.',
    });
  }

  const targetAmount = parseGoalAmountInput(params.targetAmount, false);
  if (!Number.isFinite(targetAmount) || targetAmount <= 0) {
    throw new FinanceServiceError({
      messagePT: 'O valor desejado da meta deve ser maior que zero.',
    });
  }

  const currentAmount = parseGoalAmountInput(params.currentAmount, true);
  if (!Number.isFinite(currentAmount) || currentAmount < 0) {
    throw new FinanceServiceError({
      messagePT: 'O valor já acumulado deve ser igual ou maior que zero.',
    });
  }

  const rawDate = params.targetDateIso ? String(params.targetDateIso).trim().slice(0, 10) : '';
  if (params.requireDate && !rawDate) {
    throw new FinanceServiceError({
      messagePT: 'Informe a data limite desejada para a meta.',
    });
  }

  if (rawDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
      throw new FinanceServiceError({
        messagePT: 'Informe uma data limite válida (AAAA-MM-DD).',
      });
    }
    const [y, m, d] = rawDate.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (
      Number.isNaN(dt.getTime()) ||
      dt.getUTCFullYear() !== y ||
      dt.getUTCMonth() !== m - 1 ||
      dt.getUTCDate() !== d
    ) {
      throw new FinanceServiceError({
        messagePT: 'A data limite informada não é uma data válida.',
      });
    }
  }

  return {
    cleanName,
    targetAmount,
    currentAmount,
    targetDate: rawDate || null,
  };
}

export function mapGoalRow(
  row: Record<string, unknown>,
  uiMeta?: GoalUiMeta
): GoalItem {
  const rawDate = row.target_date ? String(row.target_date).slice(0, 10) : '';
  const hasValidDate = Boolean(rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate));
  const targetIso = hasValidDate ? rawDate : '';

  const rawCurrent = Number(row.current_amount ?? 0);
  const currentAmount =
    Number.isFinite(rawCurrent) && rawCurrent >= 0 ? Number(rawCurrent.toFixed(2)) : 0;

  const rawTarget = Number(row.target_amount ?? 0);
  const targetAmount =
    Number.isFinite(rawTarget) && rawTarget > 0 ? Number(rawTarget.toFixed(2)) : 0.01;

  const isReached = currentAmount >= targetAmount;
  const savedStatus = uiMeta?.status || 'active';
  const status: GoalStatus = isReached
    ? 'completed'
    : savedStatus === 'paused'
    ? 'paused'
    : 'active';

  const monthsRem = hasValidDate ? computeMonthsRemaining(targetIso) : 1;

  return {
    id: String(row.id),
    name: String(row.name || 'Meta Financeira').trim() || 'Meta Financeira',
    category: uiMeta?.category || 'Planejamento Financeiro',
    priorityBadge: isReached
      ? '100% Conquistado!'
      : uiMeta?.priorityBadge || 'Médio Prazo',
    icon: uiMeta?.icon || 'flag',
    theme: uiMeta?.theme || 'primary',
    currentAmount,
    targetAmount,
    targetDateIso: targetIso,
    targetDateLabel: hasValidDate ? formatGoalDateBR(targetIso) : 'Sem data limite',
    monthsRemainingLabel: isReached
      ? 'Meta concluída'
      : hasValidDate
      ? `Restam ${monthsRem} ${monthsRem === 1 ? 'mês' : 'meses'}`
      : 'Prazo aberto',
    monthlyContribution: isReached
      ? 0
      : Math.ceil(Math.max(0, targetAmount - currentAmount) / monthsRem),
    paceStatus: isReached ? 'completed' : 'ideal',
    status,
    linkedAccount: uiMeta?.linkedAccount || 'Carteira Geral',
    completedDateLabel: isReached
      ? uiMeta?.completedDateLabel || 'Objetivo concluído'
      : undefined,
  };
}

export function validateProfileFullName(rawName: string): string {
  const cleanName = (rawName || '').trim().replace(/\s+/g, ' ');
  if (!cleanName) {
    throw new FinanceServiceError({
      messagePT: 'Informe seu nome completo para salvar o perfil.',
    });
  }
  if (cleanName.length < 2) {
    throw new FinanceServiceError({
      messagePT: 'O nome completo deve ter pelo menos 2 caracteres.',
    });
  }
  if (cleanName.length > 120) {
    throw new FinanceServiceError({
      messagePT: 'O nome completo deve ter no máximo 120 caracteres.',
    });
  }
  return cleanName;
}

export function mapProfileRow(
  row: Record<string, unknown> | undefined,
  authUser: User,
  profileUiMeta?: ProfileUiMeta
): UserProfile {
  const meta = (authUser.user_metadata || {}) as Record<string, unknown>;
  const metaFullName = typeof meta.full_name === 'string' ? meta.full_name : '';
  const rowCreatedAt =
    row && typeof row.created_at === 'string' && row.created_at
      ? row.created_at
      : authUser.created_at;

  const base = createEmptyUserProfile({
    id: authUser.id,
    fullName: metaFullName,
    email: authUser.email,
    createdAt: rowCreatedAt,
  });

  const dbFullName =
    row && typeof row.full_name === 'string' ? row.full_name.trim() : '';
  const dbLegacyName =
    row && typeof row.name === 'string' ? row.name.trim() : '';
  const rowEmail =
    row && typeof row.email === 'string' ? row.email.trim() : '';

  return {
    ...base,
    name: dbFullName || dbLegacyName || base.name,
    email: authUser.email || rowEmail || base.email,
    phone: typeof meta.phone === 'string' ? meta.phone : base.phone,
    occupation: typeof meta.occupation === 'string' ? meta.occupation : base.occupation,
    plan: typeof meta.plan === 'string' ? meta.plan : base.plan,
    supabaseId: row?.id ? String(row.id) : authUser.id,
    avatarHeaderUrl: profileUiMeta?.avatarHeaderUrl || base.avatarHeaderUrl,
    avatarPortraitUrl: profileUiMeta?.avatarPortraitUrl || base.avatarPortraitUrl,
    currency: typeof meta.currency === 'string' ? meta.currency : base.currency,
    fiscalMonthStart:
      typeof meta.fiscal_month_start === 'string'
        ? meta.fiscal_month_start
        : base.fiscalMonthStart,
    dateFormat: typeof meta.date_format === 'string' ? meta.date_format : base.dateFormat,
    budgetCeilingAlert:
      typeof meta.budget_ceiling_alert === 'boolean'
        ? meta.budget_ceiling_alert
        : base.budgetCeilingAlert,
    twoFactorEnabled:
      typeof meta.two_factor_enabled === 'boolean'
        ? meta.two_factor_enabled
        : base.twoFactorEnabled,
  };
}

// === LOAD ALL AUTHENTICATED USER DATA FROM SUPABASE ===

export async function loadUserFinanceData(authUser: User): Promise<UserFinancePayload> {
  const userId = await requireAuthenticatedUserId();
  const uiMeta = readUserUiMeta(userId);

  const [accRes, catRes, txRes, goalRes, profRes] = await Promise.all([
    supabase!
      .from('accounts')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true }),
    supabase!
      .from('categories')
      .select('*')
      .eq('user_id', userId)
      .order('name', { ascending: true }),
    supabase!
      .from('transactions')
      .select(
        'id, user_id, account_id, category_id, type, description, amount, transaction_date, notes, created_at, accounts(id, name), categories(id, name, type, color)'
      )
      .eq('user_id', userId)
      .order('transaction_date', { ascending: false })
      .order('created_at', { ascending: false }),
    supabase!
      .from('goals')
      .select('id, user_id, name, target_amount, current_amount, target_date, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false }),
    supabase!
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle(),
  ]);

  if (accRes.error) {
    throw classifySupabaseError(accRes.error, 'Não foi possível carregar suas contas.');
  }
  if (catRes.error) {
    throw classifySupabaseError(catRes.error, 'Não foi possível carregar suas categorias.');
  }

  let txRows: Record<string, unknown>[] = [];
  if (txRes.error) {
    // Fallback without FK joins if needed
    const fallbackTx = await supabase!
      .from('transactions')
      .select(
        'id, user_id, account_id, category_id, type, description, amount, transaction_date, notes, created_at'
      )
      .eq('user_id', userId)
      .order('transaction_date', { ascending: false })
      .order('created_at', { ascending: false });
    if (fallbackTx.error) {
      throw classifySupabaseError(
        fallbackTx.error,
        'Não foi possível carregar suas movimentações.'
      );
    }
    txRows = (fallbackTx.data || []) as Record<string, unknown>[];
  } else {
    txRows = (txRes.data || []) as Record<string, unknown>[];
  }

  if (goalRes.error) {
    throw classifySupabaseError(goalRes.error, 'Não foi possível carregar suas metas.');
  }
  if (profRes.error) {
    throw classifySupabaseError(profRes.error, 'Não foi possível carregar os dados do seu perfil.');
  }

  const accRows = (accRes.data || []) as Record<string, unknown>[];
  const catRows = (catRes.data || []) as Record<string, unknown>[];
  const goalRows = (goalRes.data || []) as Record<string, unknown>[];
  const rawProfRow = (profRes.data || undefined) as Record<string, unknown> | undefined;
  const profRow =
    rawProfRow && (!rawProfRow.id || String(rawProfRow.id) === userId)
      ? rawProfRow
      : undefined;

  const accounts = accRows
    .filter((row) => !row.user_id || String(row.user_id) === userId)
    .map((row) => mapAccountRow(row, uiMeta.accounts[String(row.id)]));
  const categories = catRows
    .filter((row) => !row.user_id || String(row.user_id) === userId)
    .map((row) => mapCategoryRow(row, uiMeta.categories[String(row.id)]));
  const goals = goalRows
    .filter((row) => !row.user_id || String(row.user_id) === userId)
    .map((row) => mapGoalRow(row, uiMeta.goals[String(row.id)]));

  const categoriesById = new Map(categories.map((c) => [c.id, c]));
  const accountsById = new Map(accounts.map((a) => [a.id, a]));

  const transactions = txRows
    .filter((row) => !row.user_id || String(row.user_id) === userId)
    .map((row) =>
      mapTransactionRow(
        row,
        categoriesById,
        accountsById,
        uiMeta.transactions[String(row.id)]
      )
    );
  const profile = mapProfileRow(profRow, authUser, uiMeta.profile);

  return {
    mode: 'supabase',
    transactions,
    categories,
    accounts,
    goals,
    profile,
  };
}

// === CATEGORIES CRUD (`public.categories`: id, user_id, name, type, color, created_at) ===

export function normalizeCategoryNameKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function normalizeCategoryHexColor(color?: string): string {
  const trimmed = (color || '').trim();
  if (!trimmed) return '#006948';
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  throw new FinanceServiceError({
    messagePT: 'Selecione uma cor hexadecimal válida (ex: #006948).',
  });
}

export function isDuplicateCategoryForType(
  existingCategories: Array<{ id?: string; name: string; type: string }>,
  candidateName: string,
  candidateType: TransactionType,
  excludeId?: string
): boolean {
  const targetKey = normalizeCategoryNameKey(candidateName);
  if (!targetKey) return false;

  return existingCategories.some((item) => {
    if (excludeId && item.id && String(item.id) === excludeId) {
      return false;
    }
    const rawItemType = String(item.type || '').trim().toLowerCase();
    const itemType: TransactionType =
      rawItemType === 'receita' || rawItemType === 'income' ? 'receita' : 'despesa';
    return itemType === candidateType && normalizeCategoryNameKey(item.name) === targetKey;
  });
}

async function assertNoDuplicateCategoryInDb(
  userId: string,
  name: string,
  type: TransactionType,
  excludeId?: string
): Promise<void> {
  const { data, error } = await supabase!
    .from('categories')
    .select('id, name, type')
    .eq('user_id', userId);

  if (error) {
    throw classifySupabaseError(
      error,
      'Não foi possível verificar categorias existentes no banco de dados.'
    );
  }

  const rows = ((data || []) as Array<Record<string, unknown>>).map((row) => ({
    id: row.id ? String(row.id) : undefined,
    name: String(row.name || ''),
    type: String(row.type || ''),
  }));

  if (isDuplicateCategoryForType(rows, name, type, excludeId)) {
    const cleanDisplay = name.trim().replace(/\s+/g, ' ');
    throw new FinanceServiceError({
      messagePT: `Já existe uma categoria de ${
        type === 'receita' ? 'receita' : 'despesa'
      } com o nome "${cleanDisplay}". Escolha outro nome.`,
    });
  }
}

export async function listCategoriesFromDb(): Promise<Category[]> {
  const userId = await requireAuthenticatedUserId();
  const uiMeta = readUserUiMeta(userId);

  const { data, error } = await supabase!
    .from('categories')
    .select('id, user_id, name, type, color, created_at')
    .eq('user_id', userId)
    .order('name', { ascending: true });

  if (error) {
    throw classifySupabaseError(error, 'Não foi possível carregar suas categorias.');
  }

  return ((data || []) as Record<string, unknown>[])
    .filter((row) => !row.user_id || String(row.user_id) === userId)
    .map((row) => mapCategoryRow(row, uiMeta.categories[String(row.id)]));
}

async function insertCategoryRowWithTypeRetry(
  userId: string,
  name: string,
  type: TransactionType,
  color: string
): Promise<Record<string, unknown>> {
  const cleanName = name.trim().replace(/\s+/g, ' ');
  if (!cleanName) {
    throw new FinanceServiceError({
      messagePT: 'Informe o nome da categoria.',
    });
  }
  const cleanColor = normalizeCategoryHexColor(color);
  const firstConvention = detectedTypeConvention;

  const firstAttempt = await supabase!
    .from('categories')
    .insert({
      user_id: userId,
      name: cleanName,
      type: toDbTypeValue(type, firstConvention),
      color: cleanColor,
    })
    .select('id, user_id, name, type, color, created_at')
    .single();

  if (!firstAttempt.error && firstAttempt.data) {
    return firstAttempt.data as Record<string, unknown>;
  }

  if (firstAttempt.error?.code === '23505') {
    throw new FinanceServiceError({
      messagePT: `Já existe uma categoria de ${
        type === 'receita' ? 'receita' : 'despesa'
      } com o nome "${cleanName}". Escolha outro nome.`,
      cause: firstAttempt.error,
    });
  }

  if (isTypeConstraintError(firstAttempt.error)) {
    const altConvention: DbTypeConvention = firstConvention === 'en' ? 'pt' : 'en';
    const secondAttempt = await supabase!
      .from('categories')
      .insert({
        user_id: userId,
        name: cleanName,
        type: toDbTypeValue(type, altConvention),
        color: cleanColor,
      })
      .select('id, user_id, name, type, color, created_at')
      .single();

    if (!secondAttempt.error && secondAttempt.data) {
      detectedTypeConvention = altConvention;
      return secondAttempt.data as Record<string, unknown>;
    }
    if (secondAttempt.error?.code === '23505') {
      throw new FinanceServiceError({
        messagePT: `Já existe uma categoria de ${
          type === 'receita' ? 'receita' : 'despesa'
        } com o nome "${cleanName}". Escolha outro nome.`,
        cause: secondAttempt.error,
      });
    }
    throw classifySupabaseError(secondAttempt.error, 'Não foi possível criar a categoria.');
  }

  throw classifySupabaseError(firstAttempt.error, 'Não foi possível criar a categoria.');
}

async function verifyCategoryUpdateNotBlockedByRls(id: string, userId: string): Promise<never> {
  const checkExisting = await supabase!
    .from('categories')
    .select('id')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();

  if (!checkExisting.error && checkExisting.data) {
    throw new FinanceServiceError({
      messagePT:
        'A política RLS do Supabase impediu a edição desta categoria (verifique a política FOR UPDATE na tabela categories).',
    });
  }

  throw new FinanceServiceError({
    messagePT: 'Categoria não encontrada ou você não tem permissão para alterá-la.',
  });
}

async function updateCategoryRowWithTypeRetry(
  id: string,
  userId: string,
  name: string,
  type: TransactionType,
  color: string
): Promise<Record<string, unknown>> {
  if (!isValidUuid(id)) {
    throw new FinanceServiceError({
      messagePT: 'Identificador da categoria inválido para edição.',
    });
  }
  const cleanName = name.trim().replace(/\s+/g, ' ');
  if (!cleanName) {
    throw new FinanceServiceError({
      messagePT: 'Informe o nome da categoria.',
    });
  }
  const cleanColor = normalizeCategoryHexColor(color);
  const firstConvention = detectedTypeConvention;

  const firstAttempt = await supabase!
    .from('categories')
    .update({
      user_id: userId,
      name: cleanName,
      type: toDbTypeValue(type, firstConvention),
      color: cleanColor,
    })
    .eq('id', id)
    .eq('user_id', userId)
    .select('id, user_id, name, type, color, created_at')
    .maybeSingle();

  if (!firstAttempt.error && firstAttempt.data) {
    return firstAttempt.data as Record<string, unknown>;
  }

  if (!firstAttempt.error && !firstAttempt.data) {
    return verifyCategoryUpdateNotBlockedByRls(id, userId);
  }

  if (firstAttempt.error?.code === '23505') {
    throw new FinanceServiceError({
      messagePT: `Já existe uma categoria de ${
        type === 'receita' ? 'receita' : 'despesa'
      } com o nome "${cleanName}". Escolha outro nome.`,
      cause: firstAttempt.error,
    });
  }

  if (isTypeConstraintError(firstAttempt.error)) {
    const altConvention: DbTypeConvention = firstConvention === 'en' ? 'pt' : 'en';
    const secondAttempt = await supabase!
      .from('categories')
      .update({
        user_id: userId,
        name: cleanName,
        type: toDbTypeValue(type, altConvention),
        color: cleanColor,
      })
      .eq('id', id)
      .eq('user_id', userId)
      .select('id, user_id, name, type, color, created_at')
      .maybeSingle();

    if (!secondAttempt.error && secondAttempt.data) {
      detectedTypeConvention = altConvention;
      return secondAttempt.data as Record<string, unknown>;
    }
    if (!secondAttempt.error && !secondAttempt.data) {
      return verifyCategoryUpdateNotBlockedByRls(id, userId);
    }
    if (secondAttempt.error?.code === '23505') {
      throw new FinanceServiceError({
        messagePT: `Já existe uma categoria de ${
          type === 'receita' ? 'receita' : 'despesa'
        } com o nome "${cleanName}". Escolha outro nome.`,
        cause: secondAttempt.error,
      });
    }
    throw classifySupabaseError(secondAttempt.error, 'Não foi possível atualizar a categoria.');
  }

  throw classifySupabaseError(firstAttempt.error, 'Não foi possível atualizar a categoria.');
}

export async function createCategoryInDb(catData: Omit<Category, 'id'>): Promise<Category> {
  const userId = await requireAuthenticatedUserId();
  const cleanName = catData.name.trim().replace(/\s+/g, ' ');
  if (!cleanName) {
    throw new FinanceServiceError({
      messagePT: 'Informe o nome da categoria.',
    });
  }
  const cleanColor = normalizeCategoryHexColor(catData.hexColor);

  await assertNoDuplicateCategoryInDb(userId, cleanName, catData.type);

  const row = await insertCategoryRowWithTypeRetry(
    userId,
    cleanName,
    catData.type,
    cleanColor
  );

  const catId = String(row.id);
  const uiMeta = readUserUiMeta(userId);
  const metaEntry: CategoryUiMeta = {
    icon: catData.icon || inferCategoryIcon(cleanName, catData.type),
    colorClass: inferColorClassFromHex(cleanColor, catData.type),
    budget: catData.budget,
    subcategories: catData.subcategories,
  };
  uiMeta.categories[catId] = metaEntry;
  writeUserUiMeta(userId, uiMeta);

  return mapCategoryRow(row, metaEntry);
}

export async function updateCategoryInDb(
  id: string,
  catData: Omit<Category, 'id'>
): Promise<Category> {
  const userId = await requireAuthenticatedUserId();
  const cleanName = catData.name.trim().replace(/\s+/g, ' ');
  if (!cleanName) {
    throw new FinanceServiceError({
      messagePT: 'Informe o nome da categoria.',
    });
  }
  const cleanColor = normalizeCategoryHexColor(catData.hexColor);

  await assertNoDuplicateCategoryInDb(userId, cleanName, catData.type, id);

  const row = await updateCategoryRowWithTypeRetry(
    id,
    userId,
    cleanName,
    catData.type,
    cleanColor
  );

  const uiMeta = readUserUiMeta(userId);
  const metaEntry: CategoryUiMeta = {
    icon: catData.icon || inferCategoryIcon(cleanName, catData.type),
    colorClass: inferColorClassFromHex(cleanColor, catData.type),
    budget: catData.budget,
    subcategories: catData.subcategories,
  };
  uiMeta.categories[id] = metaEntry;
  writeUserUiMeta(userId, uiMeta);

  return mapCategoryRow(row, metaEntry);
}

export async function deleteCategoryInDb(id: string): Promise<void> {
  if (!isValidUuid(id)) {
    throw new FinanceServiceError({
      messagePT: 'Identificador da categoria inválido para exclusão.',
    });
  }

  const userId = await requireAuthenticatedUserId();

  const verifyDeletedRows = async (deletedRows: Array<Record<string, unknown>> | null) => {
    if (deletedRows && deletedRows.length > 0) {
      return;
    }
    const checkStillExists = await supabase!
      .from('categories')
      .select('id')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();

    if (!checkStillExists.error && checkStillExists.data) {
      throw new FinanceServiceError({
        messagePT:
          'A política RLS do Supabase impediu a exclusão desta categoria (verifique a política FOR DELETE na tabela categories).',
      });
    }

    throw new FinanceServiceError({
      messagePT: 'Categoria não encontrada ou você não tem permissão para excluí-la.',
    });
  };

  const firstDel = await supabase!
    .from('categories')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
    .select('id');

  if (firstDel.error) {
    // If FK is ON DELETE RESTRICT, unlink transactions.category_id for this user first
    if (firstDel.error.code === '23503') {
      const unlink = await supabase!
        .from('transactions')
        .update({ category_id: null })
        .eq('category_id', id)
        .eq('user_id', userId);

      if (!unlink.error) {
        const retryDel = await supabase!
          .from('categories')
          .delete()
          .eq('id', id)
          .eq('user_id', userId)
          .select('id');

        if (!retryDel.error) {
          await verifyDeletedRows((retryDel.data || []) as Array<Record<string, unknown>>);
          const uiMeta = readUserUiMeta(userId);
          delete uiMeta.categories[id];
          writeUserUiMeta(userId, uiMeta);
          return;
        }
        throw classifySupabaseError(retryDel.error, 'Não foi possível excluir a categoria.');
      }
    }
    throw classifySupabaseError(firstDel.error, 'Não foi possível excluir a categoria.');
  }

  await verifyDeletedRows((firstDel.data || []) as Array<Record<string, unknown>>);

  const uiMeta = readUserUiMeta(userId);
  delete uiMeta.categories[id];
  writeUserUiMeta(userId, uiMeta);
}

// === ACCOUNTS CRUD (`public.accounts`: id, user_id, name, initial_balance, created_at) ===

export function normalizeAccountNameKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Safely parses Brazilian currency strings ("1.500,50", "1.500", "-250,00", "0")
 * and decimal inputs ("1500.50") for account `initial_balance`.
 * Returns `NaN` when the string is non-numeric.
 */
export function parseBrlBalanceInput(raw: string | number): number {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? Number(raw.toFixed(2)) : Number.NaN;
  }
  const trimmed = raw.trim();
  if (!trimmed) return 0;

  const withoutCurrency = trimmed.replace(/[R$\s]/g, '');
  if (!withoutCurrency) return 0;

  const isNegative = withoutCurrency.startsWith('-');
  const unsigned = withoutCurrency.replace(/^[+-]/, '');
  if (!unsigned || !/\d/.test(unsigned)) return Number.NaN;

  let normalized: string;
  if (unsigned.includes(',')) {
    normalized = unsigned.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(unsigned)) {
    normalized = unsigned.replace(/\./g, '');
  } else {
    normalized = unsigned;
  }

  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    return Number.NaN;
  }

  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed)) return Number.NaN;
  const signed = isNegative ? -parsed : parsed;
  return signed === 0 ? 0 : Number(signed.toFixed(2));
}

export function isDuplicateAccountName(
  existingAccounts: Array<{ id?: string; name: string }>,
  candidateName: string,
  excludeId?: string
): boolean {
  const targetKey = normalizeAccountNameKey(candidateName);
  if (!targetKey) return false;

  return existingAccounts.some((acc) => {
    if (excludeId && acc.id && String(acc.id) === excludeId) {
      return false;
    }
    return normalizeAccountNameKey(acc.name) === targetKey;
  });
}

async function assertNoDuplicateAccountInDb(
  userId: string,
  name: string,
  excludeId?: string
): Promise<void> {
  const { data, error } = await supabase!
    .from('accounts')
    .select('id, name')
    .eq('user_id', userId);

  if (error) {
    throw classifySupabaseError(
      error,
      'Não foi possível verificar as contas existentes no banco de dados.'
    );
  }

  const rows = ((data || []) as Array<Record<string, unknown>>).map((row) => ({
    id: row.id ? String(row.id) : undefined,
    name: String(row.name || ''),
  }));

  if (isDuplicateAccountName(rows, name, excludeId)) {
    const cleanDisplay = name.trim().replace(/\s+/g, ' ');
    throw new FinanceServiceError({
      messagePT: `Já existe uma conta ou carteira com o nome "${cleanDisplay}". Escolha outro nome.`,
    });
  }
}

export async function listAccountsFromDb(): Promise<AccountItem[]> {
  const userId = await requireAuthenticatedUserId();
  const uiMeta = readUserUiMeta(userId);

  const { data, error } = await supabase!
    .from('accounts')
    .select('id, user_id, name, initial_balance, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (error) {
    throw classifySupabaseError(error, 'Não foi possível carregar suas contas.');
  }

  return ((data || []) as Record<string, unknown>[])
    .filter((row) => !row.user_id || String(row.user_id) === userId)
    .map((row) => mapAccountRow(row, uiMeta.accounts[String(row.id)]));
}

export async function createAccountInDb(accData: Omit<AccountItem, 'id'>): Promise<AccountItem> {
  const userId = await requireAuthenticatedUserId();
  const cleanName = accData.name.trim().replace(/\s+/g, ' ');
  if (!cleanName) {
    throw new FinanceServiceError({
      messagePT: 'Informe o nome da conta ou carteira.',
    });
  }

  const initialBalance = parseBrlBalanceInput(accData.initialBalance ?? accData.balance ?? 0);
  if (!Number.isFinite(initialBalance)) {
    throw new FinanceServiceError({
      messagePT: 'Informe um saldo inicial numérico válido.',
    });
  }

  await assertNoDuplicateAccountInDb(userId, cleanName);

  const { data, error } = await supabase!
    .from('accounts')
    .insert({
      user_id: userId,
      name: cleanName,
      initial_balance: initialBalance,
    })
    .select('id, user_id, name, initial_balance, created_at')
    .single();

  if (error || !data) {
    if (error?.code === '23505') {
      throw new FinanceServiceError({
        messagePT: `Já existe uma conta ou carteira com o nome "${cleanName}". Escolha outro nome.`,
        cause: error,
      });
    }
    throw classifySupabaseError(error, 'Não foi possível cadastrar a conta.');
  }

  const row = data as Record<string, unknown>;
  const accId = String(row.id);
  const inferred = inferAccountDefaultsFromName(cleanName);
  const uiMeta = readUserUiMeta(userId);
  const metaEntry: AccountUiMeta = {
    institutionCode: accData.institutionCode || inferred.code,
    badgeText: accData.badgeText || inferred.badge,
    type: accData.type || inferred.type,
    limit: accData.limit,
    dueDate: accData.dueDate,
    statusText: accData.statusText,
    accentTheme: accData.accentTheme || inferred.theme,
  };
  uiMeta.accounts[accId] = metaEntry;
  writeUserUiMeta(userId, uiMeta);

  return mapAccountRow(row, metaEntry);
}

export async function updateAccountInDb(
  id: string,
  accData: Omit<AccountItem, 'id'>
): Promise<AccountItem> {
  if (!isValidUuid(id)) {
    throw new FinanceServiceError({
      messagePT: 'Identificador da conta inválido para edição.',
    });
  }

  const userId = await requireAuthenticatedUserId();
  const cleanName = accData.name.trim().replace(/\s+/g, ' ');
  if (!cleanName) {
    throw new FinanceServiceError({
      messagePT: 'Informe o nome da conta ou carteira.',
    });
  }

  const initialBalance = parseBrlBalanceInput(accData.initialBalance ?? accData.balance ?? 0);
  if (!Number.isFinite(initialBalance)) {
    throw new FinanceServiceError({
      messagePT: 'Informe um saldo inicial numérico válido.',
    });
  }

  await assertNoDuplicateAccountInDb(userId, cleanName, id);

  const { data, error } = await supabase!
    .from('accounts')
    .update({
      user_id: userId,
      name: cleanName,
      initial_balance: initialBalance,
    })
    .eq('id', id)
    .eq('user_id', userId)
    .select('id, user_id, name, initial_balance, created_at')
    .maybeSingle();

  if (error) {
    if (error.code === '23505') {
      throw new FinanceServiceError({
        messagePT: `Já existe uma conta ou carteira com o nome "${cleanName}". Escolha outro nome.`,
        cause: error,
      });
    }
    throw classifySupabaseError(error, 'Não foi possível atualizar a conta.');
  }

  if (!data) {
    const checkOwnExisting = await supabase!
      .from('accounts')
      .select('id')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();

    if (!checkOwnExisting.error && checkOwnExisting.data) {
      throw new FinanceServiceError({
        messagePT:
          'A política RLS do Supabase impediu a edição desta conta (verifique a política FOR UPDATE na tabela accounts).',
      });
    }

    throw new FinanceServiceError({
      messagePT: 'Conta não encontrada ou você não tem permissão para alterá-la.',
    });
  }

  const row = data as Record<string, unknown>;
  const inferred = inferAccountDefaultsFromName(cleanName);
  const uiMeta = readUserUiMeta(userId);
  const metaEntry: AccountUiMeta = {
    institutionCode: accData.institutionCode || inferred.code,
    badgeText: accData.badgeText || inferred.badge,
    type: accData.type || inferred.type,
    limit: accData.limit,
    dueDate: accData.dueDate,
    statusText: accData.statusText,
    accentTheme: accData.accentTheme || inferred.theme,
  };
  uiMeta.accounts[id] = metaEntry;
  writeUserUiMeta(userId, uiMeta);

  return mapAccountRow(row, metaEntry);
}

export async function deleteAccountInDb(
  id: string
): Promise<{ unlinkedTransactionsCount: number }> {
  if (!isValidUuid(id)) {
    throw new FinanceServiceError({
      messagePT: 'Identificador da conta inválido para exclusão.',
    });
  }

  const userId = await requireAuthenticatedUserId();

  // 1. Verify ownership strictly scoped to user_id before touching linked transactions
  const ownershipCheck = await supabase!
    .from('accounts')
    .select('id, user_id')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();

  if (ownershipCheck.error) {
    throw classifySupabaseError(ownershipCheck.error, 'Não foi possível validar a conta.');
  }

  if (!ownershipCheck.data) {
    throw new FinanceServiceError({
      messagePT: 'Conta não encontrada ou você não tem permissão para excluí-la.',
    });
  }

  // 2. Safely unlink any linked transactions BEFORE deleting the account
  // This prevents both FK 23503 errors AND accidental ON DELETE CASCADE deletion of user transactions
  const linkedRes = await supabase!
    .from('transactions')
    .select('id')
    .eq('account_id', id)
    .eq('user_id', userId);

  if (linkedRes.error) {
    throw classifySupabaseError(
      linkedRes.error,
      'Não foi possível verificar as movimentações vinculadas a esta conta.'
    );
  }

  const linkedIds = ((linkedRes.data || []) as Array<Record<string, unknown>>).map((r) =>
    String(r.id)
  );

  if (linkedIds.length > 0) {
    const unlinkRes = await supabase!
      .from('transactions')
      .update({ account_id: null })
      .eq('account_id', id)
      .eq('user_id', userId)
      .select('id');

    if (unlinkRes.error) {
      throw classifySupabaseError(
        unlinkRes.error,
        'Não foi possível desvincular as movimentações desta conta antes da exclusão. Nenhuma movimentação foi apagada.'
      );
    }

    const unlinkedCount = (unlinkRes.data || []).length;
    if (unlinkedCount < linkedIds.length) {
      throw new FinanceServiceError({
        messagePT:
          'A política RLS impediu desvincular todas as movimentações desta conta com segurança. A exclusão foi cancelada para preservar seu extrato.',
      });
    }
  }

  // 3. Delete the account row and confirm via .select('id')
  const delRes = await supabase!
    .from('accounts')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
    .select('id');

  if (delRes.error) {
    throw classifySupabaseError(delRes.error, 'Não foi possível excluir a conta.');
  }

  const deletedRows = (delRes.data || []) as Array<Record<string, unknown>>;
  if (deletedRows.length === 0) {
    const checkStillExists = await supabase!
      .from('accounts')
      .select('id')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();

    if (!checkStillExists.error && checkStillExists.data) {
      throw new FinanceServiceError({
        messagePT:
          'A política RLS do Supabase impediu a exclusão desta conta (verifique a política FOR DELETE na tabela accounts).',
      });
    }

    throw new FinanceServiceError({
      messagePT: 'Conta não encontrada ou você não tem permissão para excluí-la.',
    });
  }

  const uiMeta = readUserUiMeta(userId);
  delete uiMeta.accounts[id];
  writeUserUiMeta(userId, uiMeta);

  return { unlinkedTransactionsCount: linkedIds.length };
}

// === TRANSACTIONS CRUD ===
// (`public.transactions`: id, user_id, account_id, category_id, type, description, amount, transaction_date, notes, created_at)

export async function listTransactionsFromDb(
  categories: Category[] = [],
  accounts: AccountItem[] = []
): Promise<Transaction[]> {
  const userId = await requireAuthenticatedUserId();
  const uiMeta = readUserUiMeta(userId);

  const primaryRes = await supabase!
    .from('transactions')
    .select(
      'id, user_id, account_id, category_id, type, description, amount, transaction_date, notes, created_at, accounts(id, name), categories(id, name, type, color)'
    )
    .eq('user_id', userId)
    .order('transaction_date', { ascending: false })
    .order('created_at', { ascending: false });

  let rows: Record<string, unknown>[] = [];
  if (primaryRes.error) {
    const fallbackRes = await supabase!
      .from('transactions')
      .select(
        'id, user_id, account_id, category_id, type, description, amount, transaction_date, notes, created_at'
      )
      .eq('user_id', userId)
      .order('transaction_date', { ascending: false })
      .order('created_at', { ascending: false });

    if (fallbackRes.error) {
      throw classifySupabaseError(fallbackRes.error, 'Não foi possível listar as movimentações.');
    }
    rows = (fallbackRes.data || []) as Record<string, unknown>[];
  } else {
    rows = (primaryRes.data || []) as Record<string, unknown>[];
  }

  const categoriesById = new Map(categories.map((c) => [c.id, c]));
  const accountsById = new Map(accounts.map((a) => [a.id, a]));

  return rows
    .filter((row) => !row.user_id || String(row.user_id) === userId)
    .map((row) =>
      mapTransactionRow(
        row,
        categoriesById,
        accountsById,
        uiMeta.transactions[String(row.id)]
      )
    );
}

async function resolveOwnedTransactionForeignKeys(
  userId: string,
  txData: Omit<Transaction, 'id'>,
  categories: Category[],
  accounts: AccountItem[]
): Promise<{
  categoryId: string | null;
  accountId: string | null;
}> {
  let categoryId: string | null = null;
  if (txData.categoryId && isValidUuid(txData.categoryId)) {
    const ownedInMemory = categories.some((c) => c.id === txData.categoryId);
    if (ownedInMemory) {
      categoryId = txData.categoryId;
    } else {
      const catCheck = await supabase!
        .from('categories')
        .select('id')
        .eq('id', txData.categoryId)
        .eq('user_id', userId)
        .maybeSingle();
      if (catCheck.error) {
        throw classifySupabaseError(catCheck.error, 'Não foi possível validar a categoria selecionada.');
      }
      if (!catCheck.data) {
        throw new FinanceServiceError({
          messagePT: 'Acesso negado: a categoria informada não pertence ao usuário autenticado.',
        });
      }
      categoryId = txData.categoryId;
    }
  } else if (
    txData.category &&
    txData.category.trim() &&
    txData.category.trim().toLowerCase() !== 'sem categoria'
  ) {
    const matchedCat = categories.find(
      (c) =>
        isValidUuid(c.id) &&
        c.name.trim().toLowerCase() === txData.category.trim().toLowerCase()
    );
    if (matchedCat) {
      categoryId = matchedCat.id;
    }
  }

  let accountId: string | null = null;
  if (txData.accountId && isValidUuid(txData.accountId)) {
    const ownedInMemory = accounts.some((a) => a.id === txData.accountId);
    if (ownedInMemory) {
      accountId = txData.accountId;
    } else {
      const accCheck = await supabase!
        .from('accounts')
        .select('id')
        .eq('id', txData.accountId)
        .eq('user_id', userId)
        .maybeSingle();
      if (accCheck.error) {
        throw classifySupabaseError(accCheck.error, 'Não foi possível validar a conta selecionada.');
      }
      if (!accCheck.data) {
        throw new FinanceServiceError({
          messagePT: 'Acesso negado: a conta informada não pertence ao usuário autenticado.',
        });
      }
      accountId = txData.accountId;
    }
  } else if (
    txData.account &&
    txData.account.trim() &&
    txData.account.trim().toLowerCase() !== 'sem conta' &&
    txData.account.trim().toLowerCase() !== 'carteira geral'
  ) {
    const matchedAcc = accounts.find(
      (a) =>
        isValidUuid(a.id) &&
        a.name.trim().toLowerCase() === txData.account.trim().toLowerCase()
    );
    if (matchedAcc) {
      accountId = matchedAcc.id;
    }
  }

  return { categoryId, accountId };
}

function validateTransactionInput(txData: Omit<Transaction, 'id'>): {
  positiveAmount: number;
  description: string;
  dbType: 'income' | 'expense';
  transactionDate: string;
  notes: string | null;
} {
  const description = (txData.title || '').trim();
  if (!description) {
    throw new FinanceServiceError({
      messagePT: 'Informe a descrição da movimentação.',
    });
  }

  const numericAmount = Number(txData.amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new FinanceServiceError({
      messagePT: 'O valor da movimentação deve ser positivo (maior que R$ 0,00).',
    });
  }

  const transactionDate = (txData.date || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(transactionDate)) {
    throw new FinanceServiceError({
      messagePT: 'Informe uma data válida para a movimentação.',
    });
  }

  // Strictly 'income' for receitas and 'expense' for despesas
  const dbType: 'income' | 'expense' = txData.type === 'receita' ? 'income' : 'expense';
  const rawNotes = (txData.notes ?? txData.tags ?? '').trim();

  return {
    positiveAmount: Number(numericAmount.toFixed(2)),
    description,
    dbType,
    transactionDate,
    notes: rawNotes ? rawNotes : null,
  };
}

export async function createTransactionInDb(
  txData: Omit<Transaction, 'id'>,
  categories: Category[],
  accounts: AccountItem[]
): Promise<TransactionMutationResult> {
  const userId = await requireAuthenticatedUserId();
  const validated = validateTransactionInput(txData);
  const { categoryId, accountId } = await resolveOwnedTransactionForeignKeys(
    userId,
    txData,
    categories,
    accounts
  );

  const insertPayload = {
    user_id: userId,
    account_id: accountId,
    category_id: categoryId,
    type: validated.dbType,
    description: validated.description,
    amount: validated.positiveAmount,
    transaction_date: validated.transactionDate,
    notes: validated.notes,
  };

  let res = await supabase!
    .from('transactions')
    .insert(insertPayload)
    .select(
      'id, user_id, account_id, category_id, type, description, amount, transaction_date, notes, created_at, accounts(id, name), categories(id, name, type, color)'
    )
    .single();

  if (res.error && res.error.code === 'PGRST200') {
    res = await supabase!
      .from('transactions')
      .insert(insertPayload)
      .select(
        'id, user_id, account_id, category_id, type, description, amount, transaction_date, notes, created_at'
      )
      .single();
  }

  if (res.error || !res.data) {
    throw classifySupabaseError(res.error, 'Não foi possível cadastrar a movimentação.');
  }

  const row = res.data as Record<string, unknown>;
  const txId = String(row.id);

  const uiMeta = readUserUiMeta(userId);
  const txUiMeta: TransactionUiMeta = {
    subcategory: txData.subcategory,
    time: txData.time,
    method: txData.method,
    icon: txData.icon,
    status: txData.status,
    recurring: txData.recurring,
  };
  uiMeta.transactions[txId] = txUiMeta;
  writeUserUiMeta(userId, uiMeta);

  const categoriesById = new Map(categories.map((c) => [c.id, c]));
  const accountsById = new Map(accounts.map((a) => [a.id, a]));

  return {
    transaction: mapTransactionRow(row, categoriesById, accountsById, txUiMeta),
  };
}

export async function updateTransactionInDb(
  id: string,
  txData: Omit<Transaction, 'id'>,
  categories: Category[],
  accounts: AccountItem[]
): Promise<TransactionMutationResult> {
  if (!isValidUuid(id)) {
    throw new FinanceServiceError({
      messagePT: 'Identificador da movimentação inválido para edição.',
    });
  }

  const userId = await requireAuthenticatedUserId();
  const validated = validateTransactionInput(txData);
  const { categoryId, accountId } = await resolveOwnedTransactionForeignKeys(
    userId,
    txData,
    categories,
    accounts
  );

  const updatePayload = {
    user_id: userId,
    account_id: accountId,
    category_id: categoryId,
    type: validated.dbType,
    description: validated.description,
    amount: validated.positiveAmount,
    transaction_date: validated.transactionDate,
    notes: validated.notes,
  };

  const primaryRes = await supabase!
    .from('transactions')
    .update(updatePayload)
    .eq('id', id)
    .eq('user_id', userId)
    .select(
      'id, user_id, account_id, category_id, type, description, amount, transaction_date, notes, created_at, accounts(id, name), categories(id, name, type, color)'
    )
    .maybeSingle();

  let updatedRow: Record<string, unknown> | null = null;
  let updateError = primaryRes.error;

  if (primaryRes.error && primaryRes.error.code === 'PGRST200') {
    const fallbackRes = await supabase!
      .from('transactions')
      .update(updatePayload)
      .eq('id', id)
      .eq('user_id', userId)
      .select(
        'id, user_id, account_id, category_id, type, description, amount, transaction_date, notes, created_at'
      )
      .maybeSingle();
    updateError = fallbackRes.error;
    updatedRow = (fallbackRes.data as Record<string, unknown> | null) ?? null;
  } else {
    updatedRow = (primaryRes.data as Record<string, unknown> | null) ?? null;
  }

  if (updateError) {
    throw classifySupabaseError(updateError, 'Não foi possível atualizar a movimentação.');
  }

  if (!updatedRow) {
    // Check whether the row still exists for this user (proves missing/restrictive FOR UPDATE RLS policy)
    const checkExisting = await supabase!
      .from('transactions')
      .select('id')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();

    if (checkExisting.data) {
      throw new FinanceServiceError({
        messagePT:
          'Operação bloqueada pelas políticas RLS de edição (FOR UPDATE) na tabela transactions. Verifique se a política FOR UPDATE permite auth.uid() = user_id.',
      });
    }

    throw new FinanceServiceError({
      messagePT:
        'Esta movimentação não foi encontrada no banco de dados (pode já ter sido excluída).',
    });
  }

  const uiMeta = readUserUiMeta(userId);
  const txUiMeta: TransactionUiMeta = {
    subcategory: txData.subcategory,
    time: txData.time,
    method: txData.method,
    icon: txData.icon,
    status: txData.status,
    recurring: txData.recurring,
  };
  uiMeta.transactions[id] = txUiMeta;
  writeUserUiMeta(userId, uiMeta);

  const categoriesById = new Map(categories.map((c) => [c.id, c]));
  const accountsById = new Map(accounts.map((a) => [a.id, a]));

  return {
    transaction: mapTransactionRow(updatedRow, categoriesById, accountsById, txUiMeta),
  };
}

export async function deleteTransactionsInDb(ids: string[]): Promise<string[]> {
  const validIds = ids.filter((id) => isValidUuid(id));
  if (validIds.length === 0) {
    throw new FinanceServiceError({
      messagePT: 'Identificador inválido para exclusão da movimentação.',
    });
  }

  const userId = await requireAuthenticatedUserId();

  const { data: deletedRows, error } = await supabase!
    .from('transactions')
    .delete()
    .in('id', validIds)
    .eq('user_id', userId)
    .select('id');

  if (error) {
    throw classifySupabaseError(error, 'Não foi possível excluir a movimentação.');
  }

  const deletedIds = (deletedRows || []).map((r) => String((r as { id: unknown }).id));

  if (deletedIds.length === 0) {
    // Verify if rows still exist in public.transactions (detects missing FOR DELETE RLS policy)
    const stillThere = await supabase!
      .from('transactions')
      .select('id')
      .in('id', validIds)
      .eq('user_id', userId);

    if (stillThere.data && stillThere.data.length > 0) {
      throw new FinanceServiceError({
        messagePT:
          'Operação bloqueada pelas políticas RLS de exclusão (FOR DELETE) na tabela transactions. Confirme se a política FOR DELETE permite auth.uid() = user_id.',
      });
    }
  }

  const uiMeta = readUserUiMeta(userId);
  for (const id of validIds) {
    delete uiMeta.transactions[id];
  }
  writeUserUiMeta(userId, uiMeta);

  return deletedIds.length > 0 ? deletedIds : validIds;
}

// === GOALS CRUD (`public.goals`: id, user_id, name, target_amount, current_amount, target_date, created_at) ===

export async function listGoalsFromDb(): Promise<GoalItem[]> {
  const userId = await requireAuthenticatedUserId();
  const uiMeta = readUserUiMeta(userId);

  const { data, error } = await supabase!
    .from('goals')
    .select('id, user_id, name, target_amount, current_amount, target_date, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    throw classifySupabaseError(error, 'Não foi possível carregar suas metas financeiras.');
  }

  return ((data || []) as Record<string, unknown>[])
    .filter((row) => !row.user_id || String(row.user_id) === userId)
    .map((row) => mapGoalRow(row, uiMeta.goals[String(row.id)]));
}

export async function createGoalInDb(goalData: Omit<GoalItem, 'id'>): Promise<GoalItem> {
  const userId = await requireAuthenticatedUserId();
  const validated = validateGoalPayload({
    name: goalData.name,
    targetAmount: goalData.targetAmount,
    currentAmount: goalData.currentAmount,
    targetDateIso: goalData.targetDateIso,
    requireDate: true,
  });

  const { data, error } = await supabase!
    .from('goals')
    .insert({
      user_id: userId,
      name: validated.cleanName,
      target_amount: validated.targetAmount,
      current_amount: validated.currentAmount,
      target_date: validated.targetDate,
    })
    .select('id, user_id, name, target_amount, current_amount, target_date, created_at')
    .single();

  if (error || !data) {
    throw classifySupabaseError(error, 'Não foi possível criar a meta.');
  }

  const row = data as Record<string, unknown>;
  const goalId = String(row.id);
  const isCompleted = validated.currentAmount >= validated.targetAmount;
  const uiMeta = readUserUiMeta(userId);
  const metaEntry: GoalUiMeta = {
    category: goalData.category,
    priorityBadge: isCompleted ? '100% Conquistado!' : goalData.priorityBadge,
    icon: goalData.icon,
    theme: goalData.theme,
    status: isCompleted ? 'completed' : goalData.status === 'paused' ? 'paused' : 'active',
    linkedAccount: goalData.linkedAccount,
    completedDateLabel: isCompleted
      ? goalData.completedDateLabel || 'Objetivo concluído'
      : undefined,
  };
  uiMeta.goals[goalId] = metaEntry;
  writeUserUiMeta(userId, uiMeta);

  return mapGoalRow(row, metaEntry);
}

export async function updateGoalInDb(
  id: string,
  goalData: Omit<GoalItem, 'id'>
): Promise<GoalItem> {
  if (!isValidUuid(id)) {
    throw new FinanceServiceError({
      messagePT: 'Identificador da meta inválido para edição.',
    });
  }

  const userId = await requireAuthenticatedUserId();
  const validated = validateGoalPayload({
    name: goalData.name,
    targetAmount: goalData.targetAmount,
    currentAmount: goalData.currentAmount,
    targetDateIso: goalData.targetDateIso,
    requireDate: false,
  });

  const { data, error } = await supabase!
    .from('goals')
    .update({
      user_id: userId,
      name: validated.cleanName,
      target_amount: validated.targetAmount,
      current_amount: validated.currentAmount,
      target_date: validated.targetDate,
    })
    .eq('id', id)
    .eq('user_id', userId)
    .select('id, user_id, name, target_amount, current_amount, target_date, created_at')
    .maybeSingle();

  if (error) {
    throw classifySupabaseError(error, 'Não foi possível atualizar a meta.');
  }

  if (!data) {
    const checkOwn = await supabase!
      .from('goals')
      .select('id')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();

    if (!checkOwn.error && checkOwn.data) {
      throw new FinanceServiceError({
        messagePT:
          'A política RLS do Supabase impediu a atualização desta meta (verifique a política FOR UPDATE na tabela goals).',
      });
    }

    throw new FinanceServiceError({
      messagePT:
        'Você não tem permissão para alterar esta meta ou ela não foi encontrada no banco de dados.',
    });
  }

  const row = data as Record<string, unknown>;
  const isCompleted = validated.currentAmount >= validated.targetAmount;
  const uiMeta = readUserUiMeta(userId);
  const nextStatus: GoalStatus = isCompleted
    ? 'completed'
    : goalData.status === 'paused'
    ? 'paused'
    : 'active';

  const metaEntry: GoalUiMeta = {
    category: goalData.category,
    priorityBadge: isCompleted
      ? '100% Conquistado!'
      : goalData.priorityBadge === '100% Conquistado!'
      ? 'Médio Prazo'
      : goalData.priorityBadge,
    icon: goalData.icon,
    theme: goalData.theme,
    status: nextStatus,
    linkedAccount: goalData.linkedAccount,
    completedDateLabel: isCompleted
      ? goalData.completedDateLabel || 'Objetivo concluído'
      : undefined,
  };
  uiMeta.goals[id] = metaEntry;
  writeUserUiMeta(userId, uiMeta);

  return mapGoalRow(row, metaEntry);
}

export async function updateGoalProgressInDb(
  id: string,
  newCurrentAmountInput: string | number,
  completedDateLabel?: string
): Promise<GoalItem> {
  if (!isValidUuid(id)) {
    throw new FinanceServiceError({
      messagePT: 'Identificador da meta inválido para atualização de progresso.',
    });
  }

  const userId = await requireAuthenticatedUserId();
  const parsedCurrent = parseGoalAmountInput(newCurrentAmountInput, false);
  if (!Number.isFinite(parsedCurrent) || parsedCurrent < 0) {
    throw new FinanceServiceError({
      messagePT: 'O valor acumulado deve ser igual ou maior que zero.',
    });
  }

  const { data, error } = await supabase!
    .from('goals')
    .update({
      user_id: userId,
      current_amount: parsedCurrent,
    })
    .eq('id', id)
    .eq('user_id', userId)
    .select('id, user_id, name, target_amount, current_amount, target_date, created_at')
    .maybeSingle();

  if (error) {
    throw classifySupabaseError(error, 'Não foi possível atualizar o progresso da meta.');
  }

  if (!data) {
    const checkOwn = await supabase!
      .from('goals')
      .select('id')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();

    if (!checkOwn.error && checkOwn.data) {
      throw new FinanceServiceError({
        messagePT:
          'A política RLS do Supabase impediu a atualização do progresso desta meta (verifique a política FOR UPDATE na tabela goals).',
      });
    }

    throw new FinanceServiceError({
      messagePT:
        'Você não tem permissão para alterar esta meta ou ela não foi encontrada no banco de dados.',
    });
  }

  const row = data as Record<string, unknown>;
  const targetVal = Number(row.target_amount ?? 0);
  const isCompleted = targetVal > 0 && parsedCurrent >= targetVal;

  const uiMeta = readUserUiMeta(userId);
  const existingMeta = uiMeta.goals[id] || {};
  const nextStatus: GoalStatus = isCompleted
    ? 'completed'
    : existingMeta.status === 'paused'
    ? 'paused'
    : 'active';

  const updatedMeta: GoalUiMeta = {
    ...existingMeta,
    status: nextStatus,
    priorityBadge: isCompleted
      ? '100% Conquistado!'
      : existingMeta.priorityBadge === '100% Conquistado!'
      ? 'Médio Prazo'
      : existingMeta.priorityBadge,
    completedDateLabel: isCompleted
      ? completedDateLabel || existingMeta.completedDateLabel || 'Objetivo concluído'
      : undefined,
  };
  uiMeta.goals[id] = updatedMeta;
  writeUserUiMeta(userId, uiMeta);

  return mapGoalRow(row, updatedMeta);
}

export async function deleteGoalInDb(id: string): Promise<void> {
  if (!isValidUuid(id)) {
    throw new FinanceServiceError({
      messagePT: 'Identificador da meta inválido para exclusão.',
    });
  }

  const userId = await requireAuthenticatedUserId();
  const { data, error } = await supabase!
    .from('goals')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
    .select('id');

  if (error) {
    throw classifySupabaseError(error, 'Não foi possível excluir a meta.');
  }

  const deletedRows = (data || []) as Array<Record<string, unknown>>;
  if (deletedRows.length === 0) {
    const checkOwn = await supabase!
      .from('goals')
      .select('id')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();

    if (!checkOwn.error && checkOwn.data) {
      throw new FinanceServiceError({
        messagePT:
          'A política RLS do Supabase impediu a exclusão desta meta (verifique a política FOR DELETE na tabela goals).',
      });
    }

    throw new FinanceServiceError({
      messagePT:
        'Você não tem permissão para excluir esta meta ou ela não foi encontrada no banco de dados.',
    });
  }

  const uiMeta = readUserUiMeta(userId);
  delete uiMeta.goals[id];
  writeUserUiMeta(userId, uiMeta);
}

// === PROFILE READ & UPDATE (`public.profiles`: id, full_name, created_at + Auth user_metadata) ===

export async function fetchUserProfileFromDb(authUser: User): Promise<UserProfile> {
  const userId = await requireAuthenticatedUserId();
  if (authUser.id !== userId) {
    throw new FinanceServiceError({
      messagePT: 'Operação bloqueada: você só pode consultar o seu próprio perfil.',
    });
  }

  const { data, error } = await supabase!
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw classifySupabaseError(error, 'Não foi possível carregar os dados do perfil no Supabase.');
  }

  const rawRow = (data || undefined) as Record<string, unknown> | undefined;
  if (rawRow?.id && String(rawRow.id) !== userId) {
    throw new FinanceServiceError({
      messagePT: 'Operação bloqueada: o registro retornado não pertence ao usuário autenticado.',
    });
  }

  const uiMeta = readUserUiMeta(userId);
  return mapProfileRow(rawRow, authUser, uiMeta.profile);
}

export async function updateProfileInDb(
  profile: UserProfile,
  authUser: User
): Promise<UserProfile> {
  const userId = await requireAuthenticatedUserId();

  if (authUser.id !== userId) {
    throw new FinanceServiceError({
      messagePT: 'Operação bloqueada: cada usuário pode alterar somente o próprio perfil.',
    });
  }
  if (profile.supabaseId && profile.supabaseId !== userId) {
    throw new FinanceServiceError({
      messagePT:
        'Operação bloqueada: identificador do perfil não corresponde ao usuário autenticado.',
    });
  }

  const cleanName = validateProfileFullName(profile.name);

  // 1. Update `public.profiles` strictly scoped to `id = userId` (respecting RLS `auth.uid() = id`)
  const { data: updatedRow, error: updateError } = await supabase!
    .from('profiles')
    .update({ full_name: cleanName })
    .eq('id', userId)
    .select('*')
    .maybeSingle();

  if (updateError) {
    throw classifySupabaseError(
      updateError,
      'Não foi possível salvar seu nome na tabela public.profiles.'
    );
  }

  let savedRow: Record<string, unknown> | null =
    (updatedRow as Record<string, unknown> | null) ?? null;

  if (!savedRow) {
    // Check if the row exists for this user (proving missing/restrictive FOR UPDATE RLS policy)
    const checkExisting = await supabase!
      .from('profiles')
      .select('id')
      .eq('id', userId)
      .maybeSingle();

    if (checkExisting.error) {
      throw classifySupabaseError(
        checkExisting.error,
        'Não foi possível verificar o registro do perfil no banco de dados.'
      );
    }

    if (checkExisting.data) {
      throw new FinanceServiceError({
        messagePT:
          'A política RLS do Supabase impediu a edição do seu perfil. Verifique se a política FOR UPDATE na tabela public.profiles permite auth.uid() = id.',
      });
    }

    // Profile row does not exist yet for this authenticated user -> insert own row
    let insertRes = await supabase!
      .from('profiles')
      .insert({ id: userId, full_name: cleanName })
      .select('*')
      .maybeSingle();

    if (
      insertRes.error &&
      (isNotNullColumnError(insertRes.error, 'name') ||
        isNotNullColumnError(insertRes.error, 'email'))
    ) {
      insertRes = await supabase!
        .from('profiles')
        .insert({
          id: userId,
          full_name: cleanName,
          name: cleanName,
          email: authUser.email || '',
        })
        .select('*')
        .maybeSingle();
    }

    if (insertRes.error) {
      throw classifySupabaseError(
        insertRes.error,
        'Não foi possível registrar seu perfil na tabela public.profiles.'
      );
    }

    if (!insertRes.data) {
      throw new FinanceServiceError({
        messagePT:
          'Não foi possível confirmar a gravação do perfil na tabela public.profiles. Verifique as políticas RLS do seu projeto.',
      });
    }

    savedRow = insertRes.data as Record<string, unknown>;
  }

  // 2. Synchronize Supabase Auth user_metadata so full_name and preferences remain aligned
  let effectiveUser: User = authUser;
  const { data: updatedAuthData, error: authUpdateErr } = await supabase!.auth.updateUser({
    data: {
      full_name: cleanName,
      phone: profile.phone.trim(),
      occupation: profile.occupation.trim(),
      plan: profile.plan,
      currency: profile.currency,
      fiscal_month_start: profile.fiscalMonthStart,
      date_format: profile.dateFormat,
      budget_ceiling_alert: profile.budgetCeilingAlert,
      two_factor_enabled: profile.twoFactorEnabled,
    },
  });

  if (!authUpdateErr && updatedAuthData.user) {
    effectiveUser = updatedAuthData.user;
  }

  // 3. Persist optional local avatar visual preference per authenticated userId
  const uiMeta = readUserUiMeta(userId);
  uiMeta.profile = {
    avatarHeaderUrl: profile.avatarHeaderUrl || '',
    avatarPortraitUrl: profile.avatarPortraitUrl || '',
  };
  writeUserUiMeta(userId, uiMeta);

  return mapProfileRow(savedRow, effectiveUser, uiMeta.profile);
}
