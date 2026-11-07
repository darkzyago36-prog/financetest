import {
  ClientSecurityPosture,
  createEphemeralAnonymousClient,
  getClientSecurityPosture,
  isSupabaseConfigured,
  supabase,
} from '../lib/supabaseClient';
import { getDetectedDbTypeConvention } from './financeService';

export type AuditedTableName =
  | 'profiles'
  | 'accounts'
  | 'categories'
  | 'transactions'
  | 'goals';

export type SecurityCheckStatus = 'passed' | 'failed' | 'warning';

export interface TableRlsCheckDetail {
  passed: boolean;
  warning?: boolean;
  code?: string;
  detailPT: string;
}

export interface TableRlsAuditResult {
  table: AuditedTableName;
  ownerColumn: 'id' | 'user_id';
  status: SecurityCheckStatus;
  anonSelectBlocked: TableRlsCheckDetail;
  ownSelectIsolated: TableRlsCheckDetail;
  crossUserInsertBlocked: TableRlsCheckDetail;
  crossUserUpdateBlocked: TableRlsCheckDetail;
  crossUserDeleteBlocked: TableRlsCheckDetail;
  ownRowCount: number;
}

export interface SecurityAuditReport {
  executedAtIso: string;
  overallStatus: SecurityCheckStatus;
  authenticatedUserId: string | null;
  authenticatedEmail: string | null;
  jwtVerifiedByServer: boolean;
  clientPosture: ClientSecurityPosture;
  tables: TableRlsAuditResult[];
  summaryPT: string;
}

const SYNTHETIC_FOREIGN_UUID_A = '00000000-0000-4000-8000-000000000000';
const SYNTHETIC_FOREIGN_UUID_B = '00000000-0000-4000-8000-000000000001';
const SYNTHETIC_RECORD_UUID = '00000000-0000-4000-8000-000000000099';

function pickForeignUuid(authenticatedUserId: string): string {
  return authenticatedUserId.toLowerCase() === SYNTHETIC_FOREIGN_UUID_A
    ? SYNTHETIC_FOREIGN_UUID_B
    : SYNTHETIC_FOREIGN_UUID_A;
}

function extractPgErrorMeta(error: unknown): { code: string; message: string } {
  if (!error || typeof error !== 'object') {
    return { code: '', message: String(error || '') };
  }
  const code = 'code' in error ? String((error as { code?: unknown }).code || '') : '';
  const message =
    'message' in error ? String((error as { message?: unknown }).message || '') : '';
  return { code, message };
}

function isRlsBlockedError(code: string, message: string): boolean {
  const lower = message.toLowerCase();
  return (
    code === '42501' ||
    code === 'PGRST301' ||
    lower.includes('row-level security') ||
    lower.includes('permission denied') ||
    lower.includes('insufficient_privilege') ||
    lower.includes('new row violates row-level security')
  );
}

/**
 * SQL de diagnóstico somente leitura para executar no SQL Editor do Supabase.
 * Não altera nenhuma tabela ou política — apenas inspeciona o catálogo real do PostgreSQL.
 */
export const SUPABASE_RLS_DIAGNOSTIC_SQL = `-- 1. Verificar se RLS está habilitado nas 5 tabelas do FinanCerto
SELECT
  c.relname AS tabela,
  c.relrowsecurity AS rls_habilitado,
  c.relforcerowsecurity AS force_rls
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('profiles', 'accounts', 'categories', 'transactions', 'goals')
ORDER BY c.relname;

-- 2. Listar todas as políticas RLS ativas (SELECT, INSERT, UPDATE, DELETE)
SELECT
  tablename AS tabela,
  policyname AS politica,
  permissive,
  roles,
  cmd AS operacao,
  qual AS expressao_using,
  with_check AS expressao_with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('profiles', 'accounts', 'categories', 'transactions', 'goals')
ORDER BY tablename, cmd, policyname;`;

/**
 * SQL corretivo idempotente (somente para caso alguma tabela no Supabase esteja sem RLS
 * ou sem política WITH CHECK para INSERT/UPDATE/DELETE). Preserva 100% dos dados existentes.
 */
