import type { Session } from "next-auth";
import type { JsonRecord } from "./jwt";
import { getKeycloakClientId } from "./env";

export const APP_ROLES = ["admin", "user"] as const;
export type AppRole = (typeof APP_ROLES)[number];

const DEFAULT_ADMIN_ROLE = "SiemAdmins";
const DEFAULT_USER_ROLE = "SiemUsers";

function csv(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function getConfiguredAdminRoles() {
  return [
    ...new Set(
      [
        ...csv(process.env.AUTH_KEYCLOAK_ADMIN_ROLES),
        process.env.AUTH_KEYCLOAK_ADMIN_ROLE || DEFAULT_ADMIN_ROLE,
      ].filter(Boolean),
    ),
  ];
}

export function getConfiguredUserRoles() {
  return [
    ...new Set(
      [
        ...csv(process.env.AUTH_KEYCLOAK_USER_ROLES),
        process.env.AUTH_KEYCLOAK_USER_ROLE || DEFAULT_USER_ROLE,
      ].filter(Boolean),
    ),
  ];
}

export function allowUnmappedUsers() {
  return process.env.AUTH_ALLOW_UNMAPPED_USERS === "true";
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value))
    return value.filter(
      (item): item is string =>
        typeof item === "string" && item.trim().length > 0,
    );
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function collectFromResourceAccess(value: unknown, clientId: string) {
  if (!value || typeof value !== "object") return [];
  const access = value as Record<string, unknown>;
  const clientAccess = access[clientId];
  if (!clientAccess || typeof clientAccess !== "object") return [];
  return asStringArray((clientAccess as JsonRecord).roles);
}

function expandGroupName(group: string) {
  const trimmed = group.trim();
  const leaf = trimmed.split("/").filter(Boolean).at(-1);
  return leaf && leaf !== trimmed ? [trimmed, leaf] : [trimmed];
}

export function collectKeycloakAuthorities(...claimSources: JsonRecord[]) {
  const authorities = new Set<string>();
  const clientId = getKeycloakClientId();

  for (const claims of claimSources) {
    const realmAccess = claims.realm_access;
    if (realmAccess && typeof realmAccess === "object") {
      for (const role of asStringArray((realmAccess as JsonRecord).roles))
        authorities.add(role);
    }

    for (const role of collectFromResourceAccess(
      claims.resource_access,
      clientId,
    ))
      authorities.add(role);
    for (const role of asStringArray(claims.roles)) authorities.add(role);
    for (const role of asStringArray(claims.role)) authorities.add(role);
    for (const role of asStringArray(claims.app_roles)) authorities.add(role);
    for (const group of asStringArray(claims.groups)) {
      for (const expanded of expandGroupName(group)) authorities.add(expanded);
    }
  }

  return [...authorities].sort((a, b) => a.localeCompare(b));
}

export function resolveAppRole(authorities: readonly string[]): AppRole | null {
  const normalized = new Set(
    authorities.map((role) => role.trim()).filter(Boolean),
  );
  const adminRoles = getConfiguredAdminRoles();
  const userRoles = getConfiguredUserRoles();

  if (adminRoles.some((role) => normalized.has(role))) return "admin";
  if (userRoles.some((role) => normalized.has(role))) return "user";
  if (allowUnmappedUsers()) return "user";
  return null;
}

export function isAppRole(value: unknown): value is AppRole {
  return value === "admin" || value === "user";
}

export function getSessionAppRole(
  session: Session | null | undefined,
): AppRole | null {
  const value = session?.user?.appRole;
  return isAppRole(value) ? value : null;
}

export function canAccessRole(
  role: AppRole | null,
  allowed: readonly AppRole[],
) {
  return !!role && allowed.includes(role);
}
