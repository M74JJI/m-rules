export type JsonRecord = Record<string, unknown>;

export function decodeJwtPayload(token: unknown): JsonRecord {
  if (typeof token !== 'string') return {};
  const parts = token.split('.');
  if (parts.length < 2 || !parts[1]) return {};

  try {
    const base64 = parts[1]
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(parts[1].length / 4) * 4, '=');
    const binary = globalThis.atob(base64);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as JsonRecord;
  } catch {
    return {};
  }
}
