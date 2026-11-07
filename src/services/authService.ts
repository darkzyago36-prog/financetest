import { Session, User } from '@supabase/supabase-js';
import {
  isSupabaseConfigured,
  supabase,
  supabaseAnonKey,
  supabaseConfigDiagnostics,
  supabaseUrl,
} from '../lib/supabaseClient';

export type AuthErrorCategory = 'config' | 'network' | 'http' | 'auth';

export interface ClassifiedAuthError {
  category: AuthErrorCategory;
  categoryLabelPT: string;
  httpStatus?: number;
  errorCode?: string;
  messagePT: string;
  diagnosticHintPT?: string;
}

export interface AuthActionResult {
  success: boolean;
  user?: User | null;
  session?: Session | null;
  requiresEmailConfirmation?: boolean;
  emailNotConfirmed?: boolean;
  errorCategory?: AuthErrorCategory;
  errorCategoryLabelPT?: string;
  httpStatus?: number;
  diagnosticHintPT?: string;
  messagePT: string;
}

export interface SupabaseConnectivityReport {
  reachable: boolean;
  category?: AuthErrorCategory;
  categoryLabelPT?: string;
  httpStatus?: number;
  messagePT: string;
  diagnosticHintPT?: string;
}

function extractErrorDetails(error: unknown): {
  name: string;
  code: string;
  status: number | undefined;
  rawMessage: string;
} {
  if (!error || typeof error !== 'object') {
    return {
      name: '',
      code: '',
      status: undefined,
      rawMessage: typeof error === 'string' ? error : '',
    };
  }

  const obj = error as {
    name?: unknown;
    code?: unknown;
    status?: unknown;
    statusCode?: unknown;
    message?: unknown;
    error_description?: unknown;
  };

  const statusVal =
    typeof obj.status === 'number'
      ? obj.status
      : typeof obj.statusCode === 'number'
      ? obj.statusCode
      : undefined;

  return {
    name: typeof obj.name === 'string' ? obj.name : '',
    code: typeof obj.code === 'string' ? obj.code.toLowerCase() : '',
    status: statusVal,
    rawMessage:
      typeof obj.message === 'string'
        ? obj.message
        : typeof obj.error_description === 'string'
        ? obj.error_description
        : '',
  };
}

/**
 * Classifica erros reais retornados por @supabase/supabase-js diferenciando:
 * 1. Configuração inválida ('config')
 * 2. Falha de rede / DNS / CORS / projeto pausado ('network')
 * 3. Erro HTTP do servidor / gatilho SQL / rate limit ('http')
 * 4. Erro de autenticação / regra de negócio ('auth')
 * Nunca inclui senhas ou chaves nas mensagens.
 */
