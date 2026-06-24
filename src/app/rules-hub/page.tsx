import type { Metadata } from 'next';
import SocRouteShell from '@/components/shell/SocRouteShell';
import WazuhRulesHub from '@/features/wazuh-rules-hub/WazuhRulesHub';
import { requireAnyUser } from '@/lib/auth/guards';
import { readCustomUseCasesFromStore } from '@/features/wazuh-rules-hub/lib/use-case-store';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Workspace',
  robots: { index: false, follow: false },
};

export default async function RulesHubPage() {
  const { session, role } = await requireAnyUser('/rules-hub');
  const initialCustomUseCases = await readCustomUseCasesFromStore();

  return (
    <SocRouteShell user={session.user} role={role}>
      <div className="rules-app-page app-theme-unify">
        <div className="app-page-stack">
          <WazuhRulesHub currentUser={{ id: session.user.id, name: session.user.name, email: session.user.email }} initialCustomUseCases={initialCustomUseCases} />
        </div>
      </div>
    </SocRouteShell>
  );
}
