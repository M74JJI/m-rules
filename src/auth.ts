import NextAuth from 'next-auth';
import Keycloak from 'next-auth/providers/keycloak';
import type { Account, Profile } from 'next-auth';
import { decodeJwtPayload, type JsonRecord } from '@/lib/auth/jwt';
import {
  collectKeycloakAuthorities,
  resolveAppRole,
  type AppRole,
} from '@/lib/auth/roles';
import {
  getAuthSecret,
  getKeycloakClientId,
  getKeycloakClientSecret,
  getKeycloakIssuer,
  isTrustHostEnabled,
} from '@/lib/auth/env';

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' ? (value as JsonRecord) : {};
}

function buildAuthz(account?: Account | null, profile?: Profile) {
  const profileClaims = asRecord(profile);
  const accessTokenClaims = decodeJwtPayload(account?.access_token);
  const idTokenClaims = decodeJwtPayload(account?.id_token);
  const authorities = collectKeycloakAuthorities(profileClaims, accessTokenClaims, idTokenClaims);
  const appRole = resolveAppRole(authorities);

  return { authorities, appRole };
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  debug: false,
  trustHost: isTrustHostEnabled(),
  secret: getAuthSecret(),
  providers: [
    Keycloak({
      issuer: getKeycloakIssuer(),
      clientId: getKeycloakClientId(),
      clientSecret: getKeycloakClientSecret(),
      authorization: {
        params: {
          scope: 'openid email profile',
        },
      },
    }),
  ],
  session: {
    strategy: 'jwt',
    maxAge: 8 * 60 * 60,
    updateAge: 15 * 60,
  },
  pages: {
    signIn: '/sign-in',
    error: '/sign-in',
  },
  callbacks: {
    jwt({ token, account, profile }) {
      if (account || profile || !token.appRole) {
        const authz = buildAuthz(account, profile);
        token.keycloakAuthorities = authz.authorities;
        token.appRole = authz.appRole;
      }

      return token;
    },
    session({ session, token }) {
      if (typeof token.sub === 'string') session.user.id = token.sub;
      session.user.appRole = token.appRole as AppRole | null;
      session.user.keycloakAuthorities = Array.isArray(token.keycloakAuthorities)
        ? token.keycloakAuthorities.filter((item): item is string => typeof item === 'string')
        : [];

      return session;
    },
    redirect({ url, baseUrl }) {
      if (url.startsWith('/') && !url.startsWith('//')) return `${baseUrl}${url}`;

      try {
        const parsed = new URL(url);
        if (parsed.origin === baseUrl) return url;
      } catch {
        // Fall through to a safe default.
      }

      return `${baseUrl}/rules-hub`;
    },
  },
});
