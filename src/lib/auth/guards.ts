import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { isAuthConfigured } from '@/lib/auth/env';
import { canAccessRole, getSessionAppRole, type AppRole } from '@/lib/auth/roles';

export async function requireRole(allowed: readonly AppRole[], callbackPath = '/rules-hub') {
  if (!isAuthConfigured()) {
    redirect('/setup-error');
  }

  const session = await auth();
  if (!session?.user) {
    redirect(`/sign-in?callbackUrl=${encodeURIComponent(callbackPath)}`);
  }

  const role = getSessionAppRole(session);
  if (!canAccessRole(role, allowed)) {
    redirect('/forbidden');
  }

  return { session, role: role as AppRole };
}

export async function requireAnyUser(callbackPath = '/rules-hub') {
  return requireRole(['admin', 'user'], callbackPath);
}

export async function requireAdmin(callbackPath = '/admin') {
  return requireRole(['admin'], callbackPath);
}
