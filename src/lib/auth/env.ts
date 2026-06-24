const REQUIRED_AUTH_ENV = [
  'AUTH_SECRET',
  'AUTH_KEYCLOAK_ISSUER',
  'AUTH_KEYCLOAK_ID',
  'AUTH_KEYCLOAK_SECRET',
] as const;

export type RequiredAuthEnvName = (typeof REQUIRED_AUTH_ENV)[number];

function read(name: string) {
  const value = process.env[name];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

export function getMissingAuthEnv(): RequiredAuthEnvName[] {
  return REQUIRED_AUTH_ENV.filter((name) => !read(name));
}

export function isAuthConfigured() {
  return getMissingAuthEnv().length === 0;
}

export function assertAuthConfigured() {
  const missing = getMissingAuthEnv();
  if (missing.length > 0) {
    throw new Error(`Missing required SSO environment variables: ${missing.join(', ')}`);
  }
}

export function getKeycloakIssuer() {
  return read('AUTH_KEYCLOAK_ISSUER') ?? 'https://invalid.local/realms/missing';
}

export function getKeycloakClientId() {
  return read('AUTH_KEYCLOAK_ID') ?? 'missing-client-id';
}

export function getKeycloakClientSecret() {
  return read('AUTH_KEYCLOAK_SECRET') ?? 'missing-client-secret';
}

export function getAuthSecret() {
  return read('AUTH_SECRET');
}

export function isTrustHostEnabled() {
  return process.env.AUTH_TRUST_HOST === 'true' || process.env.VERCEL === '1' || process.env.CF_PAGES === '1';
}
