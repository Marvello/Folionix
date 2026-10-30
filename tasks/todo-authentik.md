# Authentik sign-in for folionix web (2026-10-30)

Goal: "Sign in with Authentik" on `/login`, next to the existing email/password form. Only people who already
have a folionix `users` row get in (matched by verified email); nobody is auto-created.

## Plan
- [x] `web/lib/auth.ts`: add the Auth.js `authentik` provider (issuer `https://auth.velinlovewithmar.com/application/o/folionix/`,
      env `AUTH_AUTHENTIK_ID` / `AUTH_AUTHENTIK_SECRET` / `AUTH_AUTHENTIK_ISSUER`) — only when those env vars are set, so local dev
      without them keeps working.
- [x] `signIn` callback: for the authentik provider require `email_verified`, look the email up in `users`
      (`lower(email) = $1`); unknown → refuse. `jwt` callback: put the DB user id/name in the token so the session looks
      exactly like a Credentials login (`session.user.id` = DB id).
- [x] `web/app/login/page.tsx`: "Sign in with Authentik" button → `signIn("authentik")`; error message for refused accounts.
- [x] Tests: unit test for the email→user mapping (refuse unknown / unverified, accept known, case-insensitive).
- [ ] Authentik (homeserver): provider+app `folionix`, group `Folionix Users`, redirect `/api/auth/callback/authentik`,
      `include_claims_in_id_token=False` not needed (JWT session, no id_token in cookie) but keep tokens small anyway.
- [ ] homeserver `k8s/folionix`: add the 3 env vars (id/secret in the gitignored `folionix-secrets.env`), deploy via the normal
      CI image build + tag bump (manifest is tag-pinned).
- [ ] Verify: login page shows button; flow reaches authentik; a real login creates a session (check, don't assume).

## Not doing
- No change to the password form, throttling, or the `/api/weekly-reviews` bearer route.
