import { createClient, SupabaseClient } from '@supabase/supabase-js';

function sanitizeEnvInput(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().replace(/^['"]+|['"]+$/g, '').trim();
}

const metaEnv = (import.meta as { env?: Record<string, unknown> }).env ?? {};
const nodeEnv =
  typeof process !== 'undefined' && process.env ? (process.env as Record<string, unknown>) : {};

const rawUrl = sanitizeEnvInput(metaEnv.VITE_SUPABASE_URL ?? nodeEnv.VITE_SUPABASE_URL);
const rawAnonKey = sanitizeEnvInput(
  metaEnv.VITE_SUPABASE_ANON_KEY ?? nodeEnv.VITE_SUPABASE_ANON_KEY
);

export type SupabaseConfigErrorCode =
  | 'missing_credentials'
  | 'secret_key_in_url'
  | 'secret_key_blocked'
  | 'url_contains_key'
  | 'dashboard_or_db_url'
  | 'invalid_url'
  | 'invalid_anon_key'
  | 'project_mismatch'
  | 'swapped_or_invalid';

export type EnvVarCheckStatus = 'valid' | 'missing' | 'invalid' | 'secret_blocked';

export interface EnvVarDiagnosticItem {
  name: 'VITE_SUPABASE_URL' | 'VITE_SUPABASE_ANON_KEY';
  status: EnvVarCheckStatus;
  statusLabelPT: string;
  detailPT: string;
}

export interface SupabaseConfigDiagnostics {
  hasIssue: boolean;
  code: SupabaseConfigErrorCode | null;
  title: string;
  message: string;
  checklist: string[];
  envVars: {
    url: EnvVarDiagnosticItem;
    anonKey: EnvVarDiagnosticItem;
  };
}

interface DecodedAnonJwtMeta {
  isJwt: boolean;
  role: string | null;
  ref: string | null;
  expired: boolean;
}

const JWT_TOKEN_PATTERN = /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;
const DNS_LABEL_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

function decodeJwtMetadataSafe(token: string): DecodedAnonJwtMeta {
  const parts = token.split('.');
  if (parts.length !== 3 || !token.startsWith('eyJ')) {
    return { isJwt: false, role: null, ref: null, expired: false };
  }
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const decoded = JSON.parse(atob(padded)) as {
      role?: string;
      ref?: string;
      exp?: number;
    };
    const expired =
      typeof decoded.exp === 'number' ? decoded.exp * 1000 < Date.now() - 30_000 : false;
    return {
      isJwt: true,
      role: typeof decoded.role === 'string' ? decoded.role : null,
      ref: typeof decoded.ref === 'string' ? decoded.ref : null,
      expired,
    };
  } catch {
    return { isJwt: false, role: null, ref: null, expired: false };
  }
}

function isLikelySecretValue(val: string): boolean {
  if (!val) return false;
  if (
    val === '__BLOCKED_SECRET_KEY__' ||
    val === '__BLOCKED_SECRET_KEY_IN_URL__' ||
    val.includes('sb_secret_')
  ) {
    return true;
  }
  const match = val.match(JWT_TOKEN_PATTERN);
  if (match) {
    const meta = decodeJwtMetadataSafe(match[0]);
    if (meta.role === 'service_role' || meta.role === 'supabase_admin') {
      return true;
    }
  }
  return false;
}

interface UrlValidationResult {
  valid: boolean;
  normalizedOrigin: string;
  projectRefFromHost: string | null;
  reason:
    | 'ok'
    | 'missing'
    | 'secret_in_url'
    | 'key_in_url'
    | 'dashboard_url'
    | 'postgres_uri'
    | 'invalid_protocol'
    | 'invalid_hostname';
}

function validateSupabaseUrl(input: string): UrlValidationResult {
  if (!input || input.includes('YOUR_') || input.includes('MY_') || input.includes('example.supabase.co')) {
    return { valid: false, normalizedOrigin: '', projectRefFromHost: null, reason: 'missing' };
  }

  if (input === '__BLOCKED_SECRET_KEY_IN_URL__' || isLikelySecretValue(input)) {
    return { valid: false, normalizedOrigin: '', projectRefFromHost: null, reason: 'secret_in_url' };
  }

  if (
    input === '__URL_CONTAINS_JWT_TOKEN__' ||
    input === '__BLOCKED_SECRET_KEY__' ||
    input.includes('sb_publishable_') ||
    input.startsWith('eyJ') ||
    JWT_TOKEN_PATTERN.test(input)
  ) {
    return { valid: false, normalizedOrigin: '', projectRefFromHost: null, reason: 'key_in_url' };
  }

  if (/^postgres(?:ql)?:\/\//i.test(input)) {
    return { valid: false, normalizedOrigin: '', projectRefFromHost: null, reason: 'postgres_uri' };
  }

  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return { valid: false, normalizedOrigin: '', projectRefFromHost: null, reason: 'invalid_hostname' };
  }

  const host = parsed.hostname.toLowerCase();

  if (
    (host === 'supabase.com' || host === 'app.supabase.com' || host.endsWith('.supabase.com')) &&
    parsed.pathname.includes('/project/')
  ) {
    return { valid: false, normalizedOrigin: '', projectRefFromHost: null, reason: 'dashboard_url' };
  }

  if (host.startsWith('db.') && host.endsWith('.supabase.co')) {
    return { valid: false, normalizedOrigin: '', projectRefFromHost: null, reason: 'postgres_uri' };
  }

  const isLocalhost = host === 'localhost' || host === '127.0.0.1';
  if (parsed.protocol !== 'https:' && !(isLocalhost && parsed.protocol === 'http:')) {
    return { valid: false, normalizedOrigin: '', projectRefFromHost: null, reason: 'invalid_protocol' };
  }

  if (parsed.username || parsed.password) {
    return { valid: false, normalizedOrigin: '', projectRefFromHost: null, reason: 'postgres_uri' };
  }

  // Validate RFC 1035 DNS labels so malformed strings (e.g., tokens pasted inside https://...co) never pass
  if (!isLocalhost) {
    const labels = host.split('.');
    if (
      labels.length < 2 ||
      host.length > 253 ||
      labels.some((lbl) => !lbl || lbl.length > 63 || !DNS_LABEL_REGEX.test(lbl)) ||
      labels[0].startsWith('eyj')
    ) {
      return {
        valid: false,
        normalizedOrigin: '',
        projectRefFromHost: null,
        reason: 'invalid_hostname',
      };
    }

    // Standard Supabase cloud projects follow <20-char-ref>.supabase.co
    if (host.endsWith('.supabase.co')) {
      const subParts = host.slice(0, -'.supabase.co'.length).split('.');
      if (subParts.length !== 1 || subParts[0].length < 10 || subParts[0].length > 40) {
        return {
          valid: false,
          normalizedOrigin: '',
          projectRefFromHost: null,
          reason: 'invalid_hostname',
        };
      }
      const cleanPath = parsed.pathname
        .replace(/\/+(?:rest|auth|storage|functions)\/v1\/?$/i, '')
        .replace(/\/+$/, '');
      return {
        valid: true,
        normalizedOrigin: `${parsed.origin}${cleanPath}`,
        projectRefFromHost: subParts[0],
        reason: 'ok',
      };
    }
  }

  const cleanPath = parsed.pathname
    .replace(/\/+(?:rest|auth|storage|functions)\/v1\/?$/i, '')
    .replace(/\/+$/, '');

  return {
    valid: true,
    normalizedOrigin: `${parsed.origin}${cleanPath}`,
    projectRefFromHost: null,
    reason: 'ok',
  };
}