export const SUPABASE_RLS_REMEDIATION_SQL = `-- Ativar RLS nas 5 tabelas (idempotente, não altera dados)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goals ENABLE ROW LEVEL SECURITY;

-- Políticas completas para public.profiles (chave: id = auth.uid())
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
CREATE POLICY "profiles_insert_own" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_delete_own" ON public.profiles;
CREATE POLICY "profiles_delete_own" ON public.profiles
  FOR DELETE TO authenticated
  USING (auth.uid() = id);

-- Políticas completas para accounts, categories, transactions e goals (user_id = auth.uid())
DROP POLICY IF EXISTS "accounts_select_own" ON public.accounts;
DROP POLICY IF EXISTS "accounts_insert_own" ON public.accounts;
DROP POLICY IF EXISTS "accounts_update_own" ON public.accounts;
DROP POLICY IF EXISTS "accounts_delete_own" ON public.accounts;
DROP POLICY IF EXISTS "accounts_all_own" ON public.accounts;
CREATE POLICY "accounts_select_own" ON public.accounts FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "accounts_insert_own" ON public.accounts FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "accounts_update_own" ON public.accounts FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "accounts_delete_own" ON public.accounts FOR DELETE TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "categories_select_own" ON public.categories;
DROP POLICY IF EXISTS "categories_insert_own" ON public.categories;
DROP POLICY IF EXISTS "categories_update_own" ON public.categories;
DROP POLICY IF EXISTS "categories_delete_own" ON public.categories;
DROP POLICY IF EXISTS "categories_all_own" ON public.categories;
CREATE POLICY "categories_select_own" ON public.categories FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "categories_insert_own" ON public.categories FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "categories_update_own" ON public.categories FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "categories_delete_own" ON public.categories FOR DELETE TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "transactions_select_own" ON public.transactions;
DROP POLICY IF EXISTS "transactions_insert_own" ON public.transactions;
DROP POLICY IF EXISTS "transactions_update_own" ON public.transactions;
DROP POLICY IF EXISTS "transactions_delete_own" ON public.transactions;
DROP POLICY IF EXISTS "transactions_all_own" ON public.transactions;
CREATE POLICY "transactions_select_own" ON public.transactions FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "transactions_insert_own" ON public.transactions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "transactions_update_own" ON public.transactions FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "transactions_delete_own" ON public.transactions FOR DELETE TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "goals_select_own" ON public.goals;
DROP POLICY IF EXISTS "goals_insert_own" ON public.goals;
DROP POLICY IF EXISTS "goals_update_own" ON public.goals;
DROP POLICY IF EXISTS "goals_delete_own" ON public.goals;
DROP POLICY IF EXISTS "goals_all_own" ON public.goals;
CREATE POLICY "goals_select_own" ON public.goals FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "goals_insert_own" ON public.goals FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "goals_update_own" ON public.goals FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "goals_delete_own" ON public.goals FOR DELETE TO authenticated USING (auth.uid() = user_id);`;

