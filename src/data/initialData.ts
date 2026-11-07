import { Category, UserProfile } from '../types/finance';

export const BRAND_LOGO_URL =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuCA5CnR7b9H-bZtDeiDH18I0LlsTmicfSfDfq19NDvIukLIzIEcDBihp3NlIQUI_pMPvD8ZJpPQsPp4FCKdml06oq4M8gNNV8KcXLB9SUSDddlKEwDN8Iyi-1QuLip2jixj_D1MN9eKxgbsJllSZc7cayqStXJR8XNJGLbzTFxfmsu9brNdJwt-v43hyRcQ_5OsZayXYscuiOWNYcwUKCKEbp3vAES5bFAL3DOfEulth1lXtR-IH1T6';

export interface MonthDefinition {
  key: string; // YYYY-MM
  label: string; // e.g., 'Outubro, 2026'
  shortLabel: string; // e.g., 'Out'
  shortYearLabel: string; // e.g., 'Out 26'
  quarter: string;
}

const PT_MONTH_NAMES = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

const PT_MONTH_SHORT = [
  'Jan',
  'Fev',
  'Mar',
  'Abr',
  'Mai',
  'Jun',
  'Jul',
  'Ago',
  'Set',
  'Out',
  'Nov',
  'Dez',
];

function toLocalIsoDate(d: Date): string {
  const yr = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yr}-${mm}-${dd}`;
}

export function getTodayIso(): string {
  return toLocalIsoDate(new Date());
}

function getYesterdayIso(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return toLocalIsoDate(d);
}

export function getCurrentMonthKey(): string {
  return getTodayIso().slice(0, 7);
}

export function getQuarterLabelFromMonthKey(monthKey: string): string {
  const [yrStr, mmStr] = monthKey.split('-');
  const mm = Math.max(1, Math.min(12, Number(mmStr) || 1));
  const q = Math.ceil(mm / 3);
  return `${q}º Trimestre ${yrStr}`;
}

export function createMonthDefinition(monthKey: string): MonthDefinition {
  const [yrStr, mmStr] = monthKey.split('-');
  const idx = Math.max(0, Math.min(11, (Number(mmStr) || 1) - 1));
  const shortYr = (yrStr || '').slice(-2);
  return {
    key: monthKey,
    label: `${PT_MONTH_NAMES[idx]}, ${yrStr}`,
    shortLabel: PT_MONTH_SHORT[idx],
    shortYearLabel: `${PT_MONTH_SHORT[idx]} ${shortYr}`,
    quarter: getQuarterLabelFromMonthKey(monthKey),
  };
}

export function buildMonthsCatalog(extraDates: string[] = []): MonthDefinition[] {
  const now = new Date();
  const keysSet = new Set<string>();

  // 12 months before current month up to 6 months ahead
  for (let offset = -12; offset <= 6; offset += 1) {
    const dt = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
    keysSet.add(key);
  }

  for (const rawDate of extraDates) {
    if (rawDate && rawDate.length >= 7 && /^\d{4}-\d{2}/.test(rawDate)) {
      keysSet.add(rawDate.slice(0, 7));
    }
  }

  return Array.from(keysSet)
    .sort((a, b) => a.localeCompare(b))
    .map(createMonthDefinition);
}

export const MONTHS_CATALOG: MonthDefinition[] = buildMonthsCatalog();

export const AVAILABLE_MONTHS: string[] = MONTHS_CATALOG.map((m) => m.label);

export const CURRENT_MONTH_INDEX: number = Math.max(
  0,
  MONTHS_CATALOG.findIndex((m) => m.key === getCurrentMonthKey())
);

export function getMonthKeyFromLabel(label: string): string {
  const found = MONTHS_CATALOG.find((m) => m.label === label);
  if (found) return found.key;
  const parts = label.split(',').map((s) => s.trim());
  const mIdx = PT_MONTH_NAMES.findIndex((n) => n.toLowerCase() === (parts[0] || '').toLowerCase());
  const yr = parts[1] || String(new Date().getFullYear());
  if (mIdx >= 0) {
    return `${yr}-${String(mIdx + 1).padStart(2, '0')}`;
  }
  return getCurrentMonthKey();
}

export function getMonthLabelFromKey(monthKey: string): string {
  if (!monthKey || !monthKey.includes('-')) return monthKey;
  const [yr, mm] = monthKey.split('-');
  const idx = Math.max(0, Math.min(11, Number(mm) - 1));
  return `${PT_MONTH_NAMES[idx]}, ${yr}`;
}

export function formatDateLabelPT(isoDate: string): string {
  if (!isoDate || !isoDate.includes('-')) return isoDate;
  const cleanIso = isoDate.slice(0, 10);
  const todayIso = getTodayIso();
  const yesterdayIso = getYesterdayIso();
  if (cleanIso === todayIso) return 'Hoje';
  if (cleanIso === yesterdayIso) return 'Ontem';
  const [yr, mm, dd] = cleanIso.split('-');
  const idx = Math.max(0, Math.min(11, Number(mm) - 1));
  return `${dd} ${PT_MONTH_SHORT[idx]}, ${yr}`;
}

export function formatDateGroupPT(isoDate: string): string {
  if (!isoDate || !isoDate.includes('-')) return isoDate;
  const cleanIso = isoDate.slice(0, 10);
  const [yr, mm, dd] = cleanIso.split('-');
  const idx = Math.max(0, Math.min(11, Number(mm) - 1));
  const todayIso = getTodayIso();
  const yesterdayIso = getYesterdayIso();
  if (cleanIso === todayIso) return `Hoje • ${dd} de ${PT_MONTH_NAMES[idx]}`;
  if (cleanIso === yesterdayIso) return `Ontem • ${dd} de ${PT_MONTH_NAMES[idx]}`;
  const currentYear = String(new Date().getFullYear());
  return yr === currentYear
    ? `${dd} de ${PT_MONTH_NAMES[idx]}`
    : `${dd} de ${PT_MONTH_NAMES[idx]}, ${yr}`;
}

export function formatMemberSincePT(isoTimestamp?: string): string {
  const dt = isoTimestamp ? new Date(isoTimestamp) : new Date();
  if (Number.isNaN(dt.getTime())) return getMonthLabelFromKey(getCurrentMonthKey()).replace(',', ' de');
  return `${PT_MONTH_NAMES[dt.getMonth()]} de ${dt.getFullYear()}`;
}

export function createEmptyUserProfile(params?: {
  id?: string;
  fullName?: string;
  email?: string;
  createdAt?: string;
}): UserProfile {
  const email = params?.email || '';
  const fallbackName = email ? email.split('@')[0] : 'Usuário';
  return {
    name: params?.fullName?.trim() || fallbackName,
    email,
    phone: '',
    occupation: '',
    plan: 'Plano Pessoal',
    memberSince: formatMemberSincePT(params?.createdAt),
    supabaseId: params?.id || '',
    avatarHeaderUrl: '',
    avatarPortraitUrl: '',
    currency: 'Real Brasileiro (BRL - R$)',
    fiscalMonthStart: 'Dia 01 (Padrão)',
    dateFormat: 'DD/MM/AAAA (Brasil)',
    budgetCeilingAlert: true,
    twoFactorEnabled: false,
  };
}

/**
 * Sugestões opcionais de estrutura de categorias caso o usuário deseje popular o banco inicial
 * ou selecionar uma categoria padrão ao registrar sua primeira movimentação.
 * Não contém valores demonstrativos.
 */
export const STARTER_CATEGORY_TEMPLATES: Omit<Category, 'id'>[] = [
  {
    name: 'Moradia',
    type: 'despesa',
    icon: 'home',
    colorClass: 'tertiary',
    hexColor: '#0058be',
    budget: 0,
    spent: 0,
    transactionsCount: 0,
    subcategories: [
      { id: 'sub-moradia-1', name: 'Aluguel & Condomínio', spent: 0 },
      { id: 'sub-moradia-2', name: 'Energia, Água & Internet', spent: 0 },
    ],
  },
  {
    name: 'Alimentação',
    type: 'despesa',
    icon: 'restaurant',
    colorClass: 'amber',
    hexColor: '#f59e0b',
    budget: 0,
    spent: 0,
    transactionsCount: 0,
    subcategories: [
      { id: 'sub-alim-1', name: 'Supermercado', spent: 0 },
      { id: 'sub-alim-2', name: 'Restaurantes & Delivery', spent: 0 },
    ],
  },
  {
    name: 'Transporte',
    type: 'despesa',
    icon: 'directions_car',
    colorClass: 'cyan',
    hexColor: '#0891b2',
    budget: 0,
    spent: 0,
    transactionsCount: 0,
    subcategories: [
      { id: 'sub-transp-1', name: 'Combustível & Apps', spent: 0 },
      { id: 'sub-transp-2', name: 'Manutenção', spent: 0 },
    ],
  },
  {
    name: 'Saúde',
    type: 'despesa',
    icon: 'favorite',
    colorClass: 'rose',
    hexColor: '#f43f5e',
    budget: 0,
    spent: 0,
    transactionsCount: 0,
    subcategories: [{ id: 'sub-saude-1', name: 'Farmácia & Consultas', spent: 0 }],
  },
  {
    name: 'Lazer',
    type: 'despesa',
    icon: 'sports_esports',
    colorClass: 'purple',
    hexColor: '#9333ea',
    budget: 0,
    spent: 0,
    transactionsCount: 0,
    subcategories: [{ id: 'sub-lazer-1', name: 'Assinaturas & Passeios', spent: 0 }],
  },
  {
    name: 'Educação',
    type: 'despesa',
    icon: 'school',
    colorClass: 'primary',
    hexColor: '#006948',
    budget: 0,
    spent: 0,
    transactionsCount: 0,
    subcategories: [{ id: 'sub-educ-1', name: 'Cursos & Livros', spent: 0 }],
  },
  {
    name: 'Salário & Remuneração',
    type: 'receita',
    icon: 'payments',
    colorClass: 'primary',
    hexColor: '#006948',
    budget: 0,
    spent: 0,
    transactionsCount: 0,
    subcategories: [{ id: 'sub-rec-1', name: 'Remuneração Principal', spent: 0 }],
  },
  {
    name: 'Serviços & Freelance',
    type: 'receita',
    icon: 'design_services',
    colorClass: 'tertiary',
    hexColor: '#0058be',
    budget: 0,
    spent: 0,
    transactionsCount: 0,
    subcategories: [{ id: 'sub-rec-2', name: 'Projetos & Consultoria', spent: 0 }],
  },
  {
    name: 'Rendimentos & Outros',
    type: 'receita',
    icon: 'trending_up',
    colorClass: 'cyan',
    hexColor: '#0891b2',
    budget: 0,
    spent: 0,
    transactionsCount: 0,
    subcategories: [{ id: 'sub-rec-3', name: 'Proventos & Receitas Extras', spent: 0 }],
  },
];

export function formatBRL(value: number, showSign?: 'plus' | 'minus' | 'auto'): string {
  const abs = Math.abs(value);
  const formatted = abs.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (showSign === 'plus') return `+ R$ ${formatted}`;
  if (showSign === 'minus') return `- R$ ${formatted}`;
  if (showSign === 'auto') {
    return value >= 0 ? `+ R$ ${formatted}` : `- R$ ${formatted}`;
  }
  return `R$ ${formatted}`;
}