export function classifyAuthError(error: unknown): ClassifiedAuthError {
  if (!isSupabaseConfigured) {
    return {
      category: 'config',
      categoryLabelPT: 'Configuração Inválida',
      errorCode: supabaseConfigDiagnostics.code || 'invalid_config',
      messagePT: supabaseConfigDiagnostics.message,
      diagnosticHintPT: supabaseConfigDiagnostics.checklist[0],
    };
  }

  const { name, code, status, rawMessage } = extractErrorDetails(error);
  const lower = `${name} ${code} ${rawMessage}`.toLowerCase();

  // 1. Falha de rede, DNS inexistente, CORS ou projeto Supabase pausado
  if (
    name === 'AuthRetryableFetchError' ||
    status === 0 ||
    lower.includes('failed to fetch') ||
    lower.includes('fetch failed') ||
    lower.includes('networkerror') ||
    lower.includes('network request failed') ||
    lower.includes('load failed') ||
    lower.includes('aborterror')
  ) {
    const isOffline =
      typeof navigator !== 'undefined' && navigator.onLine === false;

    if (isOffline) {
      return {
        category: 'network',
        categoryLabelPT: 'Sem Conexão com a Internet',
        errorCode: 'offline',
        messagePT:
          'Seu dispositivo parece estar desconectado da internet no momento.',
        diagnosticHintPT:
          'Restabeleça sua conexão de rede e tente novamente.',
      };
    }

    return {
      category: 'network',
      categoryLabelPT: 'Falha de Rede ou Servidor Inacessível',
      errorCode: 'unreachable_host',
      messagePT:
        'Não foi possível estabelecer conexão HTTPS com o endpoint do Supabase.',
      diagnosticHintPT:
        'Confira se VITE_SUPABASE_URL contém exatamente a Project URL (https://<id-do-projeto>.supabase.co) e se o projeto está ativo (não pausado) no painel do Supabase.',
    };
  }

  // 2. Erros de configuração de API Key, Endpoint 404 ou Provedor desativado
  if (
    lower.includes('invalid api key') ||
    lower.includes('no api key found') ||
    lower.includes('apikey') ||
    (status === 401 && !lower.includes('invalid login credentials') && !lower.includes('jwt'))
  ) {
    return {
      category: 'config',
      categoryLabelPT: 'Configuração Inválida',
      httpStatus: status || 401,
      errorCode: code || 'invalid_api_key',
      messagePT:
        'O servidor do Supabase rejeitou a chave pública configurada (VITE_SUPABASE_ANON_KEY).',
      diagnosticHintPT:
        'Confirme em Project Settings → API Keys se a chave pública anon / publishable pertence ao mesmo projeto de VITE_SUPABASE_URL.',
    };
  }

  if (status === 404) {
    return {
      category: 'config',
      categoryLabelPT: 'Endpoint Não Encontrado (HTTP 404)',
      httpStatus: 404,
      errorCode: code || 'endpoint_not_found',
      messagePT:
        'O endereço configurado em VITE_SUPABASE_URL respondeu com HTTP 404 para o serviço Supabase Auth.',
      diagnosticHintPT:
        'Verifique se VITE_SUPABASE_URL contém apenas a Project URL raiz (https://<id-do-projeto>.supabase.co), sem caminhos extras inválidos.',
    };
  }

  if (lower.includes('email_provider_disabled') || lower.includes('email logins are disabled')) {
    return {
      category: 'config',
      categoryLabelPT: 'Provedor Desativado no Supabase',
      httpStatus: status,
      errorCode: 'email_provider_disabled',
      messagePT:
        'A autenticação por E-mail/Senha está desativada nas configurações do projeto Supabase.',
      diagnosticHintPT:
        'Ative o provedor Email em Authentication → Providers → Email no painel do Supabase.',
    };
  }

  if (lower.includes('signup_disabled') || lower.includes('signups not allowed')) {
    return {
      category: 'config',
      categoryLabelPT: 'Cadastro Desativado no Projeto',
      httpStatus: status,
      errorCode: 'signup_disabled',
      messagePT:
        'A criação de novas contas está desativada nas configurações do Supabase Auth.',
      diagnosticHintPT:
        'Ative "Allow new users to sign up" em Authentication → Providers → Email no painel do Supabase.',
    };
  }

  // 3. Erros HTTP de Servidor / Banco de Dados (5xx) e Limite de Requisições (429)
  if (
    lower.includes('database error saving new user') ||
    lower.includes('database error') ||
    (status !== undefined && status >= 500)
  ) {
    const isTriggerFailure = lower.includes('database error saving new user');
    return {
      category: 'http',
      categoryLabelPT: `Erro HTTP ${status || 500} no Servidor`,
      httpStatus: status || 500,
      errorCode: code || 'server_error',
      messagePT: isTriggerFailure
        ? 'O servidor do Supabase retornou erro interno ao criar o perfil do usuário no banco de dados.'
        : 'O servidor do Supabase retornou um erro interno temporário ao processar a requisição.',
      diagnosticHintPT: isTriggerFailure
        ? 'Verifique a função/gatilho handle_new_user() e as colunas obrigatórias da tabela public.profiles no SQL Editor do Supabase.'
        : 'Aguarde alguns instantes (caso o projeto esteja saindo de pausa) e tente novamente.',
    };
  }

  if (
    status === 429 ||
    lower.includes('rate limit') ||
    lower.includes('too many requests') ||
    lower.includes('over_email_send_rate_limit') ||
    lower.includes('over_request_rate_limit')
  ) {
    const isEmailLimit = lower.includes('email');
    return {
      category: 'http',
      categoryLabelPT: 'Limite de Requisições (HTTP 429)',
      httpStatus: 429,
      errorCode: code || 'rate_limit',
      messagePT: isEmailLimit
        ? 'O limite de envio de e-mails de autenticação do Supabase foi atingido temporariamente.'
        : 'Muitas tentativas realizadas em curto intervalo.',
      diagnosticHintPT: isEmailLimit
        ? 'O plano padrão de SMTP do Supabase permite poucos envios por hora. Aguarde alguns minutos ou configure SMTP próprio / desative "Confirm email" em ambiente de testes.'
        : 'Aguarde alguns instantes antes de enviar uma nova solicitação.',
    };
  }

  // 4. Erros de Autenticação e Validação do Usuário
  if (lower.includes('invalid login credentials') || lower.includes('invalid_credentials')) {
    return {
      category: 'auth',
      categoryLabelPT: 'Erro de Autenticação',
      httpStatus: status || 400,
      errorCode: 'invalid_credentials',
      messagePT: 'E-mail ou senha incorretos. Confira seus dados e tente novamente.',
    };
  }

  if (lower.includes('email not confirmed') || lower.includes('email_not_confirmed')) {
    return {
      category: 'auth',
      categoryLabelPT: 'Confirmação de E-mail Pendente',
      httpStatus: status || 400,
      errorCode: 'email_not_confirmed',
      messagePT:
        'Seu e-mail ainda não foi confirmado. Abra o link enviado para sua caixa de entrada ou solicite o reenvio abaixo.',
    };
  }

  if (
    lower.includes('user already registered') ||
    lower.includes('already been registered') ||
    lower.includes('user_already_exists') ||
    lower.includes('email_exists')
  ) {
    return {
      category: 'auth',
      categoryLabelPT: 'Conta Já Existente',
      httpStatus: status || 422,
      errorCode: 'user_already_exists',
      messagePT: 'Este endereço de e-mail já está cadastrado. Faça login ou recupere sua senha.',
    };
  }

  if (lower.includes('otp_expired') || lower.includes('email link is invalid or has expired')) {
    return {
      category: 'auth',
      categoryLabelPT: 'Link Expirado',
      httpStatus: status || 403,
      errorCode: 'otp_expired',
      messagePT:
        'Este link de confirmação ou recuperação expirou ou já foi utilizado. Solicite um novo link.',
    };
  }

  if (
    lower.includes('flow_state_not_found') ||
    lower.includes('flow_state_expired') ||
    lower.includes('bad_code_verifier')
  ) {
    return {
      category: 'auth',
      categoryLabelPT: 'Sessão de Recuperação Expirada',
      httpStatus: status || 400,
      errorCode: code || 'flow_state_expired',
      messagePT:
        'A solicitação de recuperação expirou ou foi aberta em outro navegador. Solicite um novo link.',
    };
  }

  if (lower.includes('weak_password') || lower.includes('password should be at least')) {
    return {
      category: 'auth',
      categoryLabelPT: 'Senha Inválida',
      httpStatus: status || 422,
      errorCode: 'weak_password',
      messagePT:
        'A senha informada não atende aos requisitos mínimos de segurança do projeto (use pelo menos 6 caracteres combinando letras e números).',
    };
  }

  if (
    lower.includes('same password') ||
    lower.includes('same_password') ||
    lower.includes('different from the old password')
  ) {
    return {
      category: 'auth',
      categoryLabelPT: 'Senha Idêntica à Atual',
      httpStatus: status || 422,
      errorCode: 'same_password',
      messagePT: 'A nova senha deve ser diferente da senha atual.',
    };
  }

  if (
    lower.includes('reauthentication_needed') ||
    lower.includes('reauthentication required')
  ) {
    return {
      category: 'auth',
      categoryLabelPT: 'Reautenticação Necessária',
      httpStatus: status || 401,
      errorCode: 'reauthentication_needed',
      messagePT:
        'Por segurança, sua sessão precisa ser renovada antes de alterar a senha. Saia da conta e entre novamente.',
    };
  }

  if (
    lower.includes('invalid email') ||
    lower.includes('email_address_invalid') ||
    lower.includes('unable to validate email') ||
    lower.includes('validation_failed')
  ) {
    return {
      category: 'auth',
      categoryLabelPT: 'E-mail Inválido',
      httpStatus: status || 400,
      errorCode: 'email_address_invalid',
      messagePT: 'O endereço de e-mail informado foi recusado na validação. Utilize um e-mail válido.',
    };
  }

  if (lower.includes('user_banned')) {
    return {
      category: 'auth',
      categoryLabelPT: 'Acesso Suspenso',
      httpStatus: status || 403,
      errorCode: 'user_banned',
      messagePT: 'Esta conta encontra-se suspensa.',
    };
  }

  if (
    lower.includes('jwt expired') ||
    lower.includes('session_not_found') ||
    lower.includes('refresh_token_not_found') ||
    lower.includes('invalid refresh token')
  ) {
    return {
      category: 'auth',
      categoryLabelPT: 'Sessão Expirada',
      httpStatus: status || 401,
      errorCode: 'session_expired',
      messagePT: 'Sua sessão expirou por segurança. Faça login novamente para continuar.',
    };
  }

  if (status && status >= 400) {
    return {
      category: status >= 500 ? 'http' : 'auth',
      categoryLabelPT: `Erro HTTP ${status}`,
      httpStatus: status,
      errorCode: code || undefined,
      messagePT:
        'Não foi possível concluir a solicitação junto ao servidor de autenticação.',
      diagnosticHintPT: code ? `Código retornado pelo Supabase: ${code}` : undefined,
    };
  }

  return {
    category: 'auth',
    categoryLabelPT: 'Erro de Autenticação',
    errorCode: code || undefined,
    messagePT:
      'Não foi possível concluir a autenticação. Verifique os dados informados e tente novamente.',
  };
}

