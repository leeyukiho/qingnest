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

If you do not want to use CLI auth, open the Supabase SQL Editor and run:

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
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-public-anon-or-publishable-key
VITE_APP_HOST=app.example.com
VITE_DISTRIBUTION_ROOT=sites.example.com
VITE_PUBLIC_PROTOCOL=https
```

The frontend uses these for Supabase Auth and passes the user's access token to the Worker.

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