interface KeyValidationResult {
  valid: boolean;
  projectRefFromJwt: string | null;
  keyKindLabelPT: string;
  reason: 'ok' | 'missing' | 'secret_blocked' | 'looks_like_url' | 'expired_jwt' | 'invalid_format';
}

function validateSupabaseAnonKey(input: string): KeyValidationResult {
  if (!input || input.includes('YOUR_') || input.includes('MY_')) {
    return {
      valid: false,
      projectRefFromJwt: null,
      keyKindLabelPT: 'Ausente',
      reason: 'missing',
    };
  }

  if (isLikelySecretValue(input)) {
    return {
      valid: false,
      projectRefFromJwt: null,
      keyKindLabelPT: 'Chave secreta bloqueada',
      reason: 'secret_blocked',
    };
  }

  if (/^https?:\/\//i.test(input)) {
    return {
      valid: false,
      projectRefFromJwt: null,
      keyKindLabelPT: 'Contém URL em vez de chave',
      reason: 'looks_like_url',
    };
  }

  if (input.startsWith('sb_publishable_') && input.length >= 25) {
    return {
      valid: true,
      projectRefFromJwt: null,
      keyKindLabelPT: 'Chave pública (publishable)',
      reason: 'ok',
    };
  }

  if (input.startsWith('eyJ')) {
    const meta = decodeJwtMetadataSafe(input);
    if (!meta.isJwt) {
      return {
        valid: false,
        projectRefFromJwt: null,
        keyKindLabelPT: 'Token JWT truncado ou inválido',
        reason: 'invalid_format',
      };
    }
    if (meta.role === 'service_role' || meta.role === 'supabase_admin') {
      return {
        valid: false,
        projectRefFromJwt: null,
        keyKindLabelPT: 'Chave secreta bloqueada',
        reason: 'secret_blocked',
      };
    }
    if (meta.expired) {
      return {
        valid: false,
        projectRefFromJwt: meta.ref,
        keyKindLabelPT: 'Chave pública expirada',
        reason: 'expired_jwt',
      };
    }
    return {
      valid: true,
      projectRefFromJwt: meta.ref,
      keyKindLabelPT: 'Chave pública (anon)',
      reason: 'ok',
    };
  }

  return {
    valid: false,
    projectRefFromJwt: null,
    keyKindLabelPT: 'Formato não reconhecido',
    reason: 'invalid_format',
  };
}

