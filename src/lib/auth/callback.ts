export function sanitizeCallbackPath(value: unknown, fallback = '/rules-hub') {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return fallback;
  if (!raw.startsWith('/') || raw.startsWith('//')) return fallback;
  if (raw.startsWith('/api/auth')) return fallback;
  if (raw.startsWith('/_next')) return fallback;
  return raw;
}
