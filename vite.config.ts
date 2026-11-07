import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {defineConfig, loadEnv} from 'vite';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

const JWT_SUBSTRING_REGEX = /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

function inspectSupabaseEnvSecret(value?: string): {
  hasSecretKey: boolean;
  hasAnyEmbeddedJwt: boolean;
} {
  if (!value) return {hasSecretKey: false, hasAnyEmbeddedJwt: false};
  const trimmed = value.trim().replace(/^['"]|['"]$/g, '');

  if (trimmed.includes('sb_secret_')) {
    return {hasSecretKey: true, hasAnyEmbeddedJwt: false};
  }

  const jwtMatches = trimmed.match(JWT_SUBSTRING_REGEX) || [];
  let hasSecretRole = false;

  for (const token of jwtMatches) {
    try {
      const parts = token.split('.');
      const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8');
      const payload = JSON.parse(payloadJson) as {role?: string};
      if (payload.role === 'service_role' || payload.role === 'supabase_admin') {
        hasSecretRole = true;
      }
    } catch {
      // Ignore malformed base64 segments
    }
  }

  return {
    hasSecretKey: hasSecretRole,
    hasAnyEmbeddedJwt: jwtMatches.length > 0,
  };
}

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, process.cwd(), '');
  const mergedEnv: Record<string, string | undefined> = {...process.env, ...env};
  const rawUrl = mergedEnv.VITE_SUPABASE_URL || '';
  const rawAnonKey = mergedEnv.VITE_SUPABASE_ANON_KEY || '';

  const urlInspection = inspectSupabaseEnvSecret(rawUrl);
  const keyInspection = inspectSupabaseEnvSecret(rawAnonKey);

  const clientDefines: Record<string, string> = {};

  // Scan ALL VITE_* variables so no service_role or secret key can ever be bundled into import.meta.env
  for (const [envKey, envVal] of Object.entries(mergedEnv)) {
    if (!envKey.startsWith('VITE_') || envKey === 'VITE_SUPABASE_URL') continue;
    const upperKey = envKey.toUpperCase();
    const isSuspiciousSecretName =
      upperKey.includes('SERVICE_ROLE') ||
      upperKey.includes('SECRET') ||
      upperKey.includes('PRIVATE');
    const valInspection = inspectSupabaseEnvSecret(envVal);
    if (isSuspiciousSecretName || valInspection.hasSecretKey) {
      clientDefines[`import.meta.env.${envKey}`] = JSON.stringify('__BLOCKED_SECRET_KEY__');
    }
  }

  // Never allow secret/service_role keys (even if accidentally pasted inside a URL) to enter the frontend bundle
  if (keyInspection.hasSecretKey) {
    clientDefines['import.meta.env.VITE_SUPABASE_ANON_KEY'] =
      JSON.stringify('__BLOCKED_SECRET_KEY__');
  }
  if (urlInspection.hasSecretKey) {
    clientDefines['import.meta.env.VITE_SUPABASE_URL'] = JSON.stringify(
      '__BLOCKED_SECRET_KEY_IN_URL__'
    );
  } else if (urlInspection.hasAnyEmbeddedJwt) {
    clientDefines['import.meta.env.VITE_SUPABASE_URL'] = JSON.stringify(
      '__URL_CONTAINS_JWT_TOKEN__'
    );
  }

  return {
    plugins: [react(), tailwindcss()],
    define: clientDefines,
    optimizeDeps: {
      include: ['react', 'react-dom', 'react-dom/client', '@supabase/supabase-js'],
    },
    resolve: {
      alias: {
        '@': rootDir,
      },
    },
    server: {
      port: 3000,
      host: '0.0.0.0',
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
