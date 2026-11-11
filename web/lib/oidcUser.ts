// Maps an Authentik (OIDC) profile onto an existing `users` row. No row → no access:
// there is no public sign-up, so SSO never creates accounts.
//
// The binding key is the IdP's stable (iss, sub), not the email: the first SSO
// login with a verified email that matches a users row binds that row to the
// subject; from then on only that subject gets in, even if someone later owns
// that email at the IdP.

export interface OidcProfile {
  iss?: unknown;
  sub?: unknown;
  email?: unknown;
  email_verified?: unknown;
}

export interface FolionixUser {
  id: string;
  email: string;
  name: string | null;
}

type Row = { id: string | number; email: string; name: string | null; oidc_subject?: string | null };

export interface OidcUserStore {
  findBySubject: (subject: string) => Promise<Row | undefined>;
  findByEmail: (email: string) => Promise<Row | undefined>;
  /** Bind only if still unbound; false when someone else won the race. */
  bindSubject: (id: string | number, subject: string) => Promise<boolean>;
}

const toUser = (r: Row): FolionixUser => ({ id: String(r.id), email: r.email, name: r.name });

export function oidcSubjectKey(profile: OidcProfile | undefined): string | null {
  const iss = typeof profile?.iss === "string" ? profile.iss : "";
  const sub = typeof profile?.sub === "string" ? profile.sub : "";
  return iss && sub ? `${iss}#${sub}` : null;
}

export async function findOidcUser(profile: OidcProfile | undefined, store: OidcUserStore): Promise<FolionixUser | null> {
  const subject = oidcSubjectKey(profile);
  if (!subject) return null;

  const bound = await store.findBySubject(subject);
  if (bound) return toUser(bound);

  // First SSO login: needs a verified email — an unverified address could be
  // self-asserted at the IdP and match someone else's account.
  if (profile?.email_verified !== true) return null;
  const email = typeof profile.email === "string" ? profile.email.trim().toLowerCase() : "";
  if (!email || email.length > 254) return null;
  const row = await store.findByEmail(email);
  if (!row || row.oidc_subject) return null; // unknown, or already bound to a different subject
  return (await store.bindSubject(row.id, subject)) ? toUser(row) : null;
}