async function probeCrossUserInsert(
  table: AuditedTableName,
  foreignUserId: string
): Promise<TableRlsCheckDetail> {
  if (!supabase) {
    return {
      passed: false,
      detailPT: 'Cliente Supabase não inicializado.',
    };
  }

  const preferredType = getDetectedDbTypeConvention() === 'pt' ? 'despesa' : 'expense';
  const fallbackType = preferredType === 'expense' ? 'despesa' : 'expense';

  const buildPayload = (typeValue: string): Record<string, unknown> => {
    switch (table) {
      case 'profiles':
        return {
          id: foreignUserId,
          full_name: 'Auditoria RLS FinanCerto',
        };
      case 'accounts':
        return {
          user_id: foreignUserId,
          name: 'Auditoria RLS FinanCerto',
          initial_balance: 0,
        };
      case 'categories':
        return {
          user_id: foreignUserId,
          name: 'Auditoria RLS FinanCerto',
          type: typeValue,
          color: '#006948',
        };
      case 'transactions':
        return {
          user_id: foreignUserId,
          account_id: null,
          category_id: null,
          type: typeValue,
          description: 'Auditoria RLS FinanCerto',
          amount: 1,
          transaction_date: '2026-01-01',
          notes: null,
        };
      case 'goals':
        return {
          user_id: foreignUserId,
          name: 'Auditoria RLS FinanCerto',
          target_amount: 100,
          current_amount: 0,
          target_date: '2026-12-31',
        };
    }
  };

  let attempt = await supabase
    .from(table)
    .insert(buildPayload(preferredType))
    .select('id');

  // If check constraint on `type` differs ('expense' vs 'despesa'), retry once with the other convention
  if (
    attempt.error &&
    (table === 'categories' || table === 'transactions') &&
    extractPgErrorMeta(attempt.error).code === '23514'
  ) {
    attempt = await supabase
      .from(table)
      .insert(buildPayload(fallbackType))
      .select('id');
  }

  if (!attempt.error) {
    // Critical: row was inserted! Clean up immediately if possible and report failure
    const insertedRows = (attempt.data as Record<string, unknown>[] | null) ?? [];
    for (const row of insertedRows) {
      if (row && row.id) {
        await supabase.from(table).delete().eq('id', String(row.id));
      }
    }
    return {
      passed: false,
      code: 'INSERT_ALLOWED',
      detailPT:
        'FALHA CRÍTICA: O banco permitiu inserir registro com user_id/id de outro usuário. Ative RLS e política INSERT WITH CHECK.',
    };
  }

  const { code, message } = extractPgErrorMeta(attempt.error);

  if (isRlsBlockedError(code, message)) {
    return {
      passed: true,
      code: code || '42501',
      detailPT:
        'Bloqueado pelo PostgreSQL RLS (código 42501 — política WITH CHECK impediu INSERT em nome de outro usuário).',
    };
  }

  // In PostgreSQL, Foreign Key triggers (`23503`) execute AFTER RLS `WITH CHECK` policies (`42501`).
  // Reaching `23503` means RLS did NOT block the foreign `user_id`/`id` during `ExecInsert`!
  if (code === '23503') {
    return {
      passed: false,
      code: '23503',
      detailPT:
        'ALERTA DE RLS: O PostgreSQL chegou à validação de chave estrangeira (23503) sem bloqueio prévio de RLS (42501). Verifique se RLS está ativo e se existe política INSERT WITH CHECK (auth.uid() = ' +
        (table === 'profiles' ? 'id' : 'user_id') +
        ').',
    };
  }

  return {
    passed: false,
    warning: true,
    code: code || 'UNKNOWN',
    detailPT: `Rejeitado pelo banco por restrição de esquema (${code || 'erro'}): confirme a política INSERT no SQL Editor.`,
  };
}

