import { useCallback, useEffect, useMemo, useState, type InputHTMLAttributes } from "react";
import type { Session } from "@supabase/supabase-js";
import { normalizeHostname, platformDomainType } from "@qingnest/shared/config/domain";
import { Activity, Ban, Bell, CircleDollarSign, Crown, ExternalLink, FolderKanban, Gauge, Globe2, LayoutDashboard, Loader2, Lock, Plus, RefreshCw, RotateCcw, Save, Search, Send, ServerCog, ShieldAlert, Trash2, Users, WalletCards, X } from "lucide-react";
import { ConfirmDialog } from "@/app/ConfirmDialog";
import { RouteMessage, StudioLoading } from "@/app/feedback";
import { STUDIO_PATH } from "@/app/navigation";
import { StudioSidebar } from "@/app/StudioSidebar";
import { ToastMessage } from "@/app/toast";
import { STUDIO_CONTENT_SHELL_CLASS, STUDIO_EYEBROW_CLASS, STUDIO_HEADER_CLASS, STUDIO_MAIN_CLASS, STUDIO_SECONDARY_BUTTON_CLASS, STUDIO_SECTION_CLASS, STUDIO_TITLE_CLASS } from "@/app/ui";
import { checkSubdomain, createAdminDomain, createAdminDomainPrice, createAdminNotification, createAdminPrivatePreview, deleteAdminDomain, deleteAdminDomainPrice, getAdminCapacity, getAdminNotifications, getAdminOverview, syncAdminDomainPrice, updateAdminCapacity, updateAdminDomain, updateAdminDomainPrice, updateAdminPlan, updateAdminSite, updateAdminUser, type AccountProfile, type AdminDomainPrice, type AdminNotification, type AdminOverview, type AdminPlan, type CapacityDashboard, type CapacityMetricKey } from "@/lib/api";
import { clientPlatformConfig } from "@/lib/platform";
import { cn } from "@/lib/utils";

type AdminTab = "overview" | "capacity" | "users" | "projects" | "domains" | "plans" | "benefits" | "notifications" | "reviews" | "audit";
type PendingAction = {
  title: string;
  description: string;
  destructive?: boolean;
  confirmationText?: string;
  confirmLabel?: string;
  run: () => Promise<unknown>;
};
const tabs = [
  ["overview", "概览", Gauge],
  ["capacity", "容量", ServerCog],
  ["users", "用户", Users],
  ["projects", "项目", FolderKanban],
  ["domains", "域名", Globe2],
  ["plans", "套餐", CircleDollarSign],
  ["benefits", "权益", WalletCards],
  ["notifications", "通知", Bell],
  ["reviews", "审核", ShieldAlert],
  ["audit", "审计", Activity],
] as const;
const statusLabels: Record<string, string> = {
  draft: "草稿",
  active: "正常",
  pending_review: "待审核",
  blocked: "已封禁",
  deleted: "已删除",
};
const fieldClass = "h-10 w-full rounded-md border border-white/15 bg-zinc-950 px-3 text-sm text-zinc-200 outline-none transition-colors focus:border-white/40 disabled:cursor-not-allowed disabled:opacity-50 [&[type=number]]:appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";
const clearButtonClass = "absolute right-2 top-2 flex h-6 w-6 cursor-pointer items-center justify-center rounded text-zinc-500 transition-colors hover:bg-white/10 hover:text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60";
const selectClass = cn(fieldClass, "cursor-pointer border-white/20 bg-zinc-900 text-zinc-100 [color-scheme:dark] hover:border-white/35");
const quietButton = "inline-flex h-9 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium text-zinc-400 transition-colors hover:bg-white/[0.07] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60";
const saveButton = "inline-flex h-9 items-center justify-center gap-2 rounded-md bg-white px-3 text-sm font-semibold text-black transition-colors hover:bg-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-white";
const dangerButton = "inline-flex h-9 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium text-red-300 transition-colors hover:bg-red-500/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400";
const dateTime = (value: string) =>
  new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
const money = (cents: number) => `¥${(cents / 100).toFixed(2)}`;
const isValidNumber = (value: unknown) => (typeof value === "number" ? Number.isFinite(value) && value >= 0 : String(value ?? "").trim() !== "" && Number.isFinite(Number(value)) && Number(value) >= 0);
const numberError = "请输入不小于 0 的数字";