/**
 * Armazenamento resiliente para sessões Supabase Auth:
 * utiliza localStorage quando disponível e faz fallback em memória caso o navegador
 * restrinja cookies/storage em iframes.
 */
const memoryStorage = new Map<string, string>();
const safeAuthStorage = {
  getItem(key: string): string | null {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage.getItem(key);
      }
    } catch {
      // Fallback em memória
    }
    return memoryStorage.get(key) ?? null;
  },
  setItem(key: string, value: string): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(key, value);
        return;
      }
    } catch {
      // Fallback em memória
    }
    memoryStorage.set(key, value);
  },
  removeItem(key: string): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(key);
      }
    } catch {
      // Fallback em memória
    }
    memoryStorage.delete(key);
  },
};

const urlCheck = validateSupabaseUrl(rawUrl);
const keyCheck = validateSupabaseAnonKey(rawAnonKey);

function buildEnvVarItems(): { url: EnvVarDiagnosticItem; anonKey: EnvVarDiagnosticItem } {
  const urlItem: EnvVarDiagnosticItem = urlCheck.valid
    ? {
        name: 'VITE_SUPABASE_URL',
        status: 'valid',
        statusLabelPT: 'Configurada',
        detailPT: 'Formato HTTPS válido.',
      }
    : urlCheck.reason === 'missing'
    ? {
        name: 'VITE_SUPABASE_URL',
        status: 'missing',
        statusLabelPT: 'Ausente',
        detailPT: 'Variável vazia ou não definida.',
      }
    : urlCheck.reason === 'secret_in_url'
    ? {
        name: 'VITE_SUPABASE_URL',
        status: 'secret_blocked',
        statusLabelPT: 'Chave secreta bloqueada na URL',
        detailPT:
          'Um token secreto (service_role / sb_secret_) foi colado dentro de VITE_SUPABASE_URL e bloqueado por segurança.',
      }
    : urlCheck.reason === 'key_in_url'
    ? {
        name: 'VITE_SUPABASE_URL',
        status: 'invalid',
        statusLabelPT: 'Contém chave em vez de URL',
        detailPT: 'Uma chave/token de API foi colada onde deveria estar o domínio .supabase.co.',
      }
    : urlCheck.reason === 'dashboard_url' || urlCheck.reason === 'postgres_uri'
    ? {
        name: 'VITE_SUPABASE_URL',
        status: 'invalid',
        statusLabelPT: 'Tipo de endereço incorreto',
        detailPT:
          urlCheck.reason === 'dashboard_url'
            ? 'Contém link do painel web do Supabase em vez da Project URL da API.'
            : 'Contém string de conexão direta do banco PostgreSQL em vez da Project URL HTTPS.',
      }
    : {
        name: 'VITE_SUPABASE_URL',
        status: 'invalid',
        statusLabelPT: 'URL inválida',
        detailPT: 'Deve seguir o formato https://<id-do-projeto>.supabase.co.',
      };

  const anonKeyItem: EnvVarDiagnosticItem = keyCheck.valid
    ? {
        name: 'VITE_SUPABASE_ANON_KEY',
        status: 'valid',
        statusLabelPT: keyCheck.keyKindLabelPT,
        detailPT: 'Disponível e validada para uso no cliente.',
      }
    : keyCheck.reason === 'missing'
    ? {
        name: 'VITE_SUPABASE_ANON_KEY',
        status: 'missing',
        statusLabelPT: 'Ausente',
        detailPT: 'Variável vazia ou não definida.',
      }
    : keyCheck.reason === 'secret_blocked'
    ? {
        name: 'VITE_SUPABASE_ANON_KEY',
        status: 'secret_blocked',
        statusLabelPT: 'Chave secreta bloqueada',
        detailPT: 'Contém chave secreta (service_role / sb_secret_), bloqueada por segurança.',
      }
    : {
        name: 'VITE_SUPABASE_ANON_KEY',
        status: 'invalid',
        statusLabelPT: keyCheck.keyKindLabelPT,
        detailPT: 'Informe a chave pública anon (eyJ...) ou sb_publishable_...',
      };

  return { url: urlItem, anonKey: anonKeyItem };
}

