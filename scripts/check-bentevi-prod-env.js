#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');

const REQUIRED = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'NEXT_PUBLIC_APP_URL',
  'VORTEK_RUNTIME_ENVIRONMENT',
  'API_SECRET_KEY',
  'JWT_SECRET',
  'BRASILNFE_TIPO_AMBIENTE',
  'BRASILNFE_RETURN_TIPO_AMBIENTE',
  'BENTEVI_ASSISTANT_ENABLED',
  'BENTEVI_ASSISTANT_DATA_APPROVED',
  'ML_PRICING_EXECUTION_MODE',
  'ML_PRICING_EXECUTION_ALLOWED_OPERATIONS',
  'EVOLUSOM_OFFICIAL_LABEL_ADDITIONAL_PHONE',
];

const SECRET_NAMES = new Set([
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'API_SECRET_KEY',
  'JWT_SECRET',
  'EVOLUSOM_OFFICIAL_LABEL_ADDITIONAL_PHONE',
]);

const PLACEHOLDER = /(?:troque|exemplo|example|placeholder|sua[-_ ]|seu[-_ ]|changeme|<.+>)/i;
const TRUTHY = new Set(['1', 'true', 'yes', 'on']);

function parseUrl(value, name, errors) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      errors.push(`${name} deve ser uma URL HTTP(S) sem credenciais embutidas.`);
      return null;
    }
    return url;
  } catch {
    errors.push(`${name} deve conter uma URL válida.`);
    return null;
  }
}

function validateWhatsappPhone(value, name, errors) {
  const phone = String(value || '').trim();
  if (!phone) return;
  if (/[^\d+().\s-]/.test(phone)) {
    errors.push(`${name} deve conter somente dígitos e separadores de telefone.`);
    return;
  }

  const digits = phone.replace(/\D/g, '');
  const normalized = digits.startsWith('55') ? digits : `55${digits}`;
  if (normalized.length < 12 || normalized.length > 13) {
    errors.push(`${name} deve usar DDD + número ou 55 + DDD + número.`);
  }
}

