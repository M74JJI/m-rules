import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";
import { ArrowRight, Database, Network, ShieldCheck } from "lucide-react";
import { signIn } from "@/auth";
import { sanitizeCallbackPath } from "@/lib/auth/callback";
import { isAuthConfigured } from "@/lib/auth/env";
import { auth } from "@/auth";
import ThemeSwitcher from "@/components/theme/ThemeSwitcher";
import { AlertPanel, AuthActionButton } from "@/components/ui/primitives";
import { getSessionAppRole } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Sign in | Mercure Rules Hub",
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
  if (session?.user && !role) redirect("/forbidden");

  async function login() {
    "use server";
    await signIn("keycloak", { redirectTo: callbackUrl });
  }

  return (
    <main className="auth-screen signin-screen">
      <section className="signin-shell" aria-labelledby="signin-title">
        <aside className="signin-product-panel">
          <div className="signin-brand">
            <span className="signin-brand-mark">
              <Image src="/mercure-logo-white.png" alt="" width={44} height={44} priority />
            </span>
            <span><strong>Mercure</strong><small>Rules Hub</small></span>
          </div>

          <div className="signin-product-copy">
            <span className="signin-kicker">Detection engineering workspace</span>
            <h1>Ruleset operations,<br />in one secure place.</h1>
            <p>Review Wazuh rules, decoder lineage, client coverage, and validation findings from one governed workspace.</p>
          </div>

          <div className="signin-capabilities" aria-label="Platform capabilities">
            <div><ShieldCheck /><span><strong>Governed access</strong><small>Role-aware Keycloak authentication</small></span></div>
            <div><Database /><span><strong>Managed sources</strong><small>Rules and decoders from manager archives</small></span></div>
            <div><Network /><span><strong>Client intelligence</strong><small>Tenant-scoped analysis and coverage</small></span></div>
          </div>

          <p className="signin-product-foot">Mercure SOC · Internal platform</p>
        </aside>

        <div className="signin-login-panel">
          <div className="signin-theme-control"><ThemeSwitcher /></div>
          <div className="signin-login-content">
            <span className="signin-kicker">Secure access</span>
            <h2 id="signin-title">Sign in to Rules Hub</h2>
            <p>Use your Mercure identity to continue. Access follows assigned workspace role.</p>

            {configured ? (
              <form action={login} className="signin-form">
                <AuthActionButton type="submit" className="signin-submit">
                  Continue with Mercure
                  <ArrowRight />
                </AuthActionButton>
              </form>
            ) : (
              <AlertPanel className="signin-config-alert">
                SSO is not configured yet. Set required AUTH_* and AUTH_KEYCLOAK_* environment variables before exposing this app.
              </AlertPanel>
            )}

            <div className="signin-trust-note">
              <ShieldCheck />
              <span><strong>Protected by Mercure SSO</strong><small>Authentication handled by Keycloak. Credentials never enter Rules Hub.</small></span>
            </div>
          </div>
          <p className="signin-legal">Authorized Mercure personnel only.</p>
        </div>
      </section>
    </main>
  );
}