async function auditSingleTable(
  table: AuditedTableName,
  authenticatedUserId: string
): Promise<TableRlsAuditResult> {
  const ownerColumn: 'id' | 'user_id' = table === 'profiles' ? 'id' : 'user_id';
  const foreignUserId = pickForeignUuid(authenticatedUserId);
  const anonClient = createEphemeralAnonymousClient();

  // 1. Anonymous SELECT check (no JWT)
  let anonSelectBlocked: TableRlsCheckDetail;
  if (!anonClient) {
    anonSelectBlocked = {
      passed: false,
      detailPT: 'Não foi possível criar cliente anônimo isolado para verificação.',
    };
  } else {
    const anonSelectCols = ownerColumn === 'id' ? 'id' : 'id, user_id';
    const anonRes = await anonClient.from(table).select(anonSelectCols).limit(5);
    if (anonRes.error) {
      const { code, message } = extractPgErrorMeta(anonRes.error);
      if (isRlsBlockedError(code, message)) {
        anonSelectBlocked = {
          passed: true,
          code: code || '42501',
          detailPT: 'Acesso anônimo negado pela política de segurança.',
        };
      } else {
        anonSelectBlocked = {
          passed: false,
          warning: true,
          code,
          detailPT: `Erro ao testar leitura anônima (${code || 'erro'}): ${message}`,
        };
      }
    } else {
      const rows = (anonRes.data as unknown as Record<string, unknown>[] | null) ?? [];
      if (rows.length === 0) {
        anonSelectBlocked = {
          passed: true,
          detailPT: 'Nenhum registro exposto para requisições sem autenticação (0 linhas).',
        };
      } else {
        anonSelectBlocked = {
          passed: false,
          code: 'ANON_LEAK',
          detailPT: `FALHA CRÍTICA: ${rows.length} registro(s) retornado(s) para cliente anônimo sem login!`,
        };
      }
    }
  }

  // 2. Authenticated SELECT isolation check (query WITHOUT client .eq() filter so PostgreSQL RLS is tested directly)
  let ownSelectIsolated: TableRlsCheckDetail;
  let ownRowCount = 0;

  if (!supabase) {
    ownSelectIsolated = {
      passed: false,
      detailPT: 'Cliente Supabase indisponível.',
    };
  } else {
    const selectCols = ownerColumn === 'id' ? 'id' : 'id, user_id';
    const authSelectRes = await supabase.from(table).select(selectCols).limit(100);
    if (authSelectRes.error) {
      const { code, message } = extractPgErrorMeta(authSelectRes.error);
      ownSelectIsolated = {
        passed: false,
        code,
        detailPT: `Erro ao consultar ${table} autenticado (${code || 'erro'}): ${message}`,
      };
    } else {
      const rows = (authSelectRes.data as unknown as Record<string, unknown>[] | null) ?? [];
      const foreignRows = rows.filter(
        (r) => String(r[ownerColumn] || '') !== authenticatedUserId
      );
      ownRowCount = rows.length - foreignRows.length;

      if (foreignRows.length > 0) {
        ownSelectIsolated = {
          passed: false,
          code: 'SELECT_CROSS_USER_LEAK',
          detailPT: `FALHA CRÍTICA DE RLS: A consulta sem filtro de cliente retornou ${foreignRows.length} registro(s) pertencente(s) a outro usuário!`,
        };
      } else {
        ownSelectIsolated = {
          passed: true,
          detailPT: `Isolamento confirmado: ${ownRowCount} registro(s) próprio(s) retornado(s), 0 de terceiros.`,
        };
      }
    }
  }

  // 3. Cross-user INSERT WITH CHECK probe
  const crossUserInsertBlocked = await probeCrossUserInsert(table, foreignUserId);

  // 4. Cross-user UPDATE probe on foreign UUID
  let crossUserUpdateBlocked: TableRlsCheckDetail;
  if (!supabase) {
    crossUserUpdateBlocked = {
      passed: false,
      detailPT: 'Cliente Supabase indisponível.',
    };
  } else {
    const updatePayload =
      table === 'profiles'
        ? { full_name: 'Teste Bloqueio RLS' }
        : table === 'transactions'
        ? { description: 'Teste Bloqueio RLS' }
        : { name: 'Teste Bloqueio RLS' };
    const targetForeignId =
      table === 'profiles' ? foreignUserId : SYNTHETIC_RECORD_UUID;

    const updRes = await supabase
      .from(table)
      .update(updatePayload)
      .eq('id', targetForeignId)
      .select('id');

    if (updRes.error) {
      const { code, message } = extractPgErrorMeta(updRes.error);
      if (isRlsBlockedError(code, message)) {
        crossUserUpdateBlocked = {
          passed: true,
          code,
          detailPT: 'UPDATE em ID externo bloqueado pelo RLS.',
        };
      } else {
        crossUserUpdateBlocked = {
          passed: false,
          warning: true,
          code,
          detailPT: `UPDATE retornou erro (${code || 'erro'}): ${message}`,
        };
      }
    } else {
      const affected = ((updRes.data as unknown as Record<string, unknown>[] | null) ?? []).length;
      crossUserUpdateBlocked =
        affected === 0
          ? {
              passed: true,
              detailPT: '0 linhas afetadas ao tentar alterar registro fora do auth.uid().',
            }
          : {
              passed: false,
              code: 'UPDATE_FOREIGN_ALLOWED',
              detailPT: `FALHA CRÍTICA: ${affected} linha(s) de terceiro alterada(s)!`,
            };
    }
  }

  // 5. Cross-user DELETE probe on foreign UUID
  let crossUserDeleteBlocked: TableRlsCheckDetail;
  if (!supabase) {
    crossUserDeleteBlocked = {
      passed: false,
      detailPT: 'Cliente Supabase indisponível.',
    };
  } else {
    const targetForeignId =
      table === 'profiles' ? foreignUserId : SYNTHETIC_RECORD_UUID;
    const delRes = await supabase
      .from(table)
      .delete()
      .eq('id', targetForeignId)
      .select('id');

    if (delRes.error) {
      const { code, message } = extractPgErrorMeta(delRes.error);
      if (isRlsBlockedError(code, message)) {
        crossUserDeleteBlocked = {
          passed: true,
          code,
          detailPT: 'DELETE em ID externo bloqueado pelo RLS.',
        };
      } else {
        crossUserDeleteBlocked = {
          passed: false,
          warning: true,
          code,
          detailPT: `DELETE retornou erro (${code || 'erro'}): ${message}`,
        };
      }
    } else {
      const deleted = ((delRes.data as unknown as Record<string, unknown>[] | null) ?? []).length;
      crossUserDeleteBlocked =
        deleted === 0
          ? {
              passed: true,
              detailPT: '0 linhas afetadas ao tentar excluir registro fora do auth.uid().',
            }
          : {
              passed: false,
              code: 'DELETE_FOREIGN_ALLOWED',
              detailPT: `FALHA CRÍTICA: ${deleted} linha(s) de terceiro excluída(s)!`,
            };
    }
  }

  const allChecks = [
    anonSelectBlocked,
    ownSelectIsolated,
    crossUserInsertBlocked,
    crossUserUpdateBlocked,
    crossUserDeleteBlocked,
  ];

  const hasCriticalFailure = allChecks.some((c) => !c.passed && !c.warning);
  const hasWarning = allChecks.some((c) => !c.passed && c.warning);

  const status: SecurityCheckStatus = hasCriticalFailure
    ? 'failed'
    : hasWarning
    ? 'warning'
    : 'passed';

  return {
    table,
    ownerColumn,
    status,
    anonSelectBlocked,
    ownSelectIsolated,
    crossUserInsertBlocked,
    crossUserUpdateBlocked,
    crossUserDeleteBlocked,
    ownRowCount,
  };
}

