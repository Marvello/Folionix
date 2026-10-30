import NextAuth from "next-auth";
import Authentik from "next-auth/providers/authentik";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { getPool } from "./db";
import { clearFailures, isLocked, recordFailure } from "./loginThrottle";
import { findOidcUser, type OidcProfile } from "./oidcUser";

// Authentik SSO is on only when configured (AUTH_AUTHENTIK_ID / _SECRET / _ISSUER, read by Auth.js by name).
const authentikEnabled = Boolean(process.env.AUTH_AUTHENTIK_ISSUER);

async function findUserByEmail(email: string) {
  const { rows } = await getPool().query("SELECT id, email, name FROM users WHERE lower(email) = $1", [email]);
  return rows[0];
}

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

        // Behind Cloudflare the client IP is in cf-connecting-ip.
        const ip =
          request.headers.get("cf-connecting-ip") ??
          request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
          "unknown";
        const keys = [`email:${email}`, `ip:${ip}`];
        if (keys.some((k) => isLocked(k))) {
          console.warn(`[auth] login throttled email=${email} ip=${ip}`);
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
          keys.forEach((k) => recordFailure(k));
          console.warn(`[auth] login failed email=${email} ip=${ip}`);
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
      const user = await findOidcUser(profile as OidcProfile, findUserByEmail);
      if (!user) console.warn(`[auth] authentik login refused email=${String(profile?.email)}`);
      return Boolean(user);
    },
    // Make an SSO session carry the DB user, exactly like a Credentials one.
    async jwt({ token, account, profile }) {
      if (account?.provider === "authentik") {
        const user = await findOidcUser(profile as OidcProfile, findUserByEmail);
        if (user) Object.assign(token, { sub: user.id, email: user.email, name: user.name });
      }
      return token;
    },
  },
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
});
