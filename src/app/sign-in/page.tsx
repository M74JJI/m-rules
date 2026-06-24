import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { signIn } from '@/auth';
import { sanitizeCallbackPath } from '@/lib/auth/callback';
import { isAuthConfigured } from '@/lib/auth/env';
import { auth } from '@/auth';
import ThemeSwitcher from '@/components/theme/ThemeSwitcher';
import { AlertPanel, AuthActionButton, SectionHeader, SubtleCard } from '@/components/ui/primitives';
import { getSessionAppRole } from '@/lib/auth/roles';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Sign in | Mercure Rules Hub',
  robots: { index: false, follow: false },
};

type Props = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SignInPage({ searchParams }: Props) {
  const params = await searchParams;
  const callbackUrl = sanitizeCallbackPath(params?.callbackUrl);
  const configured = isAuthConfigured();
  const session = configured ? await auth() : null;
  const role = getSessionAppRole(session);

  if (session?.user && role) redirect(callbackUrl);
  if (session?.user && !role) redirect('/forbidden');

  async function login() {
    'use server';
    await signIn('keycloak', { redirectTo: callbackUrl });
  }

  return (
    <main className="auth-screen">
      <section className="auth-card" aria-labelledby="signin-title">
        <div className="mb-5 flex justify-end">
          <ThemeSwitcher />
        </div>
        <div className="auth-brand-row">
          <div className="auth-mark" aria-hidden="true">MR</div>
          <div className="min-w-0 flex-1">
            <SectionHeader eyebrow="Secure access" title="Mercure Rules Hub" titleAs="h1" titleId="signin-title" />
          </div>
        </div>

        <p className="auth-copy">
          Sign in with your organization account to access Wazuh rules and decoders.
        </p>

        <div className="auth-status-grid" aria-label="Security posture">
          <SubtleCard>
            <span>Provider</span>
            <strong>Keycloak OIDC</strong>
          </SubtleCard>
          <SubtleCard>
            <span>Session</span>
            <strong>Encrypted JWT cookie</strong>
          </SubtleCard>
          <SubtleCard>
            <span>Access</span>
            <strong>Admin / User roles</strong>
          </SubtleCard>
        </div>

        {configured ? (
          <form action={login}>
            <AuthActionButton type="submit">
              Continue with Keycloak
            </AuthActionButton>
          </form>
        ) : (
          <AlertPanel>
            SSO is not configured yet. Set the required AUTH_* and AUTH_KEYCLOAK_* environment variables before exposing this app.
          </AlertPanel>
        )}

        <p className="auth-footnote">
          Access is denied unless the authenticated Keycloak token contains one of the mapped application roles.
        </p>
      </section>
    </main>
  );
}
