# Runbook: switch folionix-web to the least-privilege DB role

Migration `053_web_role.sql` creates `folionix_web` (NOLOGIN, DML only) when the
app services start. Web keeps working as the owner until you finish these steps.
**Order matters**: switching `DATABASE_URL` before step 2 takes web down.

1. Deploy an app image that contains migration 053 (bot/graph/worker run it at boot).
   Check: `kubectl -n folionix exec deploy/folionix-db -- psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select rolname, rolcanlogin from pg_roles where rolname='folionix_web'"`
   — expect one row, `rolcanlogin = f`. No row → the owner can't create roles; see the NOTICE in the app log.
2. Pick a password and enable login:
   ```sh
   PW=$(openssl rand -base64 32 | tr -d '/+=')
   kubectl -n folionix exec -i deploy/folionix-db -- psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
     -c "alter role folionix_web login password '$PW'"
   ```
3. Add `POSTGRES_WEB_PASSWORD=$PW` to `common-tech/homeserver/k8s/folionix/folionix-secrets.env`
   (gitignored, no trailing newline issues — it's an env file, not piped base64).
4. `kubectl apply -k common-tech/homeserver/k8s/folionix` — the web Deployment's
   `DATABASE_URL` already points at `folionix_web:$(POSTGRES_WEB_PASSWORD)`.
5. `kubectl -n folionix rollout restart deploy/folionix-web`, then verify:
   `/api/health` is 200, log in, open Stocks and Settings, save a setting.

Rollback: point the web `DATABASE_URL` back at `$(POSTGRES_USER):$(POSTGRES_PASSWORD)` and re-apply.

New tables need nothing: default privileges grant `folionix_web` DML on tables the
owner creates later. A table created by a *different* role needs a manual grant.