function buildDiagnostics(): SupabaseConfigDiagnostics {
  const envVars = buildEnvVarItems();

  // Check project ref mismatch when both URL (.supabase.co) and JWT anon key are present
  if (
    urlCheck.valid &&
    keyCheck.valid &&
    urlCheck.projectRefFromHost &&
    keyCheck.projectRefFromJwt &&
    urlCheck.projectRefFromHost !== keyCheck.projectRefFromJwt
  ) {
    return {
      hasIssue: true,
      code: 'project_mismatch',
      title: 'URL e chave pública pertencem a projetos diferentes',
      message:
        'A URL configurada em VITE_SUPABASE_URL aponta para um projeto Supabase diferente daquele associado à chave VITE_SUPABASE_ANON_KEY.',
      checklist: [
        'Abra Project Settings → API / Data API no mesmo projeto Supabase e copie a Project URL e a chave pública anon correspondentes.',
      ],
      envVars: {
        url: {
          ...envVars.url,
          status: 'invalid',
          statusLabelPT: 'Projeto divergente',
          detailPT: 'O identificador do subdomínio difere do projeto da chave anon.',
        },
        anonKey: envVars.anonKey,
      },
    };
  }

  if (urlCheck.valid && keyCheck.valid) {
    return {
      hasIssue: false,
      code: null,
      title: 'Supabase configurado',
      message: 'Variáveis de ambiente validadas.',
      checklist: [],
      envVars,
    };
  }

  if (urlCheck.reason === 'missing' && keyCheck.reason === 'missing') {
    return {
      hasIssue: true,
      code: 'missing_credentials',
      title: 'Configuração do Supabase pendente',
      message:
        'Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY nas configurações de ambiente para habilitar cadastro, login e banco de dados.',
      checklist: [
        'VITE_SUPABASE_URL: URL HTTPS do projeto (formato https://<id-do-projeto>.supabase.co).',
        'VITE_SUPABASE_ANON_KEY: chave pública anon (eyJ...) ou publishable (sb_publishable_...).',
      ],
      envVars,
    };
  }

  if (urlCheck.reason === 'secret_in_url') {
    return {
      hasIssue: true,
      code: 'secret_key_in_url',
      title: 'Token secreto detectado dentro de VITE_SUPABASE_URL',
      message: keyCheck.valid
        ? 'VITE_SUPABASE_ANON_KEY já está configurada corretamente como chave pública (anon), mas VITE_SUPABASE_URL recebeu um token JWT secreto (service_role) colado dentro do endereço https://... em vez do domínio do projeto. Por segurança, o token secreto foi bloqueado.'
        : 'Um token secreto (service_role / sb_secret_) foi colado dentro de VITE_SUPABASE_URL em vez do domínio do projeto e foi bloqueado por segurança.',
      checklist: [
        'No painel do Supabase, acesse Project Settings → Data API (ou API) e copie apenas a Project URL no formato https://<id-de-20-caracteres>.supabase.co.',
        'Substitua o valor de VITE_SUPABASE_URL por essa Project URL (sem colar tokens eyJ... no endereço).',
        ...(keyCheck.valid
          ? ['Mantenha VITE_SUPABASE_ANON_KEY como está (chave pública anon já validada).']
          : ['Em VITE_SUPABASE_ANON_KEY, informe apenas a chave pública anon / publishable.']),
      ],
      envVars,
    };
  }

  if (urlCheck.reason === 'key_in_url' && keyCheck.reason === 'secret_blocked') {
    return {
      hasIssue: true,
      code: 'swapped_or_invalid',
      title: 'Ajuste necessário nas variáveis do Supabase',
      message:
        'VITE_SUPABASE_URL contém uma chave/token de API em vez da URL HTTPS do projeto, e VITE_SUPABASE_ANON_KEY contém uma chave secreta (bloqueada por segurança).',
      checklist: [
        'Em VITE_SUPABASE_URL, cole a Project URL (formato https://<id-do-projeto>.supabase.co).',
        'Em VITE_SUPABASE_ANON_KEY, cole apenas a chave pública (anon ou sb_publishable_...) e remova qualquer chave secreta.',
      ],
      envVars,
    };
  }

  if (keyCheck.reason === 'secret_blocked') {
    return {
      hasIssue: true,
      code: 'secret_key_blocked',
      title: 'Chave secreta bloqueada em VITE_SUPABASE_ANON_KEY',
      message:
        'Uma chave secreta (service_role ou sb_secret_) foi detectada e bloqueada antes de ir para o navegador. Use exclusivamente a chave pública no frontend.',
      checklist: [
        'Substitua VITE_SUPABASE_ANON_KEY pela chave pública anon (eyJ...) ou publishable (sb_publishable_...) em Project Settings → API Keys.',
      ],
      envVars,
    };
  }

  if (urlCheck.reason === 'key_in_url') {
    return {
      hasIssue: true,
      code: 'url_contains_key',
      title: 'VITE_SUPABASE_URL contém uma chave em vez do endereço do projeto',
      message:
        'Foi detectado um token/chave de API dentro de VITE_SUPABASE_URL, o que impede a resolução DNS do servidor do Supabase.',
      checklist: [
        'Copie a Project URL em Project Settings → Data API (formato https://<id-do-projeto>.supabase.co) e salve em VITE_SUPABASE_URL.',
      ],
      envVars,
    };
  }

  if (urlCheck.reason === 'dashboard_url' || urlCheck.reason === 'postgres_uri') {
    return {
      hasIssue: true,
      code: 'dashboard_or_db_url',
      title: 'Endereço incorreto em VITE_SUPABASE_URL',
      message:
        urlCheck.reason === 'dashboard_url'
          ? 'VITE_SUPABASE_URL recebeu o endereço do painel administrativo do Supabase em vez do endpoint HTTPS da API.'
          : 'VITE_SUPABASE_URL recebeu uma string de conexão direta do PostgreSQL em vez da Project URL HTTPS.',
      checklist: [
        'Em Project Settings → Data API, copie a Project URL no formato https://<id-do-projeto>.supabase.co e salve em VITE_SUPABASE_URL.',
      ],
      envVars,
    };
  }

  if (!urlCheck.valid) {
    return {
      hasIssue: true,
      code: 'invalid_url',
      title: 'VITE_SUPABASE_URL inválida ou ausente',
      message:
        'O endereço configurado em VITE_SUPABASE_URL não é um domínio HTTPS válido do Supabase.',
      checklist: [
        'Informe a Project URL completa em VITE_SUPABASE_URL (ex: https://<id-do-projeto>.supabase.co).',
      ],
      envVars,
    };
  }

  return {
    hasIssue: true,
    code: 'invalid_anon_key',
    title: 'VITE_SUPABASE_ANON_KEY inválida ou ausente',
    message:
      'A chave pública do Supabase está vazia, expirada ou em formato inválido para inicialização do cliente.',
    checklist: [
      'Copie a chave pública anon (eyJ...) ou publishable (sb_publishable_...) em Project Settings → API Keys e salve em VITE_SUPABASE_ANON_KEY.',
    ],
    envVars,
  };
}

