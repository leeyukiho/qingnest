# Cloudflare Setup

This is the public-safe template for Cloudflare setup. Do not put real Cloudflare account IDs,
namespace IDs, bucket IDs, private routes, or secrets in this file.

Use `docs/cloudflare-ops.local.md` for local-only production values. That file is ignored by Git.

## Resources

```text
Pages project: <pages-project-name>
Worker name:   <worker-name>
R2 bucket:     <r2-bucket-name>
KV namespace:  <kv-namespace-name>
KV id:         <kv-namespace-id>
Root zone:     <example.com>
Console host:  <app.example.com>
User route:    <*.sites.example.com/*>
API route:     <app.example.com/api/*>
```

## Pages Git Deployment

Create a Cloudflare Pages project connected to GitHub.

For this Vite app:

```text
Build command: npm run build
Build output:  dist
Root directory: repository root
```

Set Pages environment variables:

```text
NODE_VERSION=20
VITE_SUPABASE_URL=<supabase-project-url>
VITE_SUPABASE_ANON_KEY=<supabase-public-anon-or-publishable-key>
VITE_API_BASE_URL=
VITE_APP_HOST=<app.example.com>
VITE_DISTRIBUTION_ROOT=<sites.example.com>
VITE_PUBLIC_PROTOCOL=https
```

Keep `VITE_API_BASE_URL` empty only when the Worker handles `<console-host>/api/*`.

Never set `SUPABASE_SERVICE_ROLE_KEY` in Pages.

## Worker Git Deployment

Create a Worker connected to GitHub.

```text
Entry file: apps/worker/src/index.ts
```

If the dashboard asks for commands:

```text
Install command: npm ci
Build command:   npm run typecheck
Deploy command:  npx wrangler deploy apps/worker/src/index.ts --name <worker-name> --compatibility-date <yyyy-mm-dd> --keep-vars
```

This repository does not commit `apps/worker/wrangler.toml`. Configure Worker variables, secrets,
bindings, and routes in the Cloudflare dashboard.

## Worker Variables And Secrets

Plain variable:

```text
ENVIRONMENT=production
APP_HOST=<app.example.com>
DISTRIBUTION_ROOT=<sites.example.com>
PUBLIC_PROTOCOL=https
```

Secrets:

```text
SUPABASE_URL=<supabase-project-url>
SUPABASE_ANON_KEY=<supabase-public-anon-or-publishable-key>
SUPABASE_SERVICE_ROLE_KEY=<supabase-service-role-key>
```

`SUPABASE_SERVICE_ROLE_KEY` must only be a Worker secret.

## Worker Bindings

R2 bucket binding:

```text
Variable name: SITE_ASSETS
Bucket:        <r2-bucket-name>
```

KV namespace binding:

```text
Variable name: DOMAIN_MAP
Namespace:     <kv-namespace-name>
Namespace ID:  <kv-namespace-id>
```

## Worker Routes

Configure these in `Worker` -> `Settings` -> `Domains & Routes`:

```text
<*.sites.example.com/*>     -> <worker-name>
<app.example.com/api/*>     -> <worker-name>
```

The console API route is needed when `VITE_API_BASE_URL` is empty.
