import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { readManagerArchiveSnapshot } from '@/features/wazuh-rules-hub/lib/manager-archive-source';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export async function GET() {
  const session = await auth();
  if (!session?.user) return unauthorized();

  try {
    const snapshot = await readManagerArchiveSnapshot();
    return NextResponse.json(snapshot);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to read manager archives' },
      { status: 500 }
    );
  }
}
