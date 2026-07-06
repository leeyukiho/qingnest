# QingNest Deployment Checklist

This is a public-safe deployment checklist. Keep real Cloudflare IDs, exact production resource IDs,
and secrets in `docs/cloudflare-ops.local.md`, which is ignored by Git.

## Infrastructure

Cloudflare:

```text
Pages project: <pages-project-name>
Worker name:   <worker-name>
R2 bucket:     <r2-bucket-name>
KV namespace:  <kv-namespace-name>
User route:    *.985201314.xyz/*
Console host:  app.985201314.xyz
API route:     app.985201314.xyz/api/*
```

Supabase:

```text
Auth
Postgres
RLS
Data API grants
```

## One-Time Supabase Setup

```bash
npx supabase login
npx supabase link --project-ref <project-ref>
npm run supabase:db:push
```

Or run `supabase/migrations/0001_initial_schema.sql` in the Supabase SQL Editor.

## Cloudflare Dashboard Setup

Pages:

```text
Build command: npm run build
Build output:  dist
NODE_VERSION=20
VITE_SUPABASE_URL=<supabase-project-url>
VITE_SUPABASE_ANON_KEY=<supabase-public-anon-or-publishable-key>
VITE_API_BASE_URL=
VITE_APP_HOST=app.985201314.xyz
VITE_DISTRIBUTION_ROOT=985201314.xyz
VITE_PUBLIC_PROTOCOL=https
```

Worker:

```text
Production branch: main
Root directory: /
Build variable: NODE_VERSION=22
Build command: npm run typecheck
Deploy command: npx wrangler deploy apps/worker/src/index.ts --name <worker-name> --compatibility-date <yyyy-mm-dd> --keep-vars
Non-production branch deploy command:
  npx wrangler versions upload apps/worker/src/index.ts --name <worker-name> --compatibility-date <yyyy-mm-dd> --keep-vars
ENVIRONMENT=production
APP_HOST=app.985201314.xyz
DISTRIBUTION_ROOT=985201314.xyz
PUBLIC_PROTOCOL=https
RESEND_FROM_EMAIL=noreply@985201314.xyz
RESEND_FROM_NAME=QingNest 轻巢
SUPABASE_URL=<supabase-project-url>
SUPABASE_ANON_KEY=<supabase-public-anon-or-publishable-key>
SUPABASE_SERVICE_ROLE_KEY=<supabase-service-role-key>
RESEND_API_KEY=<resend-api-key>
R2 binding: SITE_ASSETS -> <r2-bucket-name>
KV binding: DOMAIN_MAP -> <kv-namespace-name>
```

Never put `SUPABASE_SERVICE_ROLE_KEY` or `RESEND_API_KEY` in Pages or any `VITE_` variable.

## Preflight Checks

```bash
npm run typecheck
npm run build
```

When Docker Desktop is running:

```bash
npm run supabase:start
npm run supabase:db:reset
npm run supabase:db:lint
npm run supabase:advisors
```

## Remaining Product Work

The infrastructure is ready for Auth and metadata persistence. The deployment product flow still
needs:

- R2 file upload or signed upload URLs.
- File hash and manifest verification.
- Deployment activation that sets `sites.active_deployment_id`.
- KV refresh after activation.
- Turnstile and stricter email verification enforcement.
