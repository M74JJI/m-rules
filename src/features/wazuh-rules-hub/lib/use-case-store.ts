import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { UseCaseRecord } from './types';

const DATA_DIR = path.join(process.cwd(), 'data');
const USE_CASES_FILE = path.join(DATA_DIR, 'use-cases.json');

function isUseCaseRecord(value: unknown): value is UseCaseRecord {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<UseCaseRecord>;
  return Boolean(
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.shortName === 'string' &&
    typeof candidate.component === 'string' &&
    typeof candidate.vendor === 'string' &&
    typeof candidate.product === 'string' &&
    typeof candidate.domain === 'string' &&
    typeof candidate.category === 'string' &&
    typeof candidate.description === 'string' &&
    typeof candidate.source === 'string' &&
    typeof candidate.createdBy === 'string'
  );
}

async function ensureStoreFile() {
  await mkdir(DATA_DIR, { recursive: true });
  try {
    await readFile(USE_CASES_FILE, 'utf8');
  } catch {
    await writeFile(USE_CASES_FILE, '[]\n', 'utf8');
  }
}

export async function readCustomUseCasesFromStore() {
  await ensureStoreFile();
  try {
    const raw = await readFile(USE_CASES_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [] as UseCaseRecord[];
    return parsed.filter(isUseCaseRecord).sort((a, b) => a.component.localeCompare(b.component) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  } catch {
    return [] as UseCaseRecord[];
  }
}

async function writeCustomUseCasesToStore(useCases: UseCaseRecord[]) {
  await ensureStoreFile();
  await writeFile(USE_CASES_FILE, `${JSON.stringify(useCases, null, 2)}\n`, 'utf8');
}

export async function upsertCustomUseCaseInStore(useCase: UseCaseRecord) {
  const existing = await readCustomUseCasesFromStore();
  const next = [...existing.filter((item) => item.id !== useCase.id), useCase]
    .sort((a, b) => a.component.localeCompare(b.component) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  await writeCustomUseCasesToStore(next);
  return next;
}

export async function deleteCustomUseCaseFromStore(useCaseId: string) {
  const existing = await readCustomUseCasesFromStore();
  const next = existing.filter((item) => item.id !== useCaseId);
  await writeCustomUseCasesToStore(next);
  return next;
}