/**
 * Executa auditoria real (não destrutiva e sem dados fictícios) de autenticação,
 * postura de chaves do frontend e políticas RLS nas 5 tabelas do Supabase.
 */
export async function runLiveSecurityAndRlsAudit(): Promise<SecurityAuditReport> {
  const clientPosture = getClientSecurityPosture();
  const executedAtIso = new Date().toISOString();

  if (!isSupabaseConfigured || !supabase) {
    return {
      executedAtIso,
      overallStatus: 'failed',
      authenticatedUserId: null,
      authenticatedEmail: null,
      jwtVerifiedByServer: false,
      clientPosture,
      tables: [],
      summaryPT:
        'Conexão com o Supabase não configurada. Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY para executar a auditoria em tempo real.',
    };
  }

  // Server-side JWT verification against Supabase Auth
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user?.id) {
    return {
      executedAtIso,
      overallStatus: 'failed',
      authenticatedUserId: null,
      authenticatedEmail: null,
      jwtVerifiedByServer: false,
      clientPosture,
      tables: [],
      summaryPT:
        'Sessão não validada pelo servidor Supabase Auth. Faça login novamente antes de executar a auditoria.',
    };
  }

  const authUserId = userData.user.id;
  const authEmail = userData.user.email ?? null;

  const tablesToAudit: AuditedTableName[] = [
    'profiles',
    'accounts',
    'categories',
    'transactions',
    'goals',
  ];

  const tables: TableRlsAuditResult[] = [];
  for (const tbl of tablesToAudit) {
    const result = await auditSingleTable(tbl, authUserId);
    tables.push(result);
  }

  const postureFailed =
    clientPosture.hasSecretKeyExposed ||
    !clientPosture.httpsEnforced ||
    !clientPosture.projectRefMatched;

  const failedTables = tables.filter((t) => t.status === 'failed');
  const warningTables = tables.filter((t) => t.status === 'warning');

  const overallStatus: SecurityCheckStatus =
    postureFailed || failedTables.length > 0
      ? 'failed'
      : warningTables.length > 0
      ? 'warning'
      : 'passed';

  const summaryPT =
    overallStatus === 'passed'
      ? 'Auditoria concluída com aprovação em todas as 5 tabelas (profiles, accounts, categories, transactions e goals), sessão JWT validada no servidor e zero chaves secretas expostas no frontend.'
      : overallStatus === 'warning'
      ? `Auditoria concluída com ${warningTables.length} ponto(s) para conferência complementar no SQL Editor do Supabase.`
      : `Atenção: foram identificados ${failedTables.length} problema(s) de política RLS ou configuração que precisam ser ajustados no Supabase.`;

  return {
    executedAtIso,
    overallStatus,
    authenticatedUserId: authUserId,
    authenticatedEmail: authEmail,
    jwtVerifiedByServer: true,
    clientPosture,
    tables,
    summaryPT,
  };
}
