import type { Metadata } from 'next';
import SocRouteShell from '@/components/shell/SocRouteShell';
import { AuthActionLink, SectionHeader, SubtleCard, SurfaceCard } from '@/components/ui/primitives';
import { requireAdmin } from '@/lib/auth/guards';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Admin | Mercure Rules Hub',
  robots: { index: false, follow: false },
};

export default async function AdminPage() {
  const { session, role } = await requireAdmin('/admin');

  return (
    <SocRouteShell user={session.user} role={role}>
      <div className="rules-app-page app-theme-unify">
        <div className="app-page-stack space-y-5">
          <section className="admin-hero">
            <SectionHeader eyebrow="Administration" title="Mercure Rules Hub Admin" titleAs="h1" />
            <p>
              This page is server-protected and only available to users mapped to the admin role.
            </p>
          </section>

          <section className="admin-grid">
            <SubtleCard className="admin-card">
              <span>Current role</span>
              <strong>{role}</strong>
            </SubtleCard>
            <SubtleCard className="admin-card">
              <span>User</span>
              <strong>{session.user.email || session.user.name || session.user.id}</strong>
            </SubtleCard>
            <SubtleCard className="admin-card">
              <span>Boundary</span>
              <strong>Server + Proxy</strong>
            </SubtleCard>
          </section>

          <SurfaceCard className="admin-card wide p-4 md:p-5">
            <h2>Received Keycloak authorities</h2>
            <div className="authority-list">
              {(session.user.keycloakAuthorities ?? []).map((item) => <span key={item}>{item}</span>)}
            </div>
          </SurfaceCard>

          <AuthActionLink className="w-fit" href="/rules-hub">Back to Hub</AuthActionLink>
        </div>
      </div>
    </SocRouteShell>
  );
}
