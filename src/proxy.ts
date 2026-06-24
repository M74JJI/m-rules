import { auth } from '@/auth';
import { isAuthConfigured } from '@/lib/auth/env';
import { canAccessRole, getSessionAppRole } from '@/lib/auth/roles';
import { applySecurityHeaders } from '@/lib/security-headers';
import { NextResponse } from 'next/server';

const USER_ROUTES = ['/rules-hub'];
const ADMIN_ROUTES = ['/admin'];

function startsWithAny(pathname: string, prefixes: readonly string[]) {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function redirectTo(requestUrl: URL, pathname: string) {
  return NextResponse.redirect(new URL(pathname, requestUrl));
}

export default auth((request) => {
  const { nextUrl } = request;
  const pathname = nextUrl.pathname;
  const needsUser = startsWithAny(pathname, USER_ROUTES);
  const needsAdmin = startsWithAny(pathname, ADMIN_ROUTES);
  const protectedRoute = needsUser || needsAdmin;

  if (!protectedRoute) {
    return applySecurityHeaders(NextResponse.next());
  }

  if (!isAuthConfigured()) {
    return applySecurityHeaders(redirectTo(nextUrl, '/setup-error'));
  }

  if (!request.auth?.user) {
    const loginUrl = new URL('/sign-in', nextUrl);
    loginUrl.searchParams.set('callbackUrl', `${nextUrl.pathname}${nextUrl.search}`);
    return applySecurityHeaders(NextResponse.redirect(loginUrl));
  }

  const role = getSessionAppRole(request.auth);
  const allowed = needsAdmin ? (['admin'] as const) : (['admin', 'user'] as const);

  if (!canAccessRole(role, allowed)) {
    return applySecurityHeaders(redirectTo(nextUrl, '/forbidden'));
  }

  return applySecurityHeaders(NextResponse.next());
});

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|txt|xml)$).*)',
  ],
};
