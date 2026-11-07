-- =============================================================================
-- FinanCerto — Script de Auditoria e Verificação RLS no Supabase (Prioridade 7)
-- =============================================================================
-- PARTE 1 (SOMENTE LEITURA): Execute no SQL Editor do Supabase para auditar
-- o estado real das 5 tabelas e suas políticas RLS sem modificar nada.
-- =============================================================================

-- 1A. Verificar se Row Level Security (RLS) está habilitado nas 5 tabelas
SELECT
  c.relname AS tabela,
  c.relrowsecurity AS rls_habilitado,
  c.relforcerowsecurity AS force_rls
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('profiles', 'accounts', 'categories', 'transactions', 'goals')
ORDER BY c.relname;

-- 1B. Auditar todas as políticas RLS existentes (SELECT, INSERT, UPDATE, DELETE)
SELECT
  tablename AS tabela,
  policyname AS politica,
  permissive,
  roles AS papeis,
  cmd AS operacao,
  qual AS expressao_using,
  with_check AS expressao_with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('profiles', 'accounts', 'categories', 'transactions', 'goals')
ORDER BY tablename, cmd, policyname;


-- =============================================================================
-- PARTE 2 (OPCIONAL / CORRETIVA): Execute SOMENTE se a Parte 1 ou o teste no
-- Preview indicar ausência de RLS ou falta de política (ex.: INSERT/WITH CHECK
-- em profiles). Preserva 100% das tabelas e dados existentes.
-- =============================================================================
/*
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT TO authenticated USING (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
CREATE POLICY "profiles_insert_own" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_delete_own" ON public.profiles;
CREATE POLICY "profiles_delete_own" ON public.profiles
  FOR DELETE TO authenticated USING (auth.uid() = id);

-- Nota: Em transactions, também podemos validar no banco que account_id e category_id
-- (quando não nulos) pertençam ao próprio auth.uid():
DROP POLICY IF EXISTS "transactions_insert_own" ON public.transactions;
CREATE POLICY "transactions_insert_own" ON public.transactions
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND (account_id IS NULL OR EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = account_id AND a.user_id = auth.uid()))
    AND (category_id IS NULL OR EXISTS (SELECT 1 FROM public.categories c WHERE c.id = category_id AND c.user_id = auth.uid()))
  );

DROP POLICY IF EXISTS "transactions_update_own" ON public.transactions;
CREATE POLICY "transactions_update_own" ON public.transactions
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND (account_id IS NULL OR EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = account_id AND a.user_id = auth.uid()))
    AND (category_id IS NULL OR EXISTS (SELECT 1 FROM public.categories c WHERE c.id = category_id AND c.user_id = auth.uid()))
  );
*/
