import type { Metadata } from 'next';
import { auth, signOut } from '@/auth';
import ThemeSwitcher from '@/components/theme/ThemeSwitcher';
import { AlertPanel, AuthActionButton, AuthActionLink, SectionHeader } from '@/components/ui/primitives';
import { isAuthConfigured } from '@/lib/auth/env';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Access denied | Mercure Rules Hub',
  robots: { index: false, follow: false },
};

export default async function ForbiddenPage() {
  const session = isAuthConfigured() ? await auth() : null;

  async function logout() {
    'use server';
    await signOut({ redirectTo: '/sign-in' });
  }

  return (
    <main className="auth-screen">
      <section className="auth-card auth-card-narrow" aria-labelledby="forbidden-title">
        <div className="mb-5 flex justify-end">
          <ThemeSwitcher />
        </div>
        <SectionHeader eyebrow="Authorization failed" title="Access denied" titleAs="h1" titleId="forbidden-title" />
        <p className="auth-copy">
          Your sign-in succeeded, but no Mercure Rules Hub role was mapped to your account.
        </p>

        <AlertPanel>
          Required role: <strong>rules-hub-user</strong> or <strong>rules-hub-admin</strong>, unless the deployment overrides the role names in environment variables.
        </AlertPanel>

        {session?.user?.email && (
          <p className="auth-muted">Signed in as {session.user.email}</p>
        )}

        <div className="auth-actions-row">
          <AuthActionLink href="/rules-hub">Retry access</AuthActionLink>
          <form action={logout}>
            <AuthActionButton className="w-auto px-4" type="submit">Sign out</AuthActionButton>
          </form>
        </div>
      </section>
    </main>
  );
}
