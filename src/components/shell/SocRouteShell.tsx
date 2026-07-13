import Image from 'next/image';
import Link from 'next/link';
import type { PropsWithChildren } from 'react';
import { signOut } from '@/auth';
import ThemeSwitcher from '@/components/theme/ThemeSwitcher';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import type { AppRole } from '@/lib/auth/roles';

type ShellUser = {
  name?: string | null;
  email?: string | null;
};

type Props = PropsWithChildren<{
  user?: ShellUser;
  role?: AppRole;
}>;

function displayName(user?: ShellUser) {
  return user?.name || user?.email || 'Authenticated user';
}

function initials(user?: ShellUser) {
  const source = displayName(user);
  return source
    .split(/\s|@/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'U';
}

export default function SocRouteShell({ children, user, role }: Props) {
  async function logout() {
    'use server';
    await signOut({ redirectTo: '/sign-in' });
  }

  return (
    <main className="rules-shell app-shell-page">
      <header className="rules-app-header">
        <div className="rules-app-header-inner">
          <div className="rules-header-start">
            <Link className="rules-brand" href="/rules-hub" aria-label="Mercure Rules Hub home">
              <span className="rules-brand-logo">
                <Image className="rules-brand-logo-image" src="/mercure-logo-white.png" alt="" width={34} height={34} priority />
              </span>
              <span className="rules-brand-copy">
                <strong>Mercure</strong>
                <small>Rules hub</small>
              </span>
            </Link>

            <nav className="rules-header-nav" aria-label="Primary navigation">
              <Link href="/rules-hub">Workspace</Link>
              {role === 'admin' && <Link href="/admin">Admin</Link>}
            </nav>
          </div>

          <div className="rules-header-account">
            <ThemeSwitcher />
            {role && (
              <Badge tone={role === 'admin' ? 'warning' : 'info'} className="capitalize">
                {role}
              </Badge>
            )}
            <div className="rules-user-pill" title={user?.email ?? undefined}>
              <Avatar className="rules-avatar bg-primary text-primary-foreground after:hidden">
                <AvatarFallback className="bg-transparent text-[0.72rem] font-semibold text-primary-foreground">
                  {initials(user)}
                </AvatarFallback>
              </Avatar>
              <span className="rules-user-meta">
                <strong>{displayName(user)}</strong>
                <small>{user?.email && user.email !== user.name ? user.email : 'Keycloak session'}</small>
              </span>
            </div>
            <form action={logout}>
              <Button className="rounded-xl" variant="outline" type="submit">Sign out</Button>
            </form>
          </div>
        </div>
      </header>

      <section className="rules-app-content">
        <div className="rules-app-content-inner">{children}</div>
      </section>
    </main>
  );
}