export function translateAuthErrorPT(error: unknown): string {
  return classifyAuthError(error).messagePT;
}

/**
 * Verifica de forma somente-leitura se o endpoint público de Auth do Supabase está acessível
 * e aceita a chave pública configurada, sem registrar credenciais ou simular sessão.
 */
export async function verifySupabaseEndpointReachable(): Promise<SupabaseConnectivityReport> {
  if (!isSupabaseConfigured || !supabaseUrl || !supabaseAnonKey) {
    return {
      reachable: false,
      category: 'config',
      categoryLabelPT: 'Configuração Pendente',
      messagePT: supabaseConfigDiagnostics.message,
      diagnosticHintPT: supabaseConfigDiagnostics.checklist[0],
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);

  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/settings`, {
      method: 'GET',
      headers: {
        apikey: supabaseAnonKey,
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.ok) {
      return {
        reachable: true,
        httpStatus: res.status,
        messagePT: 'Conexão com o servidor Supabase Auth verificada com sucesso.',
      };
    }

    if (res.status === 401 || res.status === 403) {
      return {
        reachable: false,
        category: 'config',
        categoryLabelPT: `Chave Rejeitada (HTTP ${res.status})`,
        httpStatus: res.status,
        messagePT:
          'O servidor do Supabase respondeu, mas rejeitou a chave pública VITE_SUPABASE_ANON_KEY.',
        diagnosticHintPT:
          'Confira se a chave pública anon / publishable pertence exatamente ao projeto configurado em VITE_SUPABASE_URL.',
      };
    }

    if (res.status === 404) {
      return {
        reachable: false,
        category: 'config',
        categoryLabelPT: 'Endpoint Auth Não Encontrado (HTTP 404)',
        httpStatus: 404,
        messagePT:
          'O domínio informado em VITE_SUPABASE_URL não possui o endpoint /auth/v1 do Supabase.',
        diagnosticHintPT:
          'Informe a Project URL oficial em Project Settings → Data API (https://<id-do-projeto>.supabase.co).',
      };
    }

    return {
      reachable: false,
      category: 'http',
      categoryLabelPT: `Erro HTTP ${res.status}`,
      httpStatus: res.status,
      messagePT: `O servidor do Supabase respondeu com status HTTP ${res.status}.`,
      diagnosticHintPT:
        'Caso o projeto estivesse pausado no Supabase, aguarde cerca de 1 minuto até a restauração completa e tente novamente.',
    };
  } catch (err) {
    clearTimeout(timeout);
    const classified = classifyAuthError(err);
    return {
      reachable: false,
      category: classified.category,
      categoryLabelPT: classified.categoryLabelPT,
      httpStatus: classified.httpStatus,
      messagePT: classified.messagePT,
      diagnosticHintPT: classified.diagnosticHintPT,
    };
  }
}

function toFailedAuthResult(error: unknown, extra?: Partial<AuthActionResult>): AuthActionResult {
  const classified = classifyAuthError(error);
  return {
    success: false,
    errorCategory: classified.category,
    errorCategoryLabelPT: classified.categoryLabelPT,
    httpStatus: classified.httpStatus,
    diagnosticHintPT: classified.diagnosticHintPT,
    messagePT: classified.messagePT,
    ...extra,
  };
}

function ensureConfiguredOrFail(): AuthActionResult | null {
  if (!isSupabaseConfigured || !supabase) {
    return {
      success: false,
      errorCategory: 'config',
      errorCategoryLabelPT: 'Configuração Pendente',
      diagnosticHintPT: supabaseConfigDiagnostics.checklist[0],
      messagePT: supabaseConfigDiagnostics.message,
    };
  }
  return null;
}

export async function signUpWithEmail(
  fullName: string,
  email: string,
  password: string
): Promise<AuthActionResult> {
  const configError = ensureConfiguredOrFail();
  if (configError) return configError;

  const trimmedName = fullName.trim();
  const trimmedEmail = email.trim().toLowerCase();

  if (!trimmedName) {
    return {
      success: false,
      errorCategory: 'auth',
      errorCategoryLabelPT: 'Dados Obrigatórios',
      messagePT: 'Informe seu nome completo para criar a conta.',
    };
  }
  if (!trimmedEmail) {
    return {
      success: false,
      errorCategory: 'auth',
      errorCategoryLabelPT: 'Dados Obrigatórios',
      messagePT: 'Informe um endereço de e-mail válido.',
    };
  }
  if (password.length < 6) {
    return {
      success: false,
      errorCategory: 'auth',
      errorCategoryLabelPT: 'Senha Inválida',
      messagePT: 'A senha deve ter no mínimo 6 caracteres.',
    };
  }

  try {
    const { data, error } = await supabase!.auth.signUp({
      email: trimmedEmail,
      password,
      options: {
        // Metadado full_name utilizado pelo gatilho handle_new_user() na tabela profiles
        data: {
          full_name: trimmedName,
        },
        emailRedirectTo: window.location.origin,
      },
    });

    if (error) {
      return toFailedAuthResult(error);
    }

    // Quando "Confirm email" está ativo e o e-mail já existe, identities vem vazio
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      return {
        success: false,
        errorCategory: 'auth',
        errorCategoryLabelPT: 'Conta Já Existente',
        messagePT:
          'Este e-mail já possui cadastro. Faça login ou utilize a recuperação de senha.',
      };
    }

    const requiresConfirmation = Boolean(data.user && !data.session);

    return {
      success: true,
      user: data.user,
      session: data.session,
      requiresEmailConfirmation: requiresConfirmation,
      messagePT: requiresConfirmation
        ? 'Cadastro realizado com sucesso! Enviamos um link de confirmação para o seu e-mail antes do primeiro acesso.'
        : 'Conta criada com sucesso! Bem-vindo(a) ao FinanCerto.',
    };
  } catch (err) {
    return toFailedAuthResult(err);
  }
}

export async function resendSignupConfirmation(email: string): Promise<AuthActionResult> {
  const configError = ensureConfiguredOrFail();
  if (configError) return configError;

  const trimmedEmail = email.trim().toLowerCase();
  if (!trimmedEmail) {
    return {
      success: false,
      errorCategory: 'auth',
      errorCategoryLabelPT: 'Dados Obrigatórios',
      messagePT: 'Informe seu endereço de e-mail para reenviar o link de confirmação.',
    };
  }

  try {
    const { error } = await supabase!.auth.resend({
      type: 'signup',
      email: trimmedEmail,
      options: {
        emailRedirectTo: window.location.origin,
      },
    });

    if (error) {
      return toFailedAuthResult(error);
    }

    return {
      success: true,
      messagePT: 'E-mail de confirmação reenviado! Verifique sua caixa de entrada e spam.',
    };
  } catch (err) {
    return toFailedAuthResult(err);
  }
}

export async function signInWithEmail(
  email: string,
  password: string
): Promise<AuthActionResult> {
  const configError = ensureConfiguredOrFail();
  if (configError) return configError;

  const trimmedEmail = email.trim().toLowerCase();
  if (!trimmedEmail || !password) {
    return {
      success: false,
      errorCategory: 'auth',
      errorCategoryLabelPT: 'Dados Obrigatórios',
      messagePT: 'Preencha seu e-mail e sua senha para entrar.',
    };
  }

  try {
    const { data, error } = await supabase!.auth.signInWithPassword({
      email: trimmedEmail,
      password,
    });

    if (error) {
      const lower = `${error.code || ''} ${error.message || ''}`.toLowerCase();
      return toFailedAuthResult(error, {
        emailNotConfirmed:
          lower.includes('email not confirmed') || lower.includes('email_not_confirmed'),
      });
    }

    return {
      success: true,
      user: data.user,
      session: data.session,
      messagePT: 'Login realizado com sucesso!',
    };
  } catch (err) {
    return toFailedAuthResult(err);
  }
}

export async function signOutUser(): Promise<AuthActionResult> {
  if (!isSupabaseConfigured || !supabase) {
    return { success: true, messagePT: 'Sessão encerrada.' };
  }

  try {
    const { error } = await supabase.auth.signOut();
    if (error) {
      await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
      return {
        success: true,
        messagePT: 'Sessão encerrada localmente com segurança.',
      };
    }
    return {
      success: true,
      messagePT: 'Você saiu da sua conta com segurança.',
    };
  } catch {
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
    return {
      success: true,
      messagePT: 'Sessão encerrada localmente com segurança.',
    };
  }
}

export async function requestPasswordReset(email: string): Promise<AuthActionResult> {
  const configError = ensureConfiguredOrFail();
  if (configError) return configError;

  const trimmedEmail = email.trim().toLowerCase();
  if (!trimmedEmail) {
    return {
      success: false,
      errorCategory: 'auth',
      errorCategoryLabelPT: 'Dados Obrigatórios',
      messagePT: 'Informe o e-mail cadastrado para receber o link de recuperação.',
    };
  }

  try {
    const { error } = await supabase!.auth.resetPasswordForEmail(trimmedEmail, {
      redirectTo: window.location.origin,
    });

    if (error) {
      return toFailedAuthResult(error);
    }

    return {
      success: true,
      messagePT:
        'Instruções de recuperação enviadas! Verifique sua caixa de entrada e a pasta de spam.',
    };
  } catch (err) {
    return toFailedAuthResult(err);
  }
}

export function validatePasswordChange(
  newPassword: string,
  confirmPassword: string
): { valid: true } | { valid: false; messagePT: string } {
  if (!newPassword) {
    return {
      valid: false,
      messagePT: 'Informe a nova senha.',
    };
  }
  if (newPassword.trim().length === 0) {
    return {
      valid: false,
      messagePT: 'A nova senha não pode conter apenas espaços em branco.',
    };
  }
  if (newPassword.length < 6) {
    return {
      valid: false,
      messagePT: 'A nova senha deve conter pelo menos 6 caracteres.',
    };
  }
  if (newPassword.length > 72) {
    return {
      valid: false,
      messagePT: 'A nova senha deve conter no máximo 72 caracteres.',
    };
  }
  if (!confirmPassword) {
    return {
      valid: false,
      messagePT: 'Confirme a nova senha digitando-a novamente.',
    };
  }
  if (newPassword !== confirmPassword) {
    return {
      valid: false,
      messagePT: 'A confirmação de senha não coincide com a nova senha.',
    };
  }
  return { valid: true };
}

export async function updateAuthenticatedPassword(
  newPassword: string,
  confirmPassword?: string
): Promise<AuthActionResult> {
  const configError = ensureConfiguredOrFail();
  if (configError) return configError;

  const check = validatePasswordChange(
    newPassword,
    confirmPassword !== undefined ? confirmPassword : newPassword
  );
  if (!check.valid) {
    return {
      success: false,
      errorCategory: 'auth',
      errorCategoryLabelPT: 'Senha Inválida',
      messagePT: check.messagePT,
    };
  }

  try {
    const { data: sessionCheck, error: sessionErr } = await supabase!.auth.getSession();
    if (sessionErr || !sessionCheck.session?.user) {
      return {
        success: false,
        errorCategory: 'auth',
        errorCategoryLabelPT: 'Sessão Expirada',
        messagePT: 'Sua sessão expirou por segurança. Faça login novamente antes de alterar a senha.',
      };
    }

    const { data, error } = await supabase!.auth.updateUser({
      password: newPassword,
    });

    if (error) {
      return toFailedAuthResult(error);
    }

    return {
      success: true,
      user: data.user,
      messagePT: 'Sua senha foi atualizada com sucesso!',
    };
  } catch (err) {
    return toFailedAuthResult(err);
  }
}
