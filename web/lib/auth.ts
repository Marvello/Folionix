import NextAuth from "next-auth";
import Authentik from "next-auth/providers/authentik";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { getPool } from "./db";
import { clearFailures, tryAttempt } from "./loginThrottle";
import { findOidcUser, type OidcProfile, type OidcUserStore } from "./oidcUser";

// Authentik SSO is on only when configured (AUTH_AUTHENTIK_ID / _SECRET / _ISSUER, read by Auth.js by name).
const authentikEnabled = Boolean(process.env.AUTH_AUTHENTIK_ISSUER);

const oidcStore: OidcUserStore = {
  async findBySubject(subject) {
    const { rows } = await getPool().query("SELECT id, email, name FROM users WHERE oidc_subject = $1", [subject]);
    return rows[0];
  },
  async findByEmail(email) {
    const { rows } = await getPool().query("SELECT id, email, name, oidc_subject FROM users WHERE lower(email) = $1", [email]);
    return rows[0];
  },
  async bindSubject(id, subject) {
    const { rowCount } = await getPool().query(
      "UPDATE users SET oidc_subject = $2 WHERE id = $1 AND oidc_subject IS NULL",
      [id, subject],
    );
    return rowCount === 1;
  },
};

// The id-token profile carries iss; a userinfo-only profile may not, so fall
// back to the configured issuer (one IdP).
const ssoProfile = (p: unknown): OidcProfile => ({ ...(p as OidcProfile), iss: (p as OidcProfile)?.iss ?? process.env.AUTH_AUTHENTIK_ISSUER });

// Compared against when the email is unknown, at the same cost as real hashes
// (common-tech/tech-standard/password-hashing.md), so both paths take as long.
const DUMMY_HASH = bcrypt.hashSync(crypto.randomUUID(), Number(process.env.BCRYPT_ROUNDS ?? 12));

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        const email = typeof credentials.email === "string" ? credentials.email.trim().toLowerCase() : "";
        const password = typeof credentials.password === "string" ? credentials.password : "";
        if (!email || !password || email.length > 254 || password.length > 200) return null;

        // Only Cloudflare's cf-connecting-ip is trusted: the tunnel overwrites it,
        // while x-forwarded-for is whatever the client sent. Off-Cloudflare
        // (local dev) every request shares the "unknown" bucket.
        const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
        const keys = [`email:${email}`, `ip:${ip}`];
        if (!tryAttempt(keys)) {
          console.warn(`[auth] login throttled email=${JSON.stringify(email)} ip=${JSON.stringify(ip)}`);
          return null;
        }

        const { rows } = await getPool().query(
          "SELECT id, email, password_hash, name FROM users WHERE lower(email) = $1",
          [email],
        );
        const user = rows[0];
        // Always pay for one bcrypt compare so response time doesn't reveal
        // whether the email exists.
        const valid = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
        if (!user || !valid) {
          console.warn(`[auth] login failed email=${JSON.stringify(email)} ip=${JSON.stringify(ip)}`);
          return null;
        }
        keys.forEach(clearFailures);
        return { id: String(user.id), email: user.email, name: user.name };
      },
    }),
    ...(authentikEnabled ? [Authentik] : []),
  ],
  callbacks: {
    // SSO only signs in people who already have a users row (no public sign-up).
    async signIn({ account, profile }) {
      if (account?.provider !== "authentik") return true;
      const user = await findOidcUser(ssoProfile(profile), oidcStore);
      if (!user) console.warn(`[auth] authentik login refused email=${JSON.stringify(String(profile?.email))}`);
      return Boolean(user);
    },
    // Make an SSO session carry the DB user, exactly like a Credentials one.
    // No user → null ends the sign-in instead of minting a session that carries
    // the IdP's sub as if it were a users.id.
    async jwt({ token, account, profile }) {
      if (account?.provider === "authentik") {
        const user = await findOidcUser(ssoProfile(profile), oidcStore);
        if (!user) return null;
        Object.assign(token, { sub: user.id, email: user.email, name: user.name });
      }
      return token;
    },
  },
  // 7 days (Auth.js default is 30). JWTs can't be revoked one by one: rotating
  // AUTH_SECRET signs every session out (knowledge/runbooks/auth.md).
  session: { strategy: "jwt", maxAge: 7 * 24 * 60 * 60 },
  pages: { signIn: "/login" },
});
