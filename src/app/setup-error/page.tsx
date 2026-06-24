import type { Metadata } from 'next';
import ThemeSwitcher from '@/components/theme/ThemeSwitcher';
import { AlertPanel, SectionHeader } from '@/components/ui/primitives';
import { getMissingAuthEnv } from '@/lib/auth/env';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'SSO setup required | Mercure Rules Hub',
  robots: { index: false, follow: false },
};

export default function SetupErrorPage() {
  const missing = getMissingAuthEnv();
  const revealNames = process.env.NODE_ENV !== 'production';

  return (
    <main className="auth-screen">
      <section className="auth-card auth-card-narrow" aria-labelledby="setup-title">
        <div className="mb-5 flex justify-end">
          <ThemeSwitcher />
        </div>
        <SectionHeader eyebrow="Deployment guard" title="SSO is not configured" titleAs="h1" titleId="setup-title" />
        <p className="auth-copy">
          Mercure Rules Hub stays unavailable until Keycloak OIDC settings and the Auth.js secret are configured.
        </p>
        <AlertPanel>
          {revealNames ? (
            <span>Missing: {missing.join(', ') || 'none'}</span>
          ) : (
            <span>Contact the deployment administrator and verify the AUTH_* environment variables.</span>
          )}
        </AlertPanel>
      </section>
    </main>
  );
}
