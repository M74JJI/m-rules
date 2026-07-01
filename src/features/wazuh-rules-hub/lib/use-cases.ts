import type { UseCaseRecord } from './types';

export const USE_CASE_COMPONENTS = [
  'Azure',
  'Office',
  'Intune',
  'Windows',
  'Linux',
  'Sophos EDR',
  'Sophos FW',
  'Fortigate',
  'Cloudflare',
] as const;

export const USE_CASES: UseCaseRecord[] = [];

export const GROUP_TO_USE_CASE: Record<string, string> = {};

export const slugifyUseCaseToken = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');

export const mergeUseCases = (customUseCases: UseCaseRecord[]) => {
  const merged = new Map<string, UseCaseRecord>();
  [...USE_CASES, ...customUseCases].forEach((useCase) => {
    if (!useCase.id) return;
    merged.set(useCase.id, useCase);
  });
  return [...merged.values()].sort((a, b) =>
    a.component.localeCompare(b.component) ||
    a.name.localeCompare(b.name) ||
    a.id.localeCompare(b.id)
  );
};

export const getUseCaseById = (catalog: UseCaseRecord[], id: string) => catalog.find((useCase) => useCase.id === id);

export const getUseCaseLabel = (catalog: UseCaseRecord[], id: string) => getUseCaseById(catalog, id)?.name || id;

export const buildUseCaseId = (_component: string, name: string, existingIds: Iterable<string>) => {
  const nameSlug = slugifyUseCaseToken(name) || 'detection';
  const used = new Set(existingIds);
  const base = `uc_${nameSlug}`;
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
};
