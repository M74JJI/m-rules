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
            <span className="signin-kicker">Rules Hub</span>
            <h1>Detection operations in one workspace.</h1>
            <p>Review detections, source lineage, coverage, and quality across every client.</p>
          </div>

          <div className="signin-capabilities" aria-label="Platform capabilities">
            <div><ShieldCheck /><span><strong>Rules and decoders</strong><small>Review detections and source lineage</small></span></div>
            <div><Database /><span><strong>Coverage and quality</strong><small>Find gaps, dependencies, and validation issues</small></span></div>
            <div><Network /><span><strong>Client workspaces</strong><small>Move between client views without losing context</small></span></div>
          </div>

          <p className="signin-product-foot">Mercure SOC · Internal platform</p>
        </aside>

        <div className="signin-login-panel">
          <div className="signin-theme-control"><ThemeSwitcher /></div>
          <div className="signin-login-content">
            <span className="signin-kicker">Welcome back</span>
            <h2 id="signin-title">Sign in to Mercure</h2>
            <p>Continue to Rules Hub with your Mercure account.</p>

            {configured ? (
              <form action={login} className="signin-form">
                <AuthActionButton type="submit" className="signin-submit">
                  Sign in
                  <ArrowRight />
                </AuthActionButton>
              </form>
            ) : (
              <AlertPanel className="signin-config-alert">
                Sign-in is unavailable. Contact your platform administrator.
              </AlertPanel>
            )}

          </div>
          <p className="signin-legal">Authorized Mercure personnel only.</p>
        </div>
      </section>
    </main>
  );
}
