# Runbook: web auth operations

Sessions are stateless JWTs (`web/lib/auth.ts`, `maxAge` 7 days). There is no
session table, so individual sessions cannot be revoked.

## Sign everyone out (suspected token theft, lost device)
Rotate `AUTH_SECRET` — every existing JWT stops verifying.
1. `openssl rand -base64 33` → replace `AUTH_SECRET` in
   `common-tech/homeserver/k8s/folionix/folionix-secrets.env` (local compose: `.env`).
2. `kubectl apply -k common-tech/homeserver/k8s/folionix && kubectl -n folionix rollout restart deploy/folionix-web`.
3. Log in again; old browser tabs land on `/login`.

## Add a user / reset a password by hand
There is no sign-up or reset flow. Hash with **bcryptjs at cost 12** (matches
`BCRYPT_ROUNDS` and the dummy hash, so login timing stays uniform —
common-tech/tech-standard/password-hashing.md):
```sh
cd web && node -e "console.log(require('bcryptjs').hashSync(process.argv[1], 12))" 'the-password'
```
```sql
insert into users (email, name, password_hash) values (lower('me@example.com'), 'Me', '$2b$12$…');
-- or: update users set password_hash = '$2b$12$…' where lower(email) = lower('me@example.com');
```
Store emails lower-case (`uq_users_email_lower` enforces uniqueness case-insensitively).

## Authentik SSO binding
The first SSO login with a verified email that matches a `users` row binds the
row to Authentik's `iss#sub` (`users.oidc_subject`, migration 052). After that
only that Authentik account gets in. To move a user to a new Authentik account:
`update users set oidc_subject = null where id = …;` then log in with the new account.

## Throttle
5 failed logins per email or per client IP (Cloudflare `cf-connecting-ip`) in
15 min → 15 min lock, in memory (a web restart clears it).
