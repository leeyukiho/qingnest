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
Root zone:     985201314.xyz
Console host:  app.985201314.xyz
User route:    *.985201314.xyz/*
API route:     app.985201314.xyz/api/*
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
VITE_APP_HOST=app.985201314.xyz
VITE_DISTRIBUTION_ROOT=985201314.xyz
VITE_PUBLIC_PROTOCOL=https
```

Keep `VITE_API_BASE_URL` empty only when the Worker handles `<console-host>/api/*`.

Never set `SUPABASE_SERVICE_ROLE_KEY` in Pages.

## Worker Git Deployment

Create a Worker connected to GitHub.

```text
Production branch: main
Root directory:    /
Build variable:    NODE_VERSION=22
Build command:     npm run typecheck
Deploy command:    npx wrangler deploy apps/worker/src/index.ts --name <worker-name> --compatibility-date <yyyy-mm-dd> --keep-vars
Non-production branch deploy command:
  npx wrangler versions upload apps/worker/src/index.ts --name <worker-name> --compatibility-date <yyyy-mm-dd> --keep-vars
```

Do not set an `Install command` for Worker builds. Workers Builds uses Build command, Deploy command,
Non-production branch deploy command, and Root directory.

Keep Root directory as `/` because the root `package.json`, `package-lock.json`, and workspace packages
are needed. The Worker entry point is passed in the deploy commands as `apps/worker/src/index.ts`.
Set `NODE_VERSION=22` as a build variable, not as a Worker runtime variable.

This repository does not commit `apps/worker/wrangler.toml`. Configure Worker variables, secrets,
bindings, and routes in the Cloudflare dashboard.

## Worker Variables And Secrets

Plain variable:

```text
ENVIRONMENT=production
APP_HOST=app.985201314.xyz
DISTRIBUTION_ROOT=985201314.xyz
PUBLIC_PROTOCOL=https
RESEND_FROM_EMAIL=noreply@mail.985201314.xyz
RESEND_FROM_NAME=QingNest 轻巢
```

Secrets:

```text
SUPABASE_URL=<supabase-project-url>
SUPABASE_ANON_KEY=<supabase-public-anon-or-publishable-key>
SUPABASE_SERVICE_ROLE_KEY=<supabase-service-role-key>
RESEND_API_KEY=<resend-api-key>
```

`SUPABASE_SERVICE_ROLE_KEY` and `RESEND_API_KEY` must only be Worker secrets.

### Automatic Pages acceleration secrets

Add these as Worker secrets/variables, never as `VITE_*` values:

```text
CLOUDFLARE_ACCOUNT_ID=<account id>                 # variable
CLOUDFLARE_ZONE_ID=<zone id for distribution root> # variable
CLOUDFLARE_API_TOKEN=<scoped token>                # secret
```

Create the token in Cloudflare API Tokens with the minimum permissions:

```text
Account > Cloudflare Pages > Edit
Zone > Workers Routes > Edit
Zone > Analytics > Read
```

The token is used only by the Worker Cron lifecycle. It creates/deletes per-site Pages projects,
uploads assets, reads zone request aggregates, and creates/deletes the temporary hostname bypass
route. Do not grant `Account > Administrator`, DNS Edit, R2, or User permissions.

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

Analytics Engine binding:

```text
Variable name: TRAFFIC_ANALYTICS
Dataset:       qingnest_traffic
```
```

## Worker Routes

Configure these in `Worker` -> `Settings` -> `Domains & Routes`:

```text
app.985201314.xyz/api/*     -> <worker-name>
app.985201314.xyz/*         -> no Worker / bypass to Pages
*.985201314.xyz/*           -> <worker-name>
```

The console API route is needed when `VITE_API_BASE_URL` is empty.
The console bypass route prevents the wildcard user-site route from taking over the Pages console.
Private preview URLs use `preview.<distribution-root>/preview/<token>/`, so the wildcard
user route must include that hostname. Keep `preview` reserved from user domain assignments.

## Rate Limiting

Create a Cloudflare rate limiting rule in the `985201314.xyz` zone so abusive availability
checks are rejected before they invoke the Worker.

```text
Rule name:       subdomain-availability-check
Expression:      http.host eq "app.985201314.xyz"
                 and http.request.uri.path eq "/api/subdomains/check"
Method:          GET
Characteristics: IP
Threshold:       30 requests per 1 minute
Mitigation:      Block for 1 minute
```

The application also debounces and caches normal checks and applies a best-effort Worker-instance
limit. The zone-level rule is still required because application limits only run after a request
has already consumed a Worker invocation.
