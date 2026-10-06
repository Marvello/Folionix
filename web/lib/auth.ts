import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { getPool } from "./db";
import { clearFailures, isLocked, recordFailure } from "./loginThrottle";

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
  ],
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
});
