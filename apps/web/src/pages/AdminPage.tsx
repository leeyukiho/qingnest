import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { Activity, Crown, Database, FolderKanban, Gauge, LayoutDashboard, Loader2, Lock, LogIn, RefreshCw, ShieldAlert, Users } from "lucide-react";
import { getAdminOverview, updateAdminSite, updateAdminUser, type AccountProfile, type AdminOverview } from "@/lib/api";
import { StudioSidebar } from "@/app/StudioSidebar";
import { ToastMessage } from "@/app/toast";
import { RouteMessage, StudioLoading } from "@/app/feedback";
import { formatBytes } from "@/app/deployment-view";
import { STUDIO_PATH } from "@/app/navigation";
import { STUDIO_CONTENT_SHELL_CLASS, STUDIO_EYEBROW_CLASS, STUDIO_HEADER_CLASS, STUDIO_MAIN_CLASS, STUDIO_PANEL_CLASS, STUDIO_SECONDARY_BUTTON_CLASS, STUDIO_TITLE_CLASS, STUDIO_SECTION_CLASS } from "@/app/ui";
import { cn } from "@/lib/utils";

type AdminTab = "overview" | "users" | "sites" | "reviews" | "audit";
const tabs = [
  { id: "overview", label: "概览", icon: Gauge },
  { id: "users", label: "用户", icon: Users },
  { id: "sites", label: "站点", icon: FolderKanban },
  { id: "reviews", label: "审核", icon: ShieldAlert },
  { id: "audit", label: "审计", icon: Activity },
] as const;
const siteStatusLabels: Record<string, string> = { draft: "草稿", active: "正常", pending_review: "待审核", blocked: "已封禁", deleted: "已删除" };
const fieldClass = "h-9 rounded-md border border-white/20 bg-black px-2 text-sm text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-white";

function dateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function AdminPage({ account, authReady, onNavigate, session }: { account: AccountProfile | null; authReady: boolean; onNavigate: (path: string) => void; session: Session | null }) {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [tab, setTab] = useState<AdminTab>("overview");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async (force = false) => {
    if (!session || account?.role !== "admin") return;
    setLoading(true);
    setError(null);
    try { setOverview(await getAdminOverview(force)); }
    catch (adminError) { setError(adminError instanceof Error ? adminError.message : "无法读取管理员数据"); }
    finally { setLoading(false); }
  }, [account?.role, session]);

  useEffect(() => { void load(); }, [load]);

  async function changeUser(userId: string, email: string, field: "role" | "plan", value: string) {
    if (!window.confirm(`确认修改 ${email} 的${field === "role" ? "角色" : "套餐"}？`)) return;
    setSavingId(userId); setError(null);
    try { await updateAdminUser(userId, { [field]: value }); await load(true); }
    catch (changeError) { setError(changeError instanceof Error ? changeError.message : "更新失败"); }
    finally { setSavingId(null); }
  }

  async function changeSite(siteId: string, name: string, status: "draft" | "active" | "pending_review" | "blocked") {
    if (!window.confirm(`确认将“${name}”调整为“${siteStatusLabels[status]}”？${status === "blocked" ? "公开访问将立即失效。" : ""}`)) return;
    setSavingId(siteId); setError(null);
    try { await updateAdminSite(siteId, status); await load(true); }
    catch (changeError) { setError(changeError instanceof Error ? changeError.message : "更新失败"); }
    finally { setSavingId(null); }
  }

  if (!authReady) return <StudioLoading account={account} active="admin" label="正在读取账号" onNavigate={onNavigate} />;
  if (!session) return <RouteMessage actionLabel="登录" icon={LogIn} message="管理员面板需要登录。" onAction={() => onNavigate("/auth")} title="登录后继续" />;
  if (account && account.role !== "admin") return <div className="min-h-dvh bg-black"><section className={STUDIO_SECTION_CLASS}><div className={STUDIO_CONTENT_SHELL_CLASS}><StudioSidebar account={account} active="admin" onNavigate={onNavigate} /><div className="flex min-h-[60dvh] items-center justify-center"><div className="max-w-xl"><Lock className="h-8 w-8 text-white" /><h1 className="mt-5 text-3xl font-bold text-white">需要管理员权限</h1><p className="mt-3 text-zinc-400">当前账号无权访问平台运营数据。</p></div></div></div></section></div>;

  const stats = overview ? [
    ["用户", overview.users, Users], ["站点", overview.sites, FolderKanban], ["公开域名", overview.domains, Database],
    ["部署", overview.deployments, Activity], ["待审核", overview.pendingReviewSites, ShieldAlert], ["已封禁", overview.blockedSites, Lock],
  ] as const : [];

  return <div className="min-h-dvh bg-black"><section className={STUDIO_SECTION_CLASS}><div className={STUDIO_CONTENT_SHELL_CLASS}>
    <StudioSidebar account={account} active="admin" onNavigate={onNavigate} />
    <main className={STUDIO_MAIN_CLASS}>
      <header className={STUDIO_HEADER_CLASS}><div><p className={STUDIO_EYEBROW_CLASS}><Crown className="h-4 w-4" />管理员</p><h1 className={STUDIO_TITLE_CLASS}>平台运营控制台</h1></div><div className="flex gap-2"><button className={STUDIO_SECONDARY_BUTTON_CLASS} disabled={loading} onClick={() => void load(true)} type="button"><RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />刷新</button><button className={STUDIO_SECONDARY_BUTTON_CLASS} onClick={() => onNavigate(STUDIO_PATH)} type="button"><LayoutDashboard className="h-4 w-4" />工作台</button></div></header>
      <nav aria-label="管理员视图" className="mt-5 flex gap-1 overflow-x-auto border-b border-white/15">{tabs.map((item) => { const Icon = item.icon; return <button aria-current={tab === item.id ? "page" : undefined} className={cn("flex h-11 shrink-0 cursor-pointer items-center gap-2 border-b-2 px-3 text-sm font-medium transition-colors", tab === item.id ? "border-white text-white" : "border-transparent text-zinc-500 hover:text-zinc-200")} key={item.id} onClick={() => setTab(item.id)} type="button"><Icon className="h-4 w-4" />{item.label}</button>; })}</nav>
      <ToastMessage message={error} />
      {loading && !overview ? <div className="mt-10 flex items-center justify-center gap-3 text-sm text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" />正在汇总平台数据</div> : null}
      {overview && tab === "overview" ? <div className="mt-5 space-y-5"><div className={cn(STUDIO_PANEL_CLASS, "grid overflow-hidden sm:grid-cols-2 xl:grid-cols-3")}>{stats.map(([label, value, Icon]) => <div className="border-b border-white/15 p-4 sm:border-r" key={label}><div className="flex items-center justify-between"><span className="text-sm text-zinc-500">{label}</span><Icon className="h-4 w-4 text-zinc-600" /></div><p className="mt-2 text-2xl font-semibold tabular-nums text-white">{value}</p></div>)}</div><div className="grid gap-4 lg:grid-cols-2"><div className={cn(STUDIO_PANEL_CLASS, "p-5")}><p className="text-sm text-zinc-500">有效部署占用</p><p className="mt-2 text-2xl font-semibold text-white">{formatBytes(overview.storageBytes)}</p><p className="mt-2 text-xs leading-5 text-zinc-600">来自数据库元数据汇总，不扫描 R2 对象。</p></div><div className={cn(STUDIO_PANEL_CLASS, "p-5")}><p className="text-sm text-zinc-500">运行策略</p><p className="mt-2 text-sm leading-6 text-zinc-300">按需刷新 · 单次汇总 · 最近 25 条 · 无自动轮询</p><p className="mt-2 text-xs text-zinc-600">管理页不会产生周期性 Worker、KV 或 R2 请求。</p></div></div></div> : null}
      {overview && tab === "users" ? <DataTable headers={["账号", "加入时间", "角色", "套餐"]}>{overview.recentUsers.map((user) => <tr className="border-b border-white/10 last:border-0" key={user.id}><Cell><span className="block max-w-64 truncate text-zinc-200">{user.email}</span><span className="text-xs text-zinc-600">{user.id.slice(0, 8)}</span></Cell><Cell>{dateTime(user.createdAt)}</Cell><Cell><select aria-label={`${user.email} 的角色`} className={fieldClass} disabled={savingId === user.id} onChange={(event) => void changeUser(user.id, user.email, "role", event.target.value)} value={user.role}><option value="user">用户</option><option value="admin">管理员</option></select></Cell><Cell><input aria-label={`${user.email} 的套餐`} className={cn(fieldClass, "w-28")} defaultValue={user.plan} disabled={savingId === user.id} key={`${user.id}-${user.plan}`} onBlur={(event) => { if (event.target.value !== user.plan) void changeUser(user.id, user.email, "plan", event.target.value); }} /></Cell></tr>)}</DataTable> : null}
      {overview && tab === "sites" ? <DataTable headers={["站点", "所有者", "更新时间", "状态"]}>{overview.recentSites.map((site) => <tr className="border-b border-white/10 last:border-0" key={site.id}><Cell><span className="block max-w-56 truncate text-zinc-200">{site.name}</span><span className="text-xs text-zinc-600">{site.id.slice(0, 8)}</span></Cell><Cell><span className="block max-w-52 truncate">{site.ownerEmail}</span></Cell><Cell>{dateTime(site.updatedAt)}</Cell><Cell><select aria-label={`${site.name} 的状态`} className={fieldClass} disabled={savingId === site.id} onChange={(event) => void changeSite(site.id, site.name, event.target.value as "draft" | "active" | "pending_review" | "blocked")} value={site.status}><option value="draft">草稿</option><option value="active">正常</option><option value="pending_review">待审核</option><option value="blocked">已封禁</option></select></Cell></tr>)}</DataTable> : null}
      {overview && tab === "reviews" ? <DataTable headers={["站点 / 版本", "风险", "文件", "体积", "提交时间"]}>{overview.reviewDeployments.map((deployment) => <tr className="border-b border-white/10 last:border-0" key={deployment.id}><Cell><span className="text-zinc-200">{deployment.siteName} · v{deployment.version}</span><span className="block text-xs text-zinc-600">{deployment.status === "blocked" ? "已拦截" : "待审核"}</span></Cell><Cell><span className={cn("font-medium tabular-nums", deployment.riskScore >= 70 ? "text-red-400" : "text-amber-300")}>{deployment.riskScore}</span></Cell><Cell>{deployment.fileCount}</Cell><Cell>{formatBytes(deployment.totalBytes)}</Cell><Cell>{dateTime(deployment.createdAt)}</Cell></tr>)}</DataTable> : null}
      {overview && tab === "audit" ? <DataTable headers={["事件", "说明", "风险", "时间"]}>{overview.auditEvents.map((event) => <tr className="border-b border-white/10 last:border-0" key={event.id}><Cell><code className="text-xs text-zinc-300">{event.eventType}</code></Cell><Cell><span className="block min-w-64 max-w-xl whitespace-normal leading-5">{event.message}</span></Cell><Cell>{event.riskScore}</Cell><Cell>{dateTime(event.createdAt)}</Cell></tr>)}</DataTable> : null}
    </main>
  </div></section></div>;
}

function DataTable({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return <div className={cn(STUDIO_PANEL_CLASS, "mt-5 overflow-x-auto")}><table className="w-full min-w-[760px] border-collapse text-left text-sm"><thead><tr className="border-b border-white/20 bg-white/[0.03]">{headers.map((header) => <th className="px-4 py-3 font-medium text-zinc-500" key={header}>{header}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;
}
function Cell({ children }: { children: React.ReactNode }) { return <td className="px-4 py-3 text-zinc-400">{children}</td>; }