export const supabaseConfigDiagnostics: SupabaseConfigDiagnostics = buildDiagnostics();

export const isSupabaseConfigured: boolean = !supabaseConfigDiagnostics.hasIssue;

export const supabaseUrl: string = isSupabaseConfigured ? urlCheck.normalizedOrigin : '';
export const supabaseAnonKey: string = isSupabaseConfigured ? rawAnonKey : '';

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: safeAuthStorage,
      },
    })
  : null;

export interface ClientSecurityPosture {
  isConfigured: boolean;
  httpsEnforced: boolean;
  publicKeyKind: string;
  jwtRole: string | null;
  hasSecretKeyExposed: boolean;
  blockedEnvVariables: string[];
  projectRefMatched: boolean;
}

/**
 * Inspects the runtime client environment without exposing any key values or secrets.
 */
export function getClientSecurityPosture(): ClientSecurityPosture {
  const blockedVars: string[] = [];
  let hasSecret = false;

  const inspectRecord = (rec: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(rec)) {
      if (!k.startsWith('VITE_')) continue;
      const strVal = typeof v === 'string' ? v.trim() : '';
      if (!strVal) continue;
      if (strVal === '__BLOCKED_SECRET_KEY__' || strVal === '__BLOCKED_SECRET_KEY_IN_URL__') {
        blockedVars.push(k);
        continue;
      }
      if (isLikelySecretValue(strVal)) {
        hasSecret = true;
        blockedVars.push(k);
      }
    }
  };

  inspectRecord(metaEnv);

  const decodedKey = rawAnonKey.startsWith('eyJ') ? decodeJwtMetadataSafe(rawAnonKey) : null;
  const httpsEnforced = Boolean(
    urlCheck.valid &&
      (urlCheck.normalizedOrigin.startsWith('https://') ||
        urlCheck.normalizedOrigin.startsWith('http://localhost') ||
        urlCheck.normalizedOrigin.startsWith('http://127.0.0.1'))
  );

  const projectRefMatched =
    !urlCheck.projectRefFromHost ||
    !keyCheck.projectRefFromJwt ||
    urlCheck.projectRefFromHost === keyCheck.projectRefFromJwt;

  return {
    isConfigured: isSupabaseConfigured,
    httpsEnforced,
    publicKeyKind: keyCheck.keyKindLabelPT,
    jwtRole: decodedKey?.isJwt ? decodedKey.role : rawAnonKey.startsWith('sb_publishable_') ? 'anon (publishable)' : null,
    hasSecretKeyExposed: hasSecret,
    blockedEnvVariables: Array.from(new Set(blockedVars)),
    projectRefMatched,
  };
}

/**
 * Creates a strictly isolated, stateless anonymous Supabase client (`persistSession: false`)
 * used exclusively to verify that unauthenticated (`anon`) requests cannot read protected user rows.
 */
export function createEphemeralAnonymousClient(): SupabaseClient | null {
  if (!isSupabaseConfigured || !supabaseUrl || !supabaseAnonKey) {
    return null;
  }
  const noopStorage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  };
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: 'financerto-ephemeral-anon-audit',
      storage: noopStorage,
    },
  });
}
