// Maps an Authentik (OIDC) profile onto an existing `users` row. No row → no access:
// there is no public sign-up, so SSO never creates accounts.

export interface OidcProfile {
  email?: unknown;
  email_verified?: unknown;
}

export interface FolionixUser {
  id: string;
  email: string;
  name: string | null;
}

type FindByEmail = (email: string) => Promise<{ id: string | number; email: string; name: string | null } | undefined>;

export async function findOidcUser(profile: OidcProfile | undefined, findByEmail: FindByEmail): Promise<FolionixUser | null> {
  // An unverified address could be self-asserted at the IdP and match someone else's account.
  if (profile?.email_verified !== true) return null;
  const email = typeof profile.email === "string" ? profile.email.trim().toLowerCase() : "";
  if (!email || email.length > 254) return null;
  const row = await findByEmail(email);
  return row ? { id: String(row.id), email: row.email, name: row.name } : null;
}
