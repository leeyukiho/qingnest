# Supabase Setup

Supabase provides Auth, Postgres metadata, RLS, audit logs, and abuse reports.

## CLI

The Supabase CLI is pinned in `devDependencies`, so use npm scripts or `npx supabase`.

```bash
npm run supabase:start
npm run supabase:db:reset
npm run supabase:db:lint
npm run supabase:advisors
```

For the hosted project, log in and link the project first:

```bash
npx supabase login
npx supabase link --project-ref your-project-ref
npm run supabase:db:push
```

If you do not want to use CLI auth, open the Supabase SQL Editor and run every file in
`supabase/migrations` in filename order. The first file is:

```text
supabase/migrations/0001_initial_schema.sql
```

## Migration Coverage

The initial migration creates:

```text
profiles
sites
domains
deployments
deployment_files
upload_sessions
audit_events
abuse_reports
```

It also configures:

```text
pgcrypto extension
Auth user -> profile trigger
profile roles
updated_at trigger for sites
RLS on every public table
explicit Data API GRANTs for anon/authenticated/service_role
foreign-key and routing indexes
```

New Supabase projects no longer expose public tables to the Data API automatically, so explicit
`GRANT` statements are included in the migration. Keep grants and RLS policies together when adding
new public tables.

## Worker Secrets

After the hosted Supabase project exists, set these secrets in the Cloudflare Worker dashboard:

```text
SUPABASE_URL=<supabase-project-url>
SUPABASE_ANON_KEY=<supabase-public-anon-or-publishable-key>
SUPABASE_SERVICE_ROLE_KEY=<supabase-service-role-key>
```

The Worker uses the service role key for server-side metadata writes. Never expose it to Pages,
browser code, or any `VITE_` variable.

## Pages Variables

Set public Supabase variables in Cloudflare Pages:

```text
VITE_SUPABASE_URL=https://clxgkoxnylybvkwtviwr.supabase.co
VITE_SUPABASE_ANON_KEY=your-public-anon-or-publishable-key
VITE_APP_HOST=app.985201314.xyz
VITE_DISTRIBUTION_ROOT=985201314.xyz
VITE_PUBLIC_PROTOCOL=https
```

The frontend uses these for Supabase Auth and passes the user's access token to the Worker.

## Auth Email Verification

Public signup is disabled globally in `supabase/config.toml`, while the Email provider remains
enabled so verified users can still sign in with email and password. Registration is handled by the
Worker:

```text
Pages -> Worker /api/auth/sign-up -> Supabase Admin generateLink -> Resend API
```

Confirmation links expire after 24 hours (`otp_expiry = 86400`). The Worker stores a per-email
signup send lock for the same 24-hour window so a user cannot trigger duplicate confirmation emails
from another browser or device. The Worker also rejects site creation and upload-session operations
unless the Supabase user token has a confirmed email.

Set these secrets/variables in the Worker environment, not in public Pages variables:

```text
RESEND_API_KEY=<resend-api-key>
RESEND_FROM_EMAIL=noreply@mail.985201314.xyz
RESEND_FROM_NAME=QingNest 轻巢
```

Hosted Supabase projects must leave the Email provider enabled in Dashboard -> Authentication ->
Sign In / Providers -> Email. Disable public signup with the global signup setting instead; turning
off the Email provider causes password login to fail with `Email logins are disabled`.

## Roles

`profiles.role` distinguishes regular users from admins:

```text
user
admin
```

New profiles default to `user`. Do not expose role updates to the browser. Promote an account from
the Supabase SQL Editor or a trusted backend path:

```sql
update public.profiles
set role = 'admin'
where email = 'admin@example.com';
```

## Free Plan Guardrails

The app keeps QingNest's own free tier below Supabase's free project envelope by enforcing compact
application-level limits in `packages/shared/config/platform.json`:

```text
maxSites=3
maxStorageBytes=150 MB
maxDeploymentsPerDay=20
maxUploadSessionsPerHour=10
maxSiteBytes=50 MB
maxFileBytes=10 MB
```

To change domain blacklist/manual-review rules, edit `subdomainPolicy.reserved` and
`subdomainPolicy.manualReviewKeywords` in `packages/shared/config/platform.json`. To change upload
size or quota limits, edit the relevant `plans.free.quotas` values in the same file. Keep these
limits conservative unless you upgrade Supabase, R2, and Worker capacity together.

## Local Files

For local frontend development:

```powershell
Copy-Item .env.example .env
```

For local Worker development:

```powershell
Copy-Item .dev.vars.example .dev.vars
```

Fill both files with values from `npx supabase status` after running `npm run supabase:start`, or
with hosted project values when testing against production.

## Current Limitation

The API now persists sites, domains, deployments, deployment files, upload sessions, and audit events
to Supabase. The actual R2 file upload and deployment activation flow is still the next implementation
step: after files are uploaded, the app must mark the deployment active, set `sites.active_deployment_id`,
and refresh the KV domain mapping.
