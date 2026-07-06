# QingNest

QingNest（轻巢）是一个面向 AI 生成前端项目和前端初学者的一键静态站点发布工具。当前仓库实现 Phase 1 MVP 的基础骨架：控制台、浏览器端 ZIP 预检、Worker API、通配域名路由、R2 静态资源读取和 Supabase 数据模型。

## 目录结构

```text
apps/web/               Cloudflare Pages 部署的 React 控制台
apps/worker/            Cloudflare Worker API 和用户站点路由
packages/shared/        前端和 Worker 共享的配置校验、扫描、MIME、缓存逻辑
supabase/migrations/    Supabase 表结构和 RLS
```

## 配置原则

后续运营过程中可能调整的东西不要写死在业务代码里：

- 域名根、协议、客服邮箱、举报邮箱：`packages/shared/config/platform.json`，生产域名用 Cloudflare 环境变量覆盖
- 免费版/付费版额度：`packages/shared/config/platform.json` 的 `plans.*.quotas`
- 套餐能力开关：`packages/shared/config/platform.json` 的 `plans.*.capabilities`
- 邮箱验证、Turnstile、审核要求：`packages/shared/config/platform.json` 的 `plans.*.requirements`
- 子域名规则、保留词、品牌风险词：`packages/shared/config/platform.json` 的 `subdomainPolicy`
- 上传限制、构建产物目录、屏蔽路径：`packages/shared/config/platform.json` 的 `deployment`
- 审核阈值和风险规则：`packages/shared/config/platform.json` 的 `riskRules`
- 新用户冷却、创建频率、失败部署频率、自动封禁阈值：`packages/shared/config/platform.json` 的 `abuseControls`
- MIME、缓存、安全响应头：`packages/shared/config/platform.json`
- 私密凭据：`.env`、`.dev.vars`，不要提交仓库

## 推荐生产架构

最适合当前“低成本扩张”的架构不是只部署 Worker，也不是给每个用户建 Pages 项目，而是：

```text
QingNest 控制台：Cloudflare Pages
可信控制面 API：Cloudflare Worker
用户站点分发：同一个 Cloudflare Worker 通配域名路由
静态资产存储：Cloudflare R2
元数据和账号：Supabase Auth + Postgres
域名映射缓存：Cloudflare KV
```

需要部署的东西：

1. Cloudflare Pages：部署 QingNest 自己的前端控制台。
2. Cloudflare Worker：部署 API 和 `*.distributionRoot` 的用户站点路由。
3. Cloudflare R2 bucket：存用户上传后的静态文件。
4. Cloudflare KV namespace：缓存子域名到 active deployment 的映射。
5. Supabase 项目：部署 Auth、Postgres 表、RLS 和后续管理后台数据。
6. DNS：`app` 指向 Pages，`*` 通配子域名指向 Worker。

为什么不只部署 Worker：

- Worker 可以同时托管前端和 API，但控制台静态资源走 Worker 会消耗 Worker 请求额度。
- Pages 托管控制台更贴近“0 成本启动”，静态控制台流量不占 Worker 计算路径。
- 用户站点访问必须走 Worker，因为需要按 Host 查映射、做 SPA fallback、下架、审核和缓存控制。

为什么不为每个用户部署 Cloudflare Pages：

- 每个站点一个 Pages 项目会增加项目管理、API 调用、构建和额度复杂度。
- MVP 只需要静态产物托管，R2 + 通配 Worker 更便宜、可控、迁移也更简单。

## Cloudflare 自动部署

这个仓库已经按 monorepo 整理，可以直接上传到 GitHub，然后分别在 Cloudflare 创建 Pages 和 Worker。

更详细的 Cloudflare 资源创建步骤见 `docs/cloudflare-setup.md`，Supabase 设置见 `docs/supabase-setup.md`。

### Pages 控制台

在 Cloudflare Pages 里连接 GitHub 仓库：

```text
Project name: <pages-project-name>
Production branch: main
Build command: npm run build
Build output directory: dist
Root directory: /
Node.js version: 20 或 24
```

Pages 只部署 `apps/web` 的控制台前端，但构建命令从仓库根目录运行，方便一起引用 `packages/shared`。

如果 Worker API 和 Pages 不在同一个域名下，在 Pages 环境变量里设置：

