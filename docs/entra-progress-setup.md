# Personal tests: Entra External ID and Azure Tables

The existing question search and practice modes remain available without sign-in. Personal tests, quests, results and the leaderboard appear when `AUTH_ENABLED=1` and the configuration below is complete. Do not enable this switch until both Entra and storage are ready.
The server also needs its existing `solver/questions.json` file; only verified questions with a valid answer enter personal tests.

## Entra External ID

1. In an **external tenant**, register a single-page application (SPA) for this site. Add the exact HTTPS site origin with a trailing slash as a SPA redirect URI, for example `https://example.com/`. Add `http://localhost:8080/` for local interactive checks if needed. Record the tenant ID, tenant subdomain and SPA application (client) ID. Configure a customer sign-up/sign-in user flow and associate the SPA with it.
2. Register a second application for the Python API. Under **Expose an API**, set an application ID URI (usually `api://<API client ID>`) and publish the delegated scope `access_as_user`. Set accepted access-token version to 2. Grant the SPA delegated permission to that scope and provide consent according to the tenant policy.
3. On the API registration, define an `Admin` app role for **Users/Groups** and assign it only to administrators. The API checks the signed `roles` claim; a browser flag or email address never grants admin access. Ordinary signed-in users receive the default `User` role in this application. If you need assignment-gated user access, set `AUTH_DEFAULT_USER_ROLE=0` and define/assign a `User` API app role.
4. Use the tenant-specific OpenID discovery endpoint. By default it is derived from the subdomain and tenant ID. Confirm that the API access token contains the expected `aud`, `iss`, `oid`, and `scp=access_as_user` claims. The server validates signature, issuer, audience, expiration and scope.

Microsoft guides: [External ID SPA registration](https://learn.microsoft.com/en-us/entra/external-id/customers/tutorial-single-page-app-react-prepare-app), [API scopes](https://learn.microsoft.com/en-us/samples/azure-samples/ms-identity-ciam-javascript-tutorial/ms-identity-ciam-javascript-tutorial-4-call-api-express/), [app roles](https://learn.microsoft.com/en-us/entra/external-id/customers/how-to-use-app-roles-customers).

## Azure Table Storage

Create a standard Storage account with Table service. The application uses six tables: `Users`, `Attempts`, `AttemptResults`, `Answers`, `UserQuests`, and `Leaderboard`. It creates missing tables when permitted. The easiest first setup uses `AZURE_TABLES_CONNECTION_STRING` as a secret on the server. For a managed identity, use `AZURE_STORAGE_ACCOUNT_URL=https://<account>.table.core.windows.net`, grant the identity **Storage Table Data Contributor**, and pre-create the tables if the identity cannot create them. Back up the account and restrict access to the connection string.

Each user's records use the Entra object ID (`oid`). `AttemptResults` and `UserQuests` are insert-only to avoid duplicate results and rewards. The browser does not submit a score or quest completion.

## Server configuration

Copy `/.env.example` to a local `/.env` (ignored by Git), fill the values, then start the container. For a direct Python launch, export the same variables in the process environment. No Azure configuration is committed to the repository.

| Variable | Value |
| --- | --- |
| `AUTH_ENABLED` | `1` after setup |
| `ENTRA_TENANT_ID` | External tenant GUID |
| `ENTRA_TENANT_SUBDOMAIN` | Subdomain before `.ciamlogin.com` |
| `ENTRA_API_AUDIENCE` | API client ID expected in the access-token `aud` claim |
| `ENTRA_SPA_CLIENT_ID` | SPA client ID |
| `ENTRA_API_SCOPE` | Full scope, such as `api://<API client ID>/access_as_user` |
| `ENTRA_REQUIRED_SCOPE` | `access_as_user` |
| `AZURE_TABLES_CONNECTION_STRING` | Storage secret, or use account URL |
| `AZURE_STORAGE_ACCOUNT_URL` | Table endpoint for managed identity |

The first local check is `GET /api/config`, which should return `auth_enabled: true` only when the public Entra settings are complete. Verify sign-in, one 30-question attempt, the 60-second timer, a second browser session for the same user, a different user's private results, and an `Admin` role account. Do not use an ID token as the API bearer token; the SPA requests an access token for the API scope.

## Scoring rule (project assumption)

A 30, 60 or 120 question attempt gives 60 seconds per question. At the deadline, an unanswered question is skipped. A quest completes when **one** attempt of its size reaches 80% correct: 24/30, 48/60 or 96/120. Each quest grants its fixed reward **once**: 30, 60 or 120 points. The leaderboard sorts by quest points, then completed quest count, then user ID for a stable tie. Retaking a test does not multiply quest points. All grading and time decisions are made by the server.

The existing public question bank includes correct answer IDs because the answer-search feature needs them. These tests are for learning and friendly competition, not a tamper-proof exam.
