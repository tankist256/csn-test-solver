# Temporary site accounts with PostgreSQL

This is the same personal tests, quests, leaderboard and administrator API as the
Entra version, using local email/password accounts while the External ID tenant
is unavailable. Passwords use Argon2id hashes. Opaque seven-day session tokens
are stored only as SHA-256 hashes in PostgreSQL and sent in HttpOnly, Secure,
SameSite=Lax cookies. POST requests require the `X-CSN-Request: 1` header.
Emails are login names **without email verification or self-service password
reset**. Do not treat an email match as proof of ownership or automatically
merge these accounts with future Entra users.

## Start on the existing VM

The PostgreSQL container listens only on Docker's internal network. It uses a
named volume `csn_postgres_data` so code updates do not erase user data. The
server has little RAM, so PostgreSQL is limited to 192 MiB and has conservative
connection settings.

In the VM checkout, generate one password and place both values in the ignored,
mode-600 `.env` file; never commit it:

```sh
AUTH_MODE=local
PROGRESS_BACKEND=postgres
CSN_POSTGRES_PASSWORD=<random-long-hex-value>
DATABASE_URL=postgresql://csn:<same-value>@postgres:5432/csn
CSN_COOKIE_SECURE=1
```

Keep `AUTH_ENABLED=0` until the Entra tenant is ready. Start PostgreSQL and
wait for its health check before starting the site:

```sh
docker compose --profile postgres up -d --wait postgres
docker compose up -d --build solver
curl -fsS http://127.0.0.1:8080/api/config
```

The config response should show `"auth_enabled":true,"auth_mode":"local"`.
Test registration on the HTTPS site, then sign out and back in. Progress and
sessions persist across container restarts. The old public search and practice
modes remain accessible without an account.

## Administrator

Register an account through the site, read its UUID from `/api/me` while signed
in, then run this **only on the server**:

```sh
docker exec csn-solver python -m solver.local_auth promote <user-uuid>
```

Sign out and back in to refresh the visible admin panel. This server-only
command bootstraps the first administrator. After that, a signed-in
administrator can open **Administrācija → Apskatīt lietotājus → user** to
grant or revoke the Admin role for another local account. The change takes
effect on that user's next API request. The server checks the acting admin's
current role inside the database transaction, requires the CSRF header, and
blocks self-demotion. An ordinary browser request or matching email address
cannot grant the Admin role. Because email addresses are not verified, check
the account owner's identity before granting access; the panel shows the
account UUID to help distinguish accounts. In Entra mode, assign application
roles in Entra instead; this panel cannot edit Entra claims.

## Backup and moving hosts

To create a portable, compressed backup, run on the VM:

```sh
umask 077
docker exec csn-postgres pg_dump -U csn -d csn -Fc > csn-$(date +%F).dump
```

Copy the dump off the VM before relying on it for recovery. On a new host,
create an empty PostgreSQL database and restore with `pg_restore --no-owner`;
then point `DATABASE_URL` at that database. Do not copy session cookies or put
passwords in Git. PostgreSQL progress data uses stable internal UUIDs. When
Entra becomes available, add an explicit account-linking flow that proves
control of both identities before mapping its object ID to the existing UUID.

For a local integration check, run a disposable PostgreSQL container, set
`DATABASE_URL`, then run `python -m unittest discover -s tests`.
