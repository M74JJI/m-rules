import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import type { UseCaseRecord } from '@/features/wazuh-rules-hub/lib/types';
import { deleteCustomUseCaseFromStore, readCustomUseCasesFromStore, upsertCustomUseCaseInStore } from '@/features/wazuh-rules-hub/lib/use-case-store';

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

async function requireUser() {
  const session = await auth();
  return session?.user ? session : null;
}

function isValidUseCaseRecord(value: unknown): value is UseCaseRecord {
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
    candidate.source === 'custom' &&
    typeof candidate.createdBy === 'string'
  );
}

export async function GET() {
  const session = await requireUser();
  if (!session) return unauthorized();
  const useCases = await readCustomUseCasesFromStore();
  return NextResponse.json({ useCases });
}

export async function POST(request: Request) {
  const session = await requireUser();
  if (!session) return unauthorized();
  const payload = await request.json();
  if (!isValidUseCaseRecord(payload)) return NextResponse.json({ error: 'Invalid use case payload' }, { status: 400 });
  const useCases = await upsertCustomUseCaseInStore(payload);
  return NextResponse.json({ useCases });
}

export async function DELETE(request: Request) {
  const session = await requireUser();
  if (!session) return unauthorized();
  const payload = await request.json();
  if (!payload || typeof payload !== 'object' || typeof (payload as { id?: unknown }).id !== 'string') {
    return NextResponse.json({ error: 'Invalid delete payload' }, { status: 400 });
  }
  const useCases = await deleteCustomUseCaseFromStore((payload as { id: string }).id);
  return NextResponse.json({ useCases });
}