```text
VITE_API_BASE_URL=https://你的-worker-api域名
```

如果你用 Cloudflare 路由把 `app.985201314.xyz/api/*` 也转到 Worker，则可以保持为空，前端会请求相对路径 `/api/*`。

生产域名不要写进仓库，在 Cloudflare Pages 环境变量里设置：

```text
VITE_APP_HOST=app.985201314.xyz
VITE_DISTRIBUTION_ROOT=985201314.xyz
VITE_PUBLIC_PROTOCOL=https
```

### Worker API + Router

仓库不上传真实 `apps/worker/wrangler.toml`。在 Cloudflare Workers 面板连接同一个 GitHub 仓库后，按下面方式配置：

```text
Project name: <worker-name>
Production branch: main
Root directory: /
Build variable: NODE_VERSION=22
Build command: npm run typecheck
Deploy command: npx wrangler deploy apps/worker/src/index.ts --name <worker-name> --compatibility-date <yyyy-mm-dd> --keep-vars
Non-production branch deploy command:
  npx wrangler versions upload apps/worker/src/index.ts --name <worker-name> --compatibility-date <yyyy-mm-dd> --keep-vars
```

推送 `main` 分支后，Cloudflare 会自动部署 Worker。仓库不再使用 GitHub Actions 部署 Worker，避免同一次 push 触发两次部署。

Worker Git 部署不要写单独的 `Install command`。Root directory 保持 `/`，因为依赖安装和 workspace 解析需要仓库根目录；Worker 入口文件在 deploy command 里指定。`NODE_VERSION=22` 是构建变量，不是 Worker 运行时变量。

Worker 的变量、secrets、R2/KV bindings 和 routes 都在 Cloudflare Dashboard 配，不写进仓库。公开模板见 `docs/cloudflare-setup.md`，真实名字和 ID 放在本地忽略文件 `docs/cloudflare-ops.local.md`。

Worker 需要这些生产环境变量来覆盖公开示例域名：

```text
APP_HOST=app.985201314.xyz
DISTRIBUTION_ROOT=985201314.xyz
PUBLIC_PROTOCOL=https
```

### DNS 建议

```text
app.985201314.xyz       -> Cloudflare Pages 自定义域名
app.985201314.xyz/api/* -> Cloudflare Worker route
app.985201314.xyz/*     -> bypass/no Worker，继续交给 Pages
*.985201314.xyz         -> Cloudflare Worker route
985201314.xyz           -> 官网或跳转到 app
```

主品牌域名和用户分发域名最好分开，降低用户站点滥用对品牌域名的影响。

## 本地运行

```bash
npm install
npm run supabase:start
npm run supabase:db:reset
cp .env.example .env
cp .dev.vars.example .dev.vars
npm run worker:dev
npm run dev
```

前端默认运行在 `http://127.0.0.1:5173`，`/api` 会代理到 `http://127.0.0.1:8787`。

## 当前实现范围

- 控制台支持创建站点草稿、检查子域名、上传 ZIP、展示部署诊断。
- 浏览器端解压 ZIP 并检查入口文件、源码误传、文件数量/大小、敏感路径、SPA fallback 和基础风险。
- Worker 提供健康检查、子域名检查、站点创建、上传会话创建。
- Worker 在配置 Supabase 后会校验 Supabase Auth JWT，并用 service role 持久化站点、域名、部署、部署文件、上传会话和审计事件。
- Worker Router 支持从 R2 读取静态资源、补齐 `/about.html` 和 `/about/index.html`、SPA fallback、MIME 和缓存头。
- Supabase 迁移覆盖 profiles、sites、domains、deployments、deployment_files、upload_sessions、audit_events、abuse_reports、RLS、显式 Data API GRANT 和基础索引。

## 仍需接入的真实服务

当前基础设施已经接好 Supabase 元数据持久化，下一步生产化还需要补齐文件发布闭环：

- 生成 R2 直传签名或 Worker 上传接口
- 完成 manifest 校验和文件 hash 校验
- 发布成功后更新 `active_deployment_id` 和 KV 域名映射
- 接入 Turnstile、邮件验证强制校验和审核后台

## 常用命令

```bash
npm run dev
npm run worker:dev
npm run supabase:db:lint
npm run supabase:advisors
npm run typecheck
npm run build
```