function ClearableInput({
  className,
  onChange,
  value,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "value"> & {
  value: string | number;
}) {
  const current = String(value);
  return (
    <div className="relative">
      <input {...props} className={cn(fieldClass, "pr-9", className)} onChange={onChange} value={current} />
      {current ? (
        <button
          aria-label={`清除${props["aria-label"] ?? "输入内容"}`}
          className={clearButtonClass}
          onClick={() =>
            onChange?.({
              target: { value: "" },
            } as React.ChangeEvent<HTMLInputElement>)
          }
          type="button"
        >
          <X className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}

function FieldError({ message, className }: { message?: string; className?: string }) {
  return message ? (
    <p aria-live="polite" className={cn("pt-0.5 text-[11px] leading-4 text-red-400", className)}>
      {message}
    </p>
  ) : null;
}

export function AdminPage({ account, authReady, onNavigate, session }: { account: AccountProfile | null; authReady: boolean; onNavigate: (path: string) => void; session: Session | null }) {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [tab, setTab] = useState<AdminTab>("overview");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [pendingError, setPendingError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [domainForm, setDomainForm] = useState({
    userId: "",
    prefix: "",
    suffix: "",
  });
  const [planDrafts, setPlanDrafts] = useState<Record<string, AdminPlan>>({});
  const [priceDrafts, setPriceDrafts] = useState<Record<string, AdminDomainPrice>>({});
  const [previewingSiteId, setPreviewingSiteId] = useState<string | null>(null);
  const [userQuery, setUserQuery] = useState("");
  const [projectQuery, setProjectQuery] = useState("");

  const load = useCallback(
    async (force = false) => {
      if (!session || account?.role !== "admin") return;
      setLoading(true);
      setError(null);
      try {
        const data = await getAdminOverview(force);
        setOverview(data);
        setPlanDrafts(Object.fromEntries(data.plans.map((item) => [item.key, item])));
        const platformPrices = data.domainPricing
          .filter((item) => item.domain_type !== "custom_domain")
          .map((item) => ({
            ...item,
            hostname_suffix: item.hostname_suffix || clientPlatformConfig.domains.distributionRoot,
          }));
        setPriceDrafts(Object.fromEntries(platformPrices.map((item) => [item.domain_type, item])));
        setDomainForm((current) => ({
          ...current,
          suffix: current.suffix || platformPrices.find((item) => item.enabled)?.hostname_suffix || clientPlatformConfig.domains.distributionRoot,
        }));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "无法读取管理员数据");
      } finally {
        setLoading(false);
      }
    },
    [account?.role, session],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const usersById = useMemo(() => new Map((overview?.recentUsers ?? []).map((user) => [user.id, user])), [overview]);
  const projectHostnames = useMemo(() => new Map((overview?.domainsList ?? []).filter((domain) => domain.siteId && domain.status === "active").map((domain) => [domain.siteId as string, domain.hostname])), [overview]);
  const filteredUsers = useMemo(() => (overview?.recentUsers ?? []).filter((user) => `${user.email} ${user.id} ${user.role} ${user.plan}`.toLowerCase().includes(userQuery.trim().toLowerCase())), [overview, userQuery]);
  const filteredProjects = useMemo(() => (overview?.recentSites ?? []).filter((site) => `${site.name} ${site.ownerEmail} ${site.id}`.toLowerCase().includes(projectQuery.trim().toLowerCase())), [overview, projectQuery]);

  function changeTab(nextTab: AdminTab) {
    if (nextTab === tab) return;
    if (overview) {
      setPlanDrafts(Object.fromEntries(overview.plans.map((item) => [item.key, item])));
      const platformPrices = overview.domainPricing
        .filter((item) => item.domain_type !== "custom_domain")
        .map((item) => ({
          ...item,
          hostname_suffix: item.hostname_suffix || clientPlatformConfig.domains.distributionRoot,
        }));
      setPriceDrafts(Object.fromEntries(platformPrices.map((item) => [item.domain_type, item])));
      setDomainForm({
        userId: "",
        prefix: "",
        suffix: platformPrices.find((item) => item.enabled)?.hostname_suffix || clientPlatformConfig.domains.distributionRoot,
      });
    }
    setTab(nextTab);
  }

  function confirm(action: PendingAction) {
    setPendingError(null);
    setPending(action);
  }
  async function execute() {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      await pending.run();
      setPending(null);
      await load(true);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "操作失败";
      setPendingError(message);
      setError(message);
    } finally {
      setBusy(false);
    }
  }
  function changeUser(userId: string, email: string, field: "role" | "plan", value: string) {
    confirm({
      title: field === "role" ? "确认修改用户角色" : "确认修改用户套餐",
      description: `将 ${email} 的${field === "role" ? "角色" : "套餐"}修改为 ${value}。该操作会立即影响权限或配额。`,
      destructive: field === "role" && value === "user",
      run: () => updateAdminUser(userId, { [field]: value }),
    });
  }
  function changeStatus(kind: "项目" | "域名", id: string, name: string, current: string) {
    const blocked = current !== "blocked";
    confirm({
      title: blocked ? `封禁${kind}` : `解除${kind}封禁`,
      description: blocked ? `封禁“${name}”后将立即停止公开访问。` : `解除“${name}”的封禁并恢复正常状态。`,
      destructive: blocked,
      confirmLabel: blocked ? "确认封禁" : "确认解封",
      run: () => (kind === "项目" ? updateAdminSite(id, blocked ? "blocked" : "active") : updateAdminDomain(id, { status: blocked ? "blocked" : "active" })),
    });
  }

  async function previewSite(siteId: string) {
    const previewWindow = window.open("", "_blank");
    if (previewWindow) previewWindow.opener = null;
    setPreviewingSiteId(siteId);
    setError(null);
    try {
      const preview = await createAdminPrivatePreview(siteId);
      if (previewWindow) previewWindow.location.replace(preview.url);
      else window.location.assign(preview.url);
    } catch (cause) {
      previewWindow?.close();
      setError(cause instanceof Error ? cause.message : "无法创建临时预览");
    } finally {
      setPreviewingSiteId(null);
    }
  }

  if (!authReady) return <StudioLoading account={account} active="admin" label="正在读取账号" onNavigate={onNavigate} />;
  if (!session) return <RouteMessage actionLabel="登录" icon={Lock} message="管理员面板需要登录。" onAction={() => onNavigate("/auth")} title="登录后继续" />;
  if (account?.role !== "admin") return <RouteMessage actionLabel="返回工作台" icon={Lock} message="当前账号无权访问平台运营数据。" onAction={() => onNavigate(STUDIO_PATH)} title="需要管理员权限" />;

  return (
    <div className="min-h-dvh bg-black">
      <section className={STUDIO_SECTION_CLASS}>
        <div className={STUDIO_CONTENT_SHELL_CLASS}>
          <StudioSidebar account={account} active="admin" onNavigate={onNavigate} />
          <main className={STUDIO_MAIN_CLASS}>
            <header className={STUDIO_HEADER_CLASS}>
              <div>
                <p className={STUDIO_EYEBROW_CLASS}>
                  <Crown className="h-4 w-4" />
                  管理员
                </p>
                <h1 className={STUDIO_TITLE_CLASS}>平台运营控制台</h1>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className={STUDIO_SECONDARY_BUTTON_CLASS} disabled={loading} onClick={() => void load(true)} title="重新读取数据库中的运营汇总、域名、套餐和定价；不会同步 Cloudflare 配置" type="button">
                  <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                  同步数据
                </button>
                <button className={STUDIO_SECONDARY_BUTTON_CLASS} onClick={() => onNavigate(STUDIO_PATH)} type="button">
                  <LayoutDashboard className="h-4 w-4" />
                  工作台
                </button>
              </div>
            </header>
            <nav aria-label="管理员视图" className="mt-5 flex gap-1 overflow-x-auto border-b border-white/15">
              {tabs.map(([id, label, Icon]) => (
                <button aria-current={tab === id ? "page" : undefined} className={cn("flex h-11 shrink-0 cursor-pointer items-center gap-2 border-b-2 px-3 text-sm font-medium transition-colors", tab === id ? "border-white text-white" : "border-transparent text-zinc-500 hover:text-zinc-200")} key={id} onClick={() => changeTab(id)} type="button">
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              ))}
            </nav>
            <ToastMessage message={error} />
            {loading && !overview ? (
              <div className="mt-10 flex justify-center gap-2 text-sm text-zinc-400">
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                正在汇总平台数据
              </div>
            ) : null}
            {overview && tab === "overview" ? <Overview data={overview} /> : null}
            {overview && tab === "capacity" ? <CapacityPanel /> : null}
            {overview && tab === "users" ? (
              <>
                <SearchField label="筛选用户" onChange={setUserQuery} placeholder="搜索邮箱、用户 ID、角色或套餐" value={userQuery} />
                <DataTable headers={["账号", "加入时间", "角色", "套餐"]}>
                  {filteredUsers.map((user) => (
                    <tr className="border-b border-white/10 last:border-0" key={user.id}>
                      <Cell>
                        <span className="block max-w-64 truncate text-zinc-200">{user.email}</span>
                        <span className="text-xs text-zinc-600">{user.id}</span>
                      </Cell>
                      <Cell>{dateTime(user.createdAt)}</Cell>
                      <Cell>
                        <select aria-label={`${user.email} 的角色`} className={selectClass} onChange={(e) => changeUser(user.id, user.email, "role", e.target.value)} value={user.role}>
                          <option value="user">用户</option>
                          <option value="admin">管理员</option>
                        </select>
                      </Cell>
                      <Cell>
                        <select aria-label={`${user.email} 的套餐`} className={selectClass} onChange={(e) => changeUser(user.id, user.email, "plan", e.target.value)} value={user.plan}>
                          {overview.plans
                            .filter((plan) => plan.enabled || plan.key === user.plan)
                            .map((plan) => (
                              <option key={plan.key} value={plan.key}>
                                {plan.label}
                              </option>
                            ))}
                        </select>
                      </Cell>
                    </tr>
                  ))}
                </DataTable>
              </>
            ) : null}
            {overview && tab === "projects" ? (
              <>
                <SearchField label="筛选项目" onChange={setProjectQuery} placeholder="搜索项目名称、所有者或项目 ID" value={projectQuery} />
                <DataTable headers={["项目", "所有者", "更新时间", "状态", "操作"]}>
                  {filteredProjects.map((site) => {
                    const hostname = projectHostnames.get(site.id);
                    return (
                      <tr className="border-b border-white/10 last:border-0" key={site.id}>
                        <Cell>
                          <span className="text-zinc-200">{site.name}</span>
                          <span className="block text-xs text-zinc-600">{site.id}</span>
                        </Cell>
                        <Cell>{site.ownerEmail}</Cell>
                        <Cell>{dateTime(site.updatedAt)}</Cell>
                        <Cell>
                          <StatusBadge status={site.status} />
                        </Cell>
                        <Cell className="w-52">
                          <div className="flex min-w-[12rem] items-center justify-start gap-1">
                            {hostname ? (
                              <a className={cn(quietButton, "w-24")} href={`${clientPlatformConfig.domains.publicProtocol}://${hostname}`} rel="noreferrer" target="_blank">
                                <ExternalLink className="h-4 w-4 shrink-0" />
                                访问
                              </a>
                            ) : (
                              <button className={cn(quietButton, "w-24 shrink-0 whitespace-nowrap")} disabled={previewingSiteId === site.id || site.status === "blocked"} onClick={() => void previewSite(site.id)} title="创建 10 分钟有效的管理员临时预览，不分配公开域名" type="button">
                                {previewingSiteId === site.id ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : <ExternalLink className="h-4 w-4 shrink-0" />}
                                临时预览
                              </button>
                            )}
                            <StatusAction current={site.status} label={site.name} onClick={() => changeStatus("项目", site.id, site.name, site.status)} />
                          </div>
                        </Cell>
                      </tr>
                    );
                  })}
                </DataTable>
              </>
            ) : null}
            {overview && tab === "domains" ? <DomainsPanel data={overview} domainForm={domainForm} priceDrafts={priceDrafts} setDomainForm={setDomainForm} setPriceDrafts={setPriceDrafts} usersById={usersById} confirm={confirm} changeStatus={changeStatus} /> : null}
            {overview && tab === "plans" ? <PlansPanel plans={overview.plans} drafts={planDrafts} setDrafts={setPlanDrafts} confirm={confirm} /> : null}
            {overview && tab === "benefits" ? <BenefitsPanel plans={overview.plans} drafts={planDrafts} setDrafts={setPlanDrafts} confirm={confirm} /> : null}
            {overview && tab === "notifications" ? <NotificationsPanel /> : null}
            {overview && tab === "reviews" ? (
              <DataTable headers={["项目 / 版本", "风险", "文件", "体积", "提交时间"]}>
                {overview.reviewDeployments.map((item) => (
                  <tr className="border-b border-white/10 last:border-0" key={item.id}>
                    <Cell>
                      {item.siteName} · v{item.version}
                    </Cell>
                    <Cell>{item.riskScore}</Cell>
                    <Cell>{item.fileCount}</Cell>
                    <Cell>{Math.round(item.totalBytes / 1024)} KB</Cell>
                    <Cell>{dateTime(item.createdAt)}</Cell>
                  </tr>
                ))}
              </DataTable>
            ) : null}
            {overview && tab === "audit" ? (
              <DataTable headers={["事件", "说明", "风险", "时间"]}>
                {overview.auditEvents.map((item) => (
                  <tr className="border-b border-white/10 last:border-0" key={item.id}>
                    <Cell>
                      <code>{item.eventType}</code>
                    </Cell>
                    <Cell>{item.message}</Cell>
                    <Cell>{item.riskScore}</Cell>
                    <Cell>{dateTime(item.createdAt)}</Cell>
                  </tr>
                ))}
              </DataTable>
            ) : null}
          </main>
          <ConfirmDialog busy={busy} confirmLabel={pending?.confirmLabel} confirmationText={pending?.confirmationText} description={pending?.description ?? ""} destructive={pending?.destructive} error={pendingError} onCancel={() => !busy && setPending(null)} onConfirm={() => void execute()} open={Boolean(pending)} title={pending?.title ?? "确认操作"} />
        </div>
      </section>
    </div>
  );
}

function Overview({ data }: { data: AdminOverview }) {
  const stats = [
    ["用户", data.users],
    ["今日注册", data.todayUsers],
    ["项目", data.sites],
    ["平台域名", data.domains],
    ["部署", data.deployments],
    ["待审核", data.pendingReviewSites],
    ["已封禁", data.blockedSites],
  ];
  return (
    <div className="mt-5 grid gap-x-8 gap-y-6 border-y border-white/15 py-5 sm:grid-cols-2 xl:grid-cols-4">
      {stats.map(([label, value]) => (
        <div key={label}>
          <span className="text-sm text-zinc-500">{label}</span>
          <p className="mt-1 text-2xl font-semibold text-white">{value}</p>
        </div>
      ))}
    </div>
  );
}

const capacityMetricMeta = {
  workerRequests: { label: "Worker 请求", unit: "次/月", measured: false },
  kvReads: { label: "KV 读取", unit: "次/月", measured: false },
  kvWrites: { label: "KV 写入", unit: "次/月", measured: false },
  r2StorageBytes: { label: "R2 内容体积", unit: "字节", measured: true },
  r2ClassA: { label: "R2 写操作估算", unit: "次/月", measured: true },
  r2ClassB: { label: "R2 读操作", unit: "次/月", measured: false },
  pagesDeployments: { label: "Pages 部署", unit: "次/月", measured: true },
  pagesProjects: { label: "Pages 项目", unit: "个", measured: true },
  resendEmailsDaily: {
    label: "Resend 邮件（日）",
    unit: "封/日",
    measured: true,
  },
  resendEmailsMonthly: {
    label: "Resend 邮件（月）",
    unit: "封/月",
    measured: true,
  },
} as Record<CapacityMetricKey, { label: string; unit: string; measured: boolean }>;
Object.assign(capacityMetricMeta, {
  cloudflareApiRequests: {
    label: "Cloudflare API 请求",
    unit: "次/月",
    measured: true,
  },
  cloudflareApiFailures: {
    label: "Cloudflare API 失败",
    unit: "次/月",
    measured: true,
  },
});
const compactNumber = (value: number) =>
  new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: 1,
    notation: value >= 10_000 ? "compact" : "standard",
  }).format(value);
const formatCapacityValue = (key: CapacityMetricKey, value: number) => (key === "r2StorageBytes" ? `${(value / 1024 / 1024 / 1024).toFixed(2)} GB` : compactNumber(value));

function CapacityPanel() {
  const [data, setData] = useState<CapacityDashboard | null>(null);
  const [draft, setDraft] = useState<CapacityDashboard["settings"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const next = await getAdminCapacity(force);
      setData(next);
      setDraft(next.settings);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法读取容量数据");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  if (loading && !data)
    return (
      <div className="mt-10 flex items-center justify-center gap-2 text-sm text-zinc-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        正在读取容量状态
      </div>
    );
  if (!data || !draft) return <ToastMessage message={error ?? "容量状态不可用"} />;
  const applyPreset = (stage: string) => {
    const preset = data.presets[stage];
    if (!preset) return;
    setDraft((current) =>
      current
        ? {
            ...current,
            stage: stage as CapacityDashboard["settings"]["stage"],
            limits: {
              ...preset.limits,
              resendEmailsDaily: current.limits.resendEmailsDaily,
              resendEmailsMonthly: current.limits.resendEmailsMonthly,
            },
            thresholds: {
              ...structuredClone(preset.thresholds),
              resendEmailsDaily: current.thresholds.resendEmailsDaily,
              resendEmailsMonthly: current.thresholds.resendEmailsMonthly,
            },
          }
        : current,
    );
  };
  const applyResendPlan = (resendPlan: CapacityDashboard["settings"]["resendPlan"]) => {
    const preset = data.resendPresets[resendPlan];
    setDraft((current) =>
      current
        ? {
            ...current,
            resendPlan,
            limits: { ...current.limits, ...preset.limits },
          }
        : current,
    );
  };
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const next = await updateAdminCapacity(draft);
      setData(next);
      setDraft(next.settings);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="mt-5">
      <div className="flex flex-col gap-4 border-b border-white/15 pb-5 lg:flex-row lg:items-end lg:justify-between">
        <SectionHeading title="基础设施容量与预警" description="仅管理员可见。容量数据缓存 2 小时，只有缓存过期或主动刷新才重新读取；修改草稿会立即重算比例，保存时仅写入一次。" />
        <div className="flex flex-wrap gap-2">
          {Object.entries(data.presets).map(([key, preset]) => (
            <button className={cn(quietButton, draft.stage === key && "bg-white/10 text-white")} key={key} onClick={() => applyPreset(key)} type="button">
              {preset.label}
            </button>
          ))}
          <button className={saveButton} disabled={saving} onClick={() => void save()} type="button">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            保存设置
          </button>
          <button aria-label="刷新容量状态" className={quietButton} disabled={loading} onClick={() => void load(true)} title="忽略 2 小时缓存并立即刷新" type="button">
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </button>
        </div>
      </div>
      <ToastMessage message={error} />
      <div className="grid gap-4 border-b border-white/15 py-5 md:grid-cols-3">
        <label className="grid gap-1 text-xs text-zinc-500">
          Resend 套餐
          <select className={selectClass} onChange={(e) => applyResendPlan(e.target.value as CapacityDashboard["settings"]["resendPlan"])} value={draft.resendPlan}>
            {Object.entries(data.resendPresets).map(([key, preset]) => (
              <option key={key} value={key}>
                {preset.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-zinc-500">
          管理员提醒冷却（小时）
          <input
            className={fieldClass}
            max={720}
            min={1}
            onChange={(e) =>
              setDraft({
                ...draft,
                notificationCooldownHours: Number(e.target.value),
              })
            }
            type="number"
            value={draft.notificationCooldownHours}
          />
        </label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1040px] text-left text-sm">
          <thead>
            <tr className="border-b border-white/15 text-zinc-500">
              <th className="px-3 py-3 font-medium">资源</th>
              <th className="px-3 py-3 font-medium">已用</th>
              <th className="px-3 py-3 font-medium">当前额度</th>
              <th className="px-3 py-3 font-medium">提醒阈值</th>
              <th className="px-3 py-3 font-medium">严重阈值</th>
              <th className="px-3 py-3 font-medium">使用率</th>
              <th className="px-3 py-3 font-medium">状态</th>
            </tr>
          </thead>
          <tbody>
            {(Object.keys(capacityMetricMeta) as CapacityMetricKey[]).map((key) => {
              const used = data.observed[key];
              const limit = draft.limits[key];
              const threshold = draft.thresholds[key];
              const unlimited = limit === 0;
              const percent = limit > 0 ? Math.min(999, (used / limit) * 100) : 0;
              const severity = !unlimited && percent >= threshold.criticalPercent ? "critical" : !unlimited && percent >= threshold.warningPercent ? "warning" : "normal";
              const setThreshold = (field: "warningPercent" | "criticalPercent", value: number) =>
                setDraft({
                  ...draft,
                  thresholds: {
                    ...draft.thresholds,
                    [key]: { ...threshold, [field]: value },
                  },
                });
              return (
                <tr className="border-b border-white/10 last:border-0" key={key}>
                  <Cell>
                    <span className="text-zinc-200">{capacityMetricMeta[key].label}</span>
                    <span className="block text-xs text-zinc-600">
                      {capacityMetricMeta[key].unit}
                      {capacityMetricMeta[key].measured ? " · 平台记录" : " · 待接账单采样"}
                    </span>
                  </Cell>
                  <Cell>{formatCapacityValue(key, used)}</Cell>
                  <Cell>
                    <span className="tabular-nums text-zinc-300">{unlimited ? "不限" : formatCapacityValue(key, limit)}</span>
                    <span className="block text-xs text-zinc-600">随版本自动确定</span>
                  </Cell>
                  <Cell>{unlimited ? <span className="text-zinc-600">不适用</span> : <input aria-label={`${capacityMetricMeta[key].label}提醒阈值`} className={cn(fieldClass, "w-24")} max={99} min={1} onChange={(e) => setThreshold("warningPercent", Number(e.target.value))} type="number" value={threshold.warningPercent} />}</Cell>
                  <Cell>{unlimited ? <span className="text-zinc-600">不适用</span> : <input aria-label={`${capacityMetricMeta[key].label}严重阈值`} className={cn(fieldClass, "w-24")} max={100} min={2} onChange={(e) => setThreshold("criticalPercent", Number(e.target.value))} type="number" value={threshold.criticalPercent} />}</Cell>
                  <Cell>
                    <div className="flex items-center gap-3">
                      <div className="h-2 w-36 overflow-hidden rounded-full bg-zinc-800">
                        <div className={cn("h-full transition-[width] duration-200", severity === "critical" ? "bg-red-400" : severity === "warning" ? "bg-amber-400" : "bg-emerald-400")} style={{ width: `${Math.min(100, percent)}%` }} />
                      </div>
                      <span className="w-16 tabular-nums text-zinc-300">{unlimited ? "不限" : `${percent.toFixed(1)}%`}</span>
                    </div>
                  </Cell>
                  <Cell>
                    <span className={severity === "critical" ? "text-red-300" : severity === "warning" ? "text-amber-300" : "text-emerald-300"}>{severity === "critical" ? "严重" : severity === "warning" ? "提醒" : "正常"}</span>
                  </Cell>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-5 grid gap-4 border-y border-white/15 py-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <span className="text-zinc-500">Cloudflare 阶段</span>
          <p className="mt-1 text-zinc-200">{data.presets[draft.stage]?.label}</p>
        </div>
        <div>
          <span className="text-zinc-500">Resend 套餐</span>
          <p className="mt-1 text-zinc-200">{data.resendPresets[draft.resendPlan]?.label}</p>
        </div>
        <div>
          <span className="text-zinc-500">正在加速</span>
          <p className="mt-1 text-zinc-200">{data.acceleratedSites} 个站点</p>
        </div>
        <div>
          <span className="text-zinc-500">采样时间</span>
          <p className="mt-1 text-zinc-200">{dateTime(data.sampledAt)}</p>
        </div>
      </div>
      <p className="mt-3 text-xs leading-5 text-zinc-500">{data.scopeNote} 自动提醒将写入管理员审计链路，绝不复用用户通知中心。</p>
    </section>
  );
}

function NotificationsPanel() {
  const [items, setItems] = useState<AdminNotification[]>([]);
  const [audience, setAudience] = useState<"all" | "user">("all");
  const [recipient, setRecipient] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setItems(await getAdminNotifications());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法读取通知");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function send() {
    setBusy(true);
    setError(null);
    try {
      const created = await createAdminNotification({
        title,
        body,
        audience,
        recipient: audience === "user" ? recipient : undefined,
      });
      setItems((current) => [created, ...current]);
      setTitle("");
      setBody("");
      setRecipient("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "发送失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mt-5">
      <SectionHeading title="发送通知" description="全平台公告会弹给所有用户；定向通知仅发送给指定账号。用户确认后仍可在通知中心回看。" />
      <div className="mt-4 border-y border-white/15 py-5">
        <div aria-label="发送范围" className="inline-flex rounded-md bg-zinc-900 p-1" role="tablist">
          <button aria-selected={audience === "all"} className={cn("h-9 rounded px-4 text-sm font-medium", audience === "all" ? "bg-white text-black" : "text-zinc-400")} onClick={() => setAudience("all")} role="tab" type="button">
            全平台
          </button>
          <button aria-selected={audience === "user"} className={cn("h-9 rounded px-4 text-sm font-medium", audience === "user" ? "bg-white text-black" : "text-zinc-400")} onClick={() => setAudience("user")} role="tab" type="button">
            指定用户
          </button>
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {audience === "user" ? (
            <label className="grid gap-1 text-xs text-zinc-500 lg:col-span-2">
              用户邮箱或 ID
              <ClearableInput aria-label="用户邮箱或 ID" onChange={(event) => setRecipient(event.target.value)} placeholder="user@example.com" value={recipient} />
            </label>
          ) : null}
          <label className="grid gap-1 text-xs text-zinc-500 lg:col-span-2">
            标题
            <ClearableInput aria-label="通知标题" maxLength={120} onChange={(event) => setTitle(event.target.value)} placeholder="例如：服务维护通知" value={title} />
          </label>
          <label className="grid gap-1 text-xs text-zinc-500 lg:col-span-2">
            正文
            <textarea aria-label="通知正文" className={cn(fieldClass, "h-32 resize-y py-3 leading-6")} maxLength={4000} onChange={(event) => setBody(event.target.value)} placeholder="填写需要用户确认收到的内容" value={body} />
          </label>
        </div>
        {error ? (
          <p className="mt-3 text-sm text-red-300" role="alert">
            {error}
          </p>
        ) : null}
        <button className={cn(saveButton, "mt-4")} disabled={busy || !title.trim() || !body.trim() || (audience === "user" && !recipient.trim())} onClick={() => void send()} type="button">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          发送通知
        </button>
      </div>
      <div className="mt-7">
        <SectionHeading title="发送记录" description="最近 100 条通知，按发送时间倒序排列。" />
        <DataTable headers={["标题", "范围", "正文", "发送时间"]}>
          {items.map((item) => (
            <tr className="border-b border-white/10 last:border-0" key={item.id}>
              <Cell>
                <span className="font-medium text-zinc-200">{item.title}</span>
                <span className="mt-1 block text-xs text-zinc-600">由 {item.createdByEmail || "管理员"} 发送</span>
              </Cell>
              <Cell>{item.audience === "all" ? "全平台" : (item.recipientEmail ?? "指定用户")}</Cell>
              <Cell>
                <span className="block max-w-md whitespace-pre-wrap text-zinc-400">{item.body}</span>
              </Cell>
              <Cell>{dateTime(item.createdAt)}</Cell>
            </tr>
          ))}
        </DataTable>
      </div>
    </section>
  );
}

function PlansPanel({ plans, drafts, setDrafts, confirm }: { plans: AdminPlan[]; drafts: Record<string, AdminPlan>; setDrafts: React.Dispatch<React.SetStateAction<Record<string, AdminPlan>>>; confirm: (action: PendingAction) => void }) {
  const [prices, setPrices] = useState(() =>
    Object.fromEntries(
      plans.map((plan) => [
        plan.key,
        {
          monthly: String(plan.monthly_price_cents / 100),
          renewal: String(plan.renewal_price_cents / 100),
        },
      ]),
    ),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  function save(original: AdminPlan, draft: AdminPlan) {
    const values = prices[original.key];
    const nextErrors: Record<string, string> = {};
    if (!isValidNumber(values.monthly)) nextErrors[`${original.key}.monthly`] = numberError;
    if (!isValidNumber(values.renewal)) nextErrors[`${original.key}.renewal`] = numberError;
    setErrors((current) => ({ ...current, ...nextErrors }));
    if (Object.keys(nextErrors).length) return;
    const payload = {
      ...draft,
      monthly_price_cents: Math.round(Number(values.monthly) * 100),
      renewal_price_cents: Math.round(Number(values.renewal) * 100),
    };
    confirm({
      title: "保存套餐定价",
      description: `保存“${draft.label}”的普通月价 ${money(payload.monthly_price_cents)}、续费价 ${money(payload.renewal_price_cents)} 和上架状态。`,
      run: () => updateAdminPlan(original.key, payload),
    });
  }
  return (
    <section className="mt-5">
      <SectionHeading title="套餐定价" description="这里只管理套餐名称、售价和上下架；修改状态后需要点击右侧“保存”。" />
      <div className="mt-4 overflow-x-auto border-y border-white/15">
        <table className="w-full min-w-[680px] text-left text-sm">
          <thead>
            <tr className="border-b border-white/15 text-zinc-500">
              <th className="px-3 py-3 font-medium">套餐</th>
              <th className="px-3 py-3 font-medium">普通月价（元）</th>
              <th className="px-3 py-3 font-medium">续费价（元）</th>
              <th className="px-3 py-3 font-medium">状态</th>
              <th className="px-3 py-3 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {plans.map((original) => {
              const draft = drafts[original.key] ?? original;
              const values = prices[original.key];
              return (
                <tr className="border-b border-white/10 last:border-0" key={original.key}>
                  <Cell>
                    <ClearableInput
                      aria-label={`${original.label} 套餐名称`}
                      onChange={(e) =>
                        setDrafts((all) => ({
                          ...all,
                          [original.key]: { ...draft, label: e.target.value },
                        }))
                      }
                      value={draft.label}
                    />
                    <FieldError />
                  </Cell>
                  <Cell>
                    <ClearableInput
                      aria-label={`${original.label} 月价`}
                      inputMode="decimal"
                      onChange={(e) => {
                        setPrices((all) => ({
                          ...all,
                          [original.key]: {
                            ...values,
                            monthly: e.target.value,
                          },
                        }));
                        setErrors((all) => ({
                          ...all,
                          [`${original.key}.monthly`]: "",
                        }));
                      }}
                      value={values.monthly}
                    />
                    <FieldError message={errors[`${original.key}.monthly`]} />
                  </Cell>
                  <Cell>
                    <ClearableInput
                      aria-label={`${original.label} 续费价`}
                      inputMode="decimal"
                      onChange={(e) => {
                        setPrices((all) => ({
                          ...all,
                          [original.key]: {
                            ...values,
                            renewal: e.target.value,
                          },
                        }));
                        setErrors((all) => ({
                          ...all,
                          [`${original.key}.renewal`]: "",
                        }));
                      }}
                      value={values.renewal}
                    />
                    <FieldError message={errors[`${original.key}.renewal`]} />
                  </Cell>
                  <Cell>
                    <Toggle
                      checked={draft.enabled}
                      label={draft.enabled ? "已启用" : "已停用"}
                      onChange={(checked) =>
                        setDrafts((all) => ({
                          ...all,
                          [original.key]: { ...draft, enabled: checked },
                        }))
                      }
                    />
                  </Cell>
                  <Cell className="text-right">
                    <button className={saveButton} onClick={() => save(original, draft)} type="button">
                      <Save className="h-4 w-4" />
                      保存
                    </button>
                  </Cell>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function BenefitsPanel({ plans, drafts, setDrafts, confirm }: { plans: AdminPlan[]; drafts: Record<string, AdminPlan>; setDrafts: React.Dispatch<React.SetStateAction<Record<string, AdminPlan>>>; confirm: (action: PendingAction) => void }) {
  const quotas: Array<[keyof AdminPlan, string, (value: number) => string, (value: string) => number]> = [
    ["max_sites", "项目数", String, Number],
    ["max_public_sites", "公开项目", String, Number],
    ["max_storage_bytes", "存储空间（MB）", (v) => String(Math.round(v / 1024 / 1024)), (v) => Number(v) * 1024 * 1024],
    ["max_deployments_per_day", "每日部署", String, Number],
    ["max_domains_per_site", "单项目域名", String, Number],
    ["max_files", "单次部署文件数", String, Number],
  ];
  const capabilities: Array<[keyof AdminPlan, string]> = [
    ["password_protection", "密码保护"],
    ["access_analytics", "访问统计"],
    ["remove_branding", "移除品牌"],
    ["rollback", "版本回滚"],
    ["source_build", "源码构建"],
  ];
  const [values, setValues] = useState(() => Object.fromEntries(plans.flatMap((plan) => quotas.map(([key, , format]) => [`${plan.key}.${key}`, format(plan[key] as number)]))));
  const [errors, setErrors] = useState<Record<string, string>>({});
  function save(plan: AdminPlan, draft: AdminPlan) {
    const invalid = quotas.filter(([key]) => !isValidNumber(values[`${plan.key}.${key}`]));
    if (invalid.length) {
      setErrors((current) => ({
        ...current,
        ...Object.fromEntries(invalid.map(([key]) => [`${plan.key}.${key}`, numberError])),
      }));
      return;
    }
    const numeric = Object.fromEntries(quotas.map(([key, , , parse]) => [key, parse(values[`${plan.key}.${key}`])]));
    confirm({
      title: "保存等级权益",
      description: `保存“${draft.label}”的资源配额和功能权益。`,
      run: () =>
        updateAdminPlan(plan.key, {
          ...draft,
          ...numeric,
          custom_domain: false,
        }),
    });
  }
  return (
    <section className="mt-5">
      <SectionHeading title="等级权益" description="按等级横向对照资源配额和功能。平台暂不开放用户自有域名接入。" />
      <div className="mt-4 overflow-x-auto border-y border-white/15">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-white/15">
              <th className="w-48 px-3 py-3 text-left font-medium text-zinc-500">权益项目</th>
              {plans.map((plan) => (
                <th className="px-3 py-3 text-left font-semibold text-zinc-200" key={plan.key}>
                  {plan.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {quotas.map(([key, label]) => (
              <tr className="border-b border-white/10" key={key}>
                <Cell>{label}</Cell>
                {plans.map((plan) => {
                  const id = `${plan.key}.${key}`;
                  return (
                    <Cell key={plan.key}>
                      <ClearableInput
                        aria-label={`${plan.label} ${label}`}
                        inputMode="numeric"
                        onChange={(e) => {
                          setValues((all) => ({
                            ...all,
                            [id]: e.target.value,
                          }));
                          setErrors((all) => ({ ...all, [id]: "" }));
                        }}
                        value={values[id]}
                      />
                      <FieldError message={errors[id]} />
                    </Cell>
                  );
                })}
              </tr>
            ))}
            {capabilities.map(([key, label]) => (
              <tr className="border-b border-white/10" key={key}>
                <Cell>{label}</Cell>
                {plans.map((plan) => {
                  const draft = drafts[plan.key] ?? plan;
                  return (
                    <Cell key={plan.key}>
                      <Toggle
                        checked={draft[key] as boolean}
                        label={draft[key] ? "包含" : "不包含"}
                        onChange={(checked) =>
                          setDrafts((all) => ({
                            ...all,
                            [plan.key]: { ...draft, [key]: checked },
                          }))
                        }
                      />
                    </Cell>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              {<td className="px-3 py-4 text-xs text-zinc-600">保存后立即影响对应等级</td>}
              {plans.map((plan) => {
                const draft = drafts[plan.key] ?? plan;
                return (
                  <td className="px-3 py-4" key={plan.key}>
                    <button className={saveButton} onClick={() => save(plan, draft)} type="button">
                      <Save className="h-4 w-4" />
                      保存权益
                    </button>
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

function DomainsPanel({ data, domainForm, priceDrafts, setDomainForm, setPriceDrafts, usersById, confirm, changeStatus }: { data: AdminOverview; domainForm: { userId: string; prefix: string; suffix: string }; priceDrafts: Record<string, AdminDomainPrice>; setDomainForm: React.Dispatch<React.SetStateAction<{ userId: string; prefix: string; suffix: string }>>; setPriceDrafts: React.Dispatch<React.SetStateAction<Record<string, AdminDomainPrice>>>; usersById: Map<string, AdminOverview["recentUsers"][number]>; confirm: (action: PendingAction) => void; changeStatus: (kind: "项目" | "域名", id: string, name: string, current: string) => void }) {
  const [newSuffix, setNewSuffix] = useState("");
  const [newPrice, setNewPrice] = useState("9.90");
  const [newBillingPeriod, setNewBillingPeriod] = useState<AdminDomainPrice["billing_period"]>("year");
  const [domainQuery, setDomainQuery] = useState("");
  const [availability, setAvailability] = useState<Awaited<ReturnType<typeof checkSubdomain>> | null>(null);
  const [checkingPrefix, setCheckingPrefix] = useState(false);
  const [domainView, setDomainView] = useState<"pricing" | "assignment">("assignment");
  const [priceValues, setPriceValues] = useState(() => Object.fromEntries(Object.values(priceDrafts).map((item) => [item.domain_type, String(item.price_cents / 100)])));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const enabledSuffixes = Object.values(priceDrafts).filter((item) => item.enabled);
  useEffect(() => {
    const prefix = domainForm.prefix.trim().toLowerCase();
    if (!prefix || !domainForm.suffix || !enabledSuffixes.some((item) => item.hostname_suffix === domainForm.suffix)) {
      setAvailability(null);
      setCheckingPrefix(false);
      return;
    }
    let cancelled = false;
    setCheckingPrefix(true);
    setAvailability(null);
    const timer = window.setTimeout(() => {
      checkSubdomain(prefix, domainForm.suffix)
        .then((result) => {
          if (!cancelled) setAvailability(result);
        })
        .catch((cause) => {
          if (!cancelled)
            setAvailability({
              available: false,
              normalized: prefix,
              reason: cause instanceof Error ? cause.message : "可用性检查失败",
            });
        })
        .finally(() => {
          if (!cancelled) setCheckingPrefix(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [domainForm.prefix, domainForm.suffix]);
  const hostname = `${domainForm.prefix.trim().toLowerCase()}.${domainForm.suffix}`;
  const filteredDomains = data.domainsList.filter((domain) => (!domainForm.userId || domain.userId === domainForm.userId) && `${domain.hostname} ${domain.ownerEmail} ${domain.siteName ?? ""}`.toLowerCase().includes(domainQuery.trim().toLowerCase()));
  function changeDomainView(next: "pricing" | "assignment") {
    if (next === domainView) return;
    const savedPrices = data.domainPricing
      .filter((item) => item.domain_type !== "custom_domain")
      .map((item) => ({
        ...item,
        hostname_suffix: item.hostname_suffix || clientPlatformConfig.domains.distributionRoot,
      }));
    setPriceDrafts(Object.fromEntries(savedPrices.map((item) => [item.domain_type, item])));
    setPriceValues(Object.fromEntries(savedPrices.map((item) => [item.domain_type, String(item.price_cents / 100)])));
    setNewSuffix("");
    setNewPrice("9.90");
    setFieldErrors({});
    setDomainForm({
      userId: "",
      prefix: "",
      suffix: savedPrices.find((item) => item.enabled)?.hostname_suffix || clientPlatformConfig.domains.distributionRoot,
    });
    setDomainView(next);
  }
  return (
    <div className="mt-5">
      <div aria-label="域名管理功能" className="inline-flex rounded-md bg-zinc-900 p-1" role="tablist">
        <button aria-selected={domainView === "assignment"} className={cn("h-9 rounded px-4 text-sm font-medium transition-colors", domainView === "assignment" ? "bg-cyan-400/15 text-cyan-200" : "text-zinc-500 hover:text-zinc-200")} onClick={() => changeDomainView("assignment")} role="tab" type="button">
          分配平台域名
        </button>
        <button aria-selected={domainView === "pricing"} className={cn("h-9 rounded px-4 text-sm font-medium transition-colors", domainView === "pricing" ? "bg-amber-400/15 text-amber-200" : "text-zinc-500 hover:text-zinc-200")} onClick={() => changeDomainView("pricing")} role="tab" type="button">
          平台域名定价
        </button>
      </div>
      {domainView === "pricing" ? (
        <section className="mt-6 border-l-2 border-amber-400/40 pl-4 sm:pl-6">
          <SectionHeading title="平台域名定价" description="维护平台持有的域名后缀、价格和上架状态；这里的变更会影响用户可选择的域名。" />
          <div className="mt-4 grid items-end gap-3 bg-amber-400/[0.04] px-4 py-4 lg:grid-cols-[minmax(0,1fr)_9rem_8rem_auto]">
            <label className="grid min-w-0 gap-1 text-xs text-zinc-500">
              新域名后缀
              <ClearableInput aria-label="新域名后缀" onChange={(e) => { setNewSuffix(e.target.value); setFieldErrors((all) => ({ ...all, newSuffix: "" })); }} placeholder="pages.example.com" value={newSuffix} />
              <FieldError message={fieldErrors.newSuffix} />
            </label>
            <label className="relative grid min-w-0 gap-1 text-xs text-zinc-500">
              价格（元）
              <ClearableInput
                aria-label="新域名价格"
                inputMode="decimal"
                onChange={(e) => {
                  setNewPrice(e.target.value);
                  setFieldErrors((all) => ({ ...all, newPrice: "" }));
                }}
                value={newPrice}
              />
              <FieldError className="absolute left-0 top-full whitespace-nowrap" message={fieldErrors.newPrice} />
            </label>
            <label className="grid min-w-0 gap-1 text-xs text-zinc-500">
              计费周期
              <select className={selectClass} onChange={(e) => setNewBillingPeriod(e.target.value as AdminDomainPrice["billing_period"])} value={newBillingPeriod}>
                <option value="month">每月</option>
                <option value="year">每年</option>
                <option value="one_time">一次性</option>
              </select>
            </label>
            <button
              className={cn(STUDIO_SECONDARY_BUTTON_CLASS, "w-full lg:w-auto")}
              disabled={!newSuffix.includes(".")}
              onClick={() => {
                if (!isValidNumber(newPrice)) {
                  setFieldErrors((all) => ({ ...all, newPrice: numberError }));
                  return;
                }
                const normalized = normalizeHostname(newSuffix);
                if (!normalized.ok) {
                  setFieldErrors((all) => ({ ...all, newSuffix: normalized.reason }));
                  return;
                }
                const suffix = normalized.ascii;
                confirm({
                  title: "新增平台域名",
                  description: `新增 ${normalized.display}${normalized.display !== suffix ? `（${suffix}）` : ""}，价格 ¥${Number(newPrice).toFixed(2)}，${newBillingPeriod === "month" ? "按月" : newBillingPeriod === "year" ? "按年" : "一次性"}计费。`,
                  run: async () => {
                    const created = await createAdminDomainPrice({
                      domain_type: platformDomainType(suffix),
                      label: normalized.display,
                      hostname_suffix: suffix,
                      price_cents: Math.round(Number(newPrice) * 100),
                      billing_period: newBillingPeriod,
                      enabled: true,
                    });
                    setNewSuffix("");
                    return created;
                  },
                });
              }}
              type="button"
            >
              <Plus className="h-4 w-4" />
              新增后缀
            </button>
          </div>
          <p className="mt-3 text-xs text-zinc-500">开关修改后需要点击右侧“保存”才会生效。</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 text-zinc-500">
                  <th className="px-3 py-3 font-medium">平台后缀</th>
                  <th className="px-3 py-3 font-medium">价格（元）</th>
                  <th className="px-3 py-3 font-medium">周期</th>
                  <th className="px-3 py-3 font-medium">状态</th>
                  <th className="px-3 py-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {Object.values(priceDrafts).map((draft) => (
                  <tr className="border-b border-white/10 last:border-0" key={draft.domain_type}>
                    <Cell>
                      <ClearableInput
                        aria-label="平台域名后缀"
                        disabled={Boolean(draft.cloudflare_zone_id)}
                        onChange={(e) =>
                          setPriceDrafts((all) => ({
                            ...all,
                            [draft.domain_type]: {
                              ...draft,
                              hostname_suffix: e.target.value,
                              label: e.target.value,
                            },
                          }))
                        }
                        value={draft.hostname_suffix}
                      />
                      <FieldError />
                    </Cell>
                    <Cell>
                      <ClearableInput
                        aria-label={`${draft.hostname_suffix} 价格`}
                        inputMode="decimal"
                        onChange={(e) => {
                          setPriceValues((all) => ({
                            ...all,
                            [draft.domain_type]: e.target.value,
                          }));
                          setFieldErrors((all) => ({
                            ...all,
                            [draft.domain_type]: "",
                          }));
                        }}
                        value={priceValues[draft.domain_type] ?? ""}
                      />
                      <FieldError message={fieldErrors[draft.domain_type]} />
                    </Cell>
                    <Cell>
                      <select
                        aria-label={`${draft.hostname_suffix} 计费周期`}
                        className={selectClass}
                        onChange={(e) =>
                          setPriceDrafts((all) => ({
                            ...all,
                            [draft.domain_type]: {
                              ...draft,
                              billing_period: e.target.value as AdminDomainPrice["billing_period"],
                            },
                          }))
                        }
                        value={draft.billing_period}
                      >
                        <option value="month">每月</option>
                        <option value="year">每年</option>
                        <option value="one_time">一次性</option>
                      </select>
                    </Cell>
                    <Cell>
                      <DomainSetupStatus domain={draft} />
                      <Toggle
                        checked={draft.enabled}
                        disabled={draft.setup_status !== "active"}
                        label={draft.enabled ? "可选择" : "已下架"}
                        onChange={(checked) =>
                          setPriceDrafts((all) => ({
                            ...all,
                            [draft.domain_type]: { ...draft, enabled: checked },
                          }))
                        }
                      />
                    </Cell>
                    <Cell className="text-right">
                      {draft.setup_status !== "active" ? (
                        <button
                          aria-label={`检查 ${draft.hostname_suffix} Cloudflare 配置`}
                          className={quietButton}
                          onClick={() =>
                            confirm({
                              title: "检查 Cloudflare 配置",
                              description: `检查 ${draft.hostname_suffix} 的名称服务器，并在 Zone 生效后创建通配 DNS 和 Worker Route。`,
                              run: () => syncAdminDomainPrice(draft.domain_type),
                            })
                          }
                          type="button"
                        >
                          <RefreshCw className="h-4 w-4" />
                          检查
                        </button>
                      ) : null}
                      <button
                        aria-label={`保存 ${draft.hostname_suffix}`}
                        className={saveButton}
                        onClick={() => {
                          const value = priceValues[draft.domain_type];
                          if (!isValidNumber(value)) {
                            setFieldErrors((all) => ({
                              ...all,
                              [draft.domain_type]: numberError,
                            }));
                            return;
                          }
                          confirm({
                            title: "保存域名定价",
                            description: `保存 ${draft.hostname_suffix} 的价格和上架状态。`,
                            run: () =>
                              updateAdminDomainPrice(draft.domain_type, {
                                ...draft,
                                price_cents: Math.round(Number(value) * 100),
                              }),
                          });
                        }}
                        type="button"
                      >
                        <Save className="h-4 w-4" />
                        保存
                      </button>
                      <button
                        aria-label={`删除 ${draft.hostname_suffix}`}
                        className={dangerButton}
                        onClick={() =>
                          confirm({
                            title: "移除平台域名",
                            description: `移除 ${draft.hostname_suffix} 的定价选项。已有域名记录不会被删除。`,
                            destructive: true,
                            confirmLabel: "确认移除",
                            run: () => deleteAdminDomainPrice(draft.domain_type),
                          })
                        }
                        type="button"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </Cell>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
      {domainView === "assignment" ? (
        <section className="mt-6 border-l-2 border-cyan-400/40 pl-4 sm:pl-6">
          <SectionHeading title="分配平台域名" description="为用户分配二级域名，并在下方管理项目绑定和访问状态。" />
          <div className="mt-4 grid gap-3 bg-cyan-400/[0.04] px-4 py-4 md:grid-cols-[minmax(0,1fr)_12rem_12rem_auto]">
            <UserCombobox onChange={(userId) => setDomainForm({ ...domainForm, userId })} users={data.recentUsers} value={domainForm.userId} />
            <div>
              <ClearableInput
                aria-label="域名前缀"
                autoComplete="one-time-code"
                data-1p-ignore
                data-form-type="other"
                data-lpignore="true"
                name="platform-domain-prefix"
                onChange={(e) =>
                  setDomainForm({
                    ...domainForm,
                    prefix: e.target.value.replace(/[^a-zA-Z0-9-]/g, "").toLowerCase(),
                  })
                }
                placeholder="地址前缀"
                value={domainForm.prefix}
              />
              <p className={cn("mt-1 text-xs", checkingPrefix ? "text-zinc-500" : availability?.available ? "text-emerald-400" : "text-red-300")}>{checkingPrefix ? "正在检测可用性…" : availability ? (availability.available ? "该地址可用" : (availability.reason ?? "该地址不可用")) : ""}</p>
            </div>
            <DomainSuffixCombobox onChange={(suffix) => setDomainForm({ ...domainForm, suffix })} onFilterChange={setDomainQuery} options={enabledSuffixes} value={domainForm.suffix} />
            <button
              className={STUDIO_SECONDARY_BUTTON_CLASS}
              disabled={!domainForm.userId || !domainForm.prefix || checkingPrefix || !availability?.available || !enabledSuffixes.some((item) => item.hostname_suffix === domainForm.suffix)}
              onClick={() =>
                confirm({
                  title: "确认分配平台域名",
                  description: `为 ${usersById.get(domainForm.userId)?.email ?? domainForm.userId} 分配 ${hostname}。`,
                  run: () =>
                    createAdminDomain({
                      userId: domainForm.userId,
                      hostname,
                      type: "platform_subdomain",
                    }),
                })
              }
              type="button"
            >
              <Plus className="h-4 w-4" />
              分配
            </button>
          </div>
          <DataTable headers={["域名", "所有者", "绑定项目", "状态", "操作"]} flush>
            {filteredDomains.map((domain) => (
              <tr className="border-b border-white/10 last:border-0" key={domain.id}>
                <Cell>
                  <span className="text-zinc-200">{domain.hostname}</span>
                  <span className="block text-xs text-zinc-600">平台二级域名</span>
                </Cell>
                <Cell>{domain.ownerEmail}</Cell>
                <Cell>
                  <select
                    aria-label={`${domain.hostname} 绑定项目`}
                    className={selectClass}
                    onChange={(e) => {
                      const siteId = e.target.value || null;
                      const siteName = siteId ? data.recentSites.find((site) => site.id === siteId)?.name : "未绑定";
                      confirm({
                        title: "确认切换域名绑定",
                        description: `将 ${domain.hostname} ${siteId ? `绑定到“${siteName}”` : "解除项目绑定"}。`,
                        destructive: !siteId,
                        run: () => updateAdminDomain(domain.id, { siteId }),
                      });
                    }}
                    value={domain.siteId ?? ""}
                  >
                    <option value="">未绑定</option>
                    {data.recentSites
                      .filter((site) => site.ownerEmail === domain.ownerEmail && site.status === "active")
                      .map((site) => (
                        <option key={site.id} value={site.id}>
                          {site.name}
                        </option>
                      ))}
                  </select>
                </Cell>
                <Cell>
                  <StatusBadge status={domain.status} />
                </Cell>
                <Cell>
                  <StatusAction current={domain.status} label={domain.hostname} onClick={() => changeStatus("域名", domain.id, domain.hostname, domain.status)} />
                  <button
                    aria-label={`删除 ${domain.hostname}`}
                    className={dangerButton}
                    onClick={() =>
                      confirm({
                        title: "永久移除域名",
                        description: `移除 ${domain.hostname} 后会解绑项目并停止访问，但不会删除项目；该域名占用的额度会释放。`,
                        destructive: true,
                        confirmationText: domain.hostname,
                        confirmLabel: "移除域名",
                        run: () => deleteAdminDomain(domain.id),
                      })
                    }
                    type="button"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </Cell>
              </tr>
            ))}
          </DataTable>
        </section>
      ) : null}
    </div>
  );
}

function DomainSuffixCombobox({ onChange, onFilterChange, options, value }: { onChange: (suffix: string) => void; onFilterChange: (query: string) => void; options: AdminDomainPrice[]; value: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = options.find((option) => option.hostname_suffix === value);
  const matches = options.filter((option) => option.hostname_suffix.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-zinc-500" />
        <input
          aria-label="搜索并选择平台域名后缀"
          autoComplete="one-time-code"
          className={cn(fieldClass, "pl-9 pr-9")}
          data-1p-ignore
          data-form-type="other"
          data-lpignore="true"
          name="platform-domain-suffix-search"
          onBlur={() => setOpen(false)}
          onChange={(event) => {
            setQuery(event.target.value);
            onFilterChange(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="搜索域名后缀"
          value={selected && !open ? selected.hostname_suffix : query}
        />
        {value || query ? (
          <button
            aria-label="清除域名后缀"
            className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded text-zinc-500 hover:bg-white/10 hover:text-white"
            onClick={() => {
              onChange("");
              onFilterChange("");
              setQuery("");
              setOpen(false);
            }}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-white/15 bg-zinc-950 p-1 shadow-2xl">
          {matches.length ? (
            matches.map((option) => (
              <button
                className="flex w-full items-center justify-between gap-3 rounded px-3 py-2 text-left text-sm text-zinc-300 hover:bg-white/10 hover:text-white"
                key={option.domain_type}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(option.hostname_suffix);
                  onFilterChange(option.hostname_suffix);
                  setQuery("");
                  setOpen(false);
                }}
                type="button"
              >
                <span className="truncate">{option.hostname_suffix}</span>
                <span className="shrink-0 text-xs text-zinc-500">
                  {money(option.price_cents)} / {option.billing_period === "month" ? "月" : option.billing_period === "year" ? "年" : "一次性"}
                </span>
              </button>
            ))
          ) : (
            <p className="px-3 py-2 text-sm text-zinc-500">没有匹配后缀</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
function UserCombobox({ onChange, users, value }: { onChange: (userId: string) => void; users: AdminOverview["recentUsers"]; value: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = users.find((user) => user.id === value);
  const matches = users.filter((user) => `${user.email} ${user.id}`.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-zinc-500" />
        <input
          aria-label="搜索并选择域名所有者"
          autoComplete="one-time-code"
          className={cn(fieldClass, "pl-9 pr-9")}
          data-1p-ignore
          data-form-type="other"
          data-lpignore="true"
          name="platform-domain-owner-search"
          onBlur={() => setOpen(false)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="搜索用户邮箱或 ID"
          value={selected && !open ? selected.email : query}
        />
        {value || query ? (
          <button
            aria-label="清除用户筛选"
            className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded text-zinc-500 hover:bg-white/10 hover:text-white"
            onClick={() => {
              onChange("");
              setQuery("");
              setOpen(false);
            }}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-white/15 bg-zinc-950 p-1 shadow-2xl">
          {matches.length ? (
            matches.map((user) => (
              <button
                className="block w-full rounded px-3 py-2 text-left text-sm text-zinc-300 hover:bg-white/10 hover:text-white"
                key={user.id}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(user.id);
                  setQuery("");
                  setOpen(false);
                }}
                type="button"
              >
                <span className="block truncate">{user.email}</span>
                <span className="block truncate text-xs text-zinc-600">{user.id}</span>
              </button>
            ))
          ) : (
            <p className="px-3 py-2 text-sm text-zinc-500">没有匹配用户</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
function SearchField({ label, onChange, placeholder, value }: { label: string; onChange: (value: string) => void; placeholder: string; value: string }) {
  return (
    <label className="relative mt-5 block max-w-md">
      <span className="sr-only">{label}</span>
      <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-zinc-500" />
      <input aria-label={label} className={cn(fieldClass, "pl-9 pr-9")} inputMode="search" onChange={(event) => onChange(event.target.value)} placeholder={placeholder} type="text" value={value} />
      {value ? (
        <button
          aria-label={`清除${label}`}
          className={clearButtonClass}
          onClick={(event) => {
            event.preventDefault();
            onChange("");
          }}
          type="button"
        >
          <X className="h-4 w-4" />
        </button>
      ) : null}
    </label>
  );
}
function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h2 className="text-base font-semibold text-white">{title}</h2>
      <p className="mt-1 text-sm leading-6 text-zinc-500">{description}</p>
    </div>
  );
}
function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm", status === "blocked" ? "text-red-300" : status === "pending_review" ? "text-amber-300" : "text-zinc-300")}>
      <span className={cn("h-1.5 w-1.5 rounded-full", status === "blocked" ? "bg-red-400" : status === "pending_review" ? "bg-amber-400" : "bg-emerald-400")} />
      {statusLabels[status] ?? status}
    </span>
  );
}
function StatusAction({ current, label, onClick }: { current: string; label: string; onClick: () => void }) {
  const blocked = current === "blocked";
  return (
    <button aria-label={`${blocked ? "解封" : "封禁"} ${label}`} className={cn(blocked ? quietButton : dangerButton, "w-20")} onClick={onClick} type="button">
      {blocked ? <RotateCcw className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
      {blocked ? "解封" : "封禁"}
    </button>
  );
}
function DomainSetupStatus({ domain }: { domain: AdminDomainPrice }) {
  const labels: Record<AdminDomainPrice["setup_status"], string> = {
    pending_zone: "正在创建 Zone",
    pending_nameservers: "等待修改 NS",
    configuring: "正在配置路由",
    active: "Cloudflare 已就绪",
    error: "配置失败",
  };
  return (
    <div className="mb-2 max-w-64 text-xs leading-5">
      <span className={domain.setup_status === "active" ? "text-emerald-400" : domain.setup_status === "error" ? "text-red-300" : "text-amber-300"}>{labels[domain.setup_status]}</span>
      {domain.cloudflare_nameservers.length ? (
        <div className="mt-1 text-zinc-500">
          {domain.cloudflare_nameservers.map((nameserver) => (
            <code className="block select-all" key={nameserver}>
              {nameserver}
            </code>
          ))}
        </div>
      ) : null}
      {domain.setup_error ? <p className="mt-1 break-words text-red-300">{domain.setup_error}</p> : null}
    </div>
  );
}

function Toggle({ checked, disabled = false, label, onChange }: { checked: boolean; disabled?: boolean; label: string; onChange: (checked: boolean) => void }) {
  return (
    <label className={cn("inline-flex items-center gap-2 text-sm text-zinc-400", disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer")}>
      <input checked={checked} className="peer sr-only" disabled={disabled} onChange={(e) => onChange(e.target.checked)} type="checkbox" />
      <span className="flex h-5 w-9 items-center rounded-full bg-zinc-800 p-0.5 transition-colors peer-checked:bg-emerald-500 peer-focus-visible:ring-2 peer-focus-visible:ring-white">
        <span className={cn("h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200", checked && "translate-x-4")} />
      </span>
      {label}
    </label>
  );
}
function DataTable({ headers, children, flush = false }: { headers: string[]; children: React.ReactNode; flush?: boolean }) {
  return (
    <div className={cn("overflow-x-auto border-y border-white/15", !flush && "mt-5")}>
      <table className="w-full min-w-[760px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-white/15">
            {headers.map((header) => (
              <th className="px-3 py-3 font-medium text-zinc-500" key={header}>
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
function Cell({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn("px-3 py-3 text-zinc-400", className)}>{children}</td>;
}
