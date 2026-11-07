export type ScreenId =
  | 'dashboard'
  | 'movimentacoes'
  | 'categorias'
  | 'contas'
  | 'metas'
  | 'relatorios'
  | 'configuracoes';

export type TransactionType = 'receita' | 'despesa';

export type TransactionStatus = 'efetivado' | 'pendente' | 'conciliado';

export type DataSourceMode = 'supabase' | 'local';

export interface Transaction {
  id: string;
  userId?: string;
  title: string;
  subtitle: string;
  category: string;
  categoryId?: string;
  subcategory?: string;
  account: string;
  accountId?: string;
  accountIcon?: string;
  type: TransactionType;
  amount: number;
  date: string; // YYYY-MM-DD
  dateLabel: string; // e.g., "Hoje" or "28 Out, 2026"
  dateGroup: string; // e.g., "Hoje • 28 de Outubro"
  time: string; // e.g., "14:32"
  method: string; // e.g., "TED", "Débito", "Pix"
  icon: string;
  status: TransactionStatus;
  recurring?: boolean;
  tags?: string;
  notes?: string;
}

export interface Subcategory {
  id: string;
  name: string;
  spent: number;
}

export interface Category {
  id: string;
  name: string;
  type: TransactionType;
  icon: string;
  colorClass: string; // 'tertiary' | 'amber' | 'cyan' | 'rose' | 'purple' | 'primary'
  hexColor: string;
  budget: number;
  spent: number;
  subcategories: Subcategory[];
  transactionsCount: number;
}

export type AccountType = 'checking' | 'savings' | 'business' | 'credit' | 'investment';

export interface AccountItem {
  id: string;
  name: string;
  institutionCode: string; // e.g., 'IT', 'NU', 'IN', 'BTG', 'CARD'
  badgeText: string;
  type: AccountType;
  openFinance?: boolean;
  initialBalance: number; // persisted in public.accounts.initial_balance
  balance: number; // dynamically calculated from initialBalance + linked transactions
  calculatedInflows?: number;
  calculatedOutflows?: number;
  limit?: number;
  dueDate?: string;
  statusText?: string;
  metaRow1Label: string;
  metaRow1Value: string;
  metaRow2Label: string;
  metaRow2Value: string;
  metaRow2Highlight?: boolean;
  accentTheme: 'orange' | 'purple' | 'amber' | 'dark-purple' | 'slate' | 'blue';
}

export type GoalStatus = 'active' | 'completed' | 'paused';

export interface GoalItem {
  id: string;
  name: string;
  category: string;
  priorityBadge: string;
  icon: string;
  theme: 'primary' | 'tertiary' | 'amber' | 'secondary';
  currentAmount: number;
  targetAmount: number;
  targetDateLabel: string;
  targetDateIso: string;
  monthsRemainingLabel: string;
  monthlyContribution: number;
  paceStatus: 'ideal' | 'warning' | 'completed';
  status: GoalStatus;
  linkedAccount: string;
  completedDateLabel?: string;
}

export interface UserProfile {
  name: string;
  email: string;
  phone: string;
  occupation: string;
  plan: string;
  memberSince: string;
  supabaseId: string;
  avatarHeaderUrl: string;
  avatarPortraitUrl: string;
  currency: string;
  fiscalMonthStart: string;
  dateFormat: string;
  budgetCeilingAlert: boolean;
  twoFactorEnabled: boolean;
}

export interface ActiveSession {
  id: string;
  device: string;
  versionOrBadge: string;
  isCurrent: boolean;
  locationAndIp: string;
  icon: string;
}

export interface NotificationItem {
  id: string;
  title: string;
  description: string;
  time: string;
  read: boolean;
  icon: string;
  tone: 'primary' | 'warning' | 'info';
}

export interface MonthlySummaryPoint {
  monthKey: string; // YYYY-MM
  monthLabel: string; // e.g., "Outubro, 2026"
  shortLabel: string; // e.g., "Out (Atual)" or "Set 26"
  quarter: string; // e.g., "4º Trimestre 2026"
  income: number;
  expenses: number;
  net: number;
  savingsRate: number;
  incomePct: number;
  expensePct: number;
  statusLabel: string;
  statusTone: 'superada' | 'esperado' | 'recorde' | 'atencao';
  isCurrent?: boolean;
  isHighlight?: boolean;
  txCount: number;
}

export interface CategoryBreakdownItem {
  id: string;
  name: string;
  amount: number;
  pct: number;
  color: string;
  dotClass: string;
  icon: string;
  count: number;
  budget: number;
}
