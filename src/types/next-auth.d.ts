import type { DefaultSession } from 'next-auth';
import type { AppRole } from '@/lib/auth/roles';

declare module 'next-auth' {
  interface Session {
    user: {
      id?: string;
      appRole?: AppRole | null;
      keycloakAuthorities?: string[];
    } & DefaultSession['user'];
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    appRole?: AppRole | null;
    keycloakAuthorities?: string[];
  }
}