function validateProductionEnvironment(env) {
  const errors = [];
  const warnings = [];

  for (const name of REQUIRED) {
    const value = String(env[name] || '').trim();
    if (!value) errors.push(`${name} não configurada.`);
    else if (SECRET_NAMES.has(name) && PLACEHOLDER.test(value)) {
      errors.push(`${name} ainda contém valor de exemplo.`);
    }
  }

  const appUrl = parseUrl(String(env.NEXT_PUBLIC_APP_URL || ''), 'NEXT_PUBLIC_APP_URL', errors);
  if (appUrl && (appUrl.origin !== 'https://app.bentevi.shop' || appUrl.pathname !== '/'
    || appUrl.search || appUrl.hash)) {
    errors.push('NEXT_PUBLIC_APP_URL deve ser exatamente https://app.bentevi.shop.');
  }

  const publicSupabaseUrl = parseUrl(
    String(env.NEXT_PUBLIC_SUPABASE_URL || ''),
    'NEXT_PUBLIC_SUPABASE_URL',
    errors,
  );
  if (publicSupabaseUrl && (publicSupabaseUrl.origin !== 'https://supabase.bentevi.shop'
    || publicSupabaseUrl.pathname !== '/' || publicSupabaseUrl.search || publicSupabaseUrl.hash)) {
    errors.push('NEXT_PUBLIC_SUPABASE_URL deve ser exatamente https://supabase.bentevi.shop.');
  }

  const serviceSupabaseUrl = parseUrl(
    String(env.SUPABASE_SERVICE_URL || ''),
    'SUPABASE_SERVICE_URL',
    errors,
  );
  if (serviceSupabaseUrl && serviceSupabaseUrl.hostname !== '192.168.1.162') {
    errors.push('SUPABASE_SERVICE_URL deve apontar diretamente para 192.168.1.162.');
  }

  if (env.VORTEK_RUNTIME_ENVIRONMENT !== 'production') {
    errors.push('VORTEK_RUNTIME_ENVIRONMENT deve ser production.');
  }
  if (env.BENTEVI_ASSISTANT_ENABLED !== '0' || env.BENTEVI_ASSISTANT_DATA_APPROVED !== '0') {
    errors.push('O lançamento inicial exige o Assistente bloqueado (ambas as flags em 0).');
  }
  const pricingOperations = String(env.ML_PRICING_EXECUTION_ALLOWED_OPERATIONS || '').split(',')
    .map((value) => value.trim()).filter(Boolean);
  if (!['disabled', 'production_controlled'].includes(env.ML_PRICING_EXECUTION_MODE))
    errors.push('ML_PRICING_EXECUTION_MODE deve ser disabled ou production_controlled.');
  if (pricingOperations.length !== 1 || pricingOperations[0] !== 'price_change')
    errors.push('ML_PRICING_EXECUTION_ALLOWED_OPERATIONS deve conter somente price_change.');
  if (env.ML_PRICING_EXECUTION_MODE === 'production_controlled' && !String(env.ML_ALLOWED_USER_IDS || '').trim())
    errors.push('Execução controlada exige ML_ALLOWED_USER_IDS.');
  if (String(env.BRASILNFE_TIPO_AMBIENTE || '') !== '1'
    || String(env.BRASILNFE_RETURN_TIPO_AMBIENTE || '') !== '1') {
    errors.push('Brasil NFe deve usar ambiente 1 para emissão e devolução produtivas.');
  }
  validateWhatsappPhone(
    env.EVOLUSOM_OFFICIAL_LABEL_ADDITIONAL_PHONE,
    'EVOLUSOM_OFFICIAL_LABEL_ADDITIONAL_PHONE',
    errors,
  );
  if (env.NODE_ENV && env.NODE_ENV !== 'production') {
    errors.push('NODE_ENV, quando informado, deve ser production.');
  }

  for (const name of ['ALLOW_ML_FISCAL_LEGACY', 'AUDIT_SYNC_ALLOW_LEGACY']) {
    if (TRUTHY.has(String(env[name] || '').trim().toLowerCase())) {
      errors.push(`${name} não pode estar habilitada no lançamento Bentevi.`);
    }
  }

  if (!String(env.ML_ALLOWED_USER_IDS || '').trim()) {
    warnings.push('ML_ALLOWED_USER_IDS não configurada; conexão/ações vinculadas ao seller devem permanecer indisponíveis.');
  }
  if (!String(env.INTERNAL_APP_URL || '').trim()) {
    warnings.push('INTERNAL_APP_URL não configurada; jobs usarão a URL pública do aplicativo.');
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    summary: {
      appHost: appUrl?.hostname || null,
      publicSupabaseHost: publicSupabaseUrl?.hostname || null,
      serviceSupabaseHost: serviceSupabaseUrl?.hostname || null,
      runtime: env.VORTEK_RUNTIME_ENVIRONMENT || null,
      assistant: env.BENTEVI_ASSISTANT_ENABLED === '0' ? 'disabled' : 'invalid',
      mlPricingAndPublication: env.ML_PRICING_EXECUTION_MODE || null,
      mlPricingAllowedOperations: pricingOperations,
      fiscalEnvironment: env.BRASILNFE_TIPO_AMBIENTE || null,
      configuredRequiredVariables: REQUIRED.filter((name) => String(env[name] || '').trim()).length,
      requiredVariables: REQUIRED.length,
    },
  };
}

function readArg(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

function main() {
  const envFile = path.resolve(readArg('env-file') || '.env.bentevi-prod.local');
  if (!fs.existsSync(envFile)) {
    console.error(`Arquivo produtivo ausente: ${path.basename(envFile)}.`);
    console.error('Informe --env-file=<caminho-privado>; nenhum valor será exibido.');
    process.exitCode = 2;
    return;
  }

  const env = dotenv.parse(fs.readFileSync(envFile));
  const result = validateProductionEnvironment(env);
  console.log(JSON.stringify(result.summary, null, 2));
  for (const warning of result.warnings) console.warn(`[aviso] ${warning}`);
  for (const error of result.errors) console.error(`[bloqueio] ${error}`);
  if (!result.ok) {
    process.exitCode = 1;
    return;
  }
  console.log('Preflight de runtime produtivo aprovado; nenhum secret foi exibido.');
}

if (require.main === module) main();

module.exports = {
  REQUIRED,
  validateProductionEnvironment,
};
