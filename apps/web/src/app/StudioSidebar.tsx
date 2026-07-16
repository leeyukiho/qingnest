import { Bell, Database, FolderKanban, Globe2, Plus, RotateCcw, Settings, UserRound, type LucideIcon } from "lucide-react";
import { getPlanConfig } from "@qingnest/shared/config/platform";
import type { AccountProfile } from "@/lib/api";
import { formatBytes } from "@/app/deployment-view";
import { STUDIO_ADMIN_PATH, STUDIO_BILLING_PATH, STUDIO_DOMAINS_PATH, STUDIO_NOTIFICATIONS_PATH, STUDIO_PATH, STUDIO_PROFILE_PATH, STUDIO_PROJECTS_PATH } from "@/app/navigation";
import { cn } from "@/lib/utils";

type StudioNavItem = {
  active: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
};

export function StudioSidebar({
  account,
  active,
  onNavigate
}: {
  account: AccountProfile | null;
  active: "create" | "projects" | "domains" | "billing" | "profile" | "notifications" | "admin";
  onNavigate: (path: string) => void;
}) {
  const navItems: StudioNavItem[] = [
    {
      active: active === "create",
      icon: Plus,
      label: "新建项目",
      onClick: () => onNavigate(STUDIO_PATH)
    },
    {
      active: active === "projects",
      icon: FolderKanban,
      label: "我的项目",
      onClick: () => onNavigate(STUDIO_PROJECTS_PATH)
    },
    {
      active: active === "domains",
      icon: Globe2,
      label: "域名",
      onClick: () => onNavigate(STUDIO_DOMAINS_PATH)
    },
    {
      active: active === "billing",
      icon: Database,
      label: "套餐与账单",
      onClick: () => onNavigate(STUDIO_BILLING_PATH)
    },
    {
      active: active === "profile",
      icon: UserRound,
      label: "账户",
      onClick: () => onNavigate(STUDIO_PROFILE_PATH)
    },
    {
      active: active === "notifications",
      icon: Bell,
      label: "通知",
      onClick: () => onNavigate(STUDIO_NOTIFICATIONS_PATH)
    },
    ...(account?.role === "admin"
      ? [
          {
            active: active === "admin",
            icon: Settings,
            label: "管理",
            onClick: () => onNavigate(STUDIO_ADMIN_PATH)
          }
        ]
      : [])
  ];
  const plan = getPlanConfig(account?.plan);
  const usage = account?.usage;

  return (
    <aside
      className="flex h-fit w-full min-w-0 flex-col overflow-hidden rounded-md border border-white/20 bg-black p-3 lg:fixed lg:inset-y-0 lg:left-0 lg:z-40 lg:h-dvh lg:w-56 lg:overflow-visible lg:rounded-none lg:border-y-0 lg:border-l-0 lg:border-r lg:p-4 lg:pb-5 lg:pt-24"
    >
      <nav
        aria-label="Studio"
        className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible"
      >
        {navItems.map((item) => {
          const Icon = item.icon;

          return (
            <button
              aria-current={item.active ? "page" : undefined}
              className={cn(
                "group flex min-w-36 cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 text-left transition-colors lg:min-w-0",
                item.active
                  ? "border-white/20 bg-white/10 text-white"
                  : "border-transparent bg-transparent text-zinc-500 hover:border-white/10 hover:bg-white/5 hover:text-zinc-200"
              )}
              key={item.label}
              onClick={item.onClick}
              type="button"
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="min-w-0 truncate text-sm font-medium">{item.label}</span>
            </button>
          );
        })}
      </nav>
      {account ? (
        <div className="mt-3 border-t border-white/10 pt-4 lg:mt-auto">
          <button className="w-full cursor-pointer rounded-md p-1 text-left transition-colors hover:bg-white/[0.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-white" onClick={() => onNavigate(STUDIO_PROFILE_PATH)} type="button">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-white/15 bg-white/[0.04] text-zinc-200"><UserRound className="h-4 w-4" /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-zinc-100">{account.email}</span>
              <span className="mt-0.5 block text-xs text-zinc-500">{plan.label} · {account.role === "admin" ? "管理员" : "用户"}</span>
            </span>
          </div>
          </button>
          <div className="mt-4 hidden gap-3 rounded-md border border-white/10 bg-white/[0.025] p-3 lg:grid" aria-label="账户用量">
            <span className="grid min-w-0 gap-1 text-xs"><span className="flex items-center gap-1.5 text-zinc-500"><FolderKanban className="h-3.5 w-3.5 shrink-0" />项目</span><strong className="min-w-0 break-words font-medium tabular-nums text-zinc-200">{usage?.sites ?? 0} / {plan.quotas.user.maxSites}</strong></span>
            <span className="grid min-w-0 gap-1 text-xs"><span className="flex items-center gap-1.5 text-zinc-500"><Globe2 className="h-3.5 w-3.5 shrink-0" />公开站点</span><strong className="min-w-0 break-words font-medium tabular-nums text-zinc-200">{usage?.publicSites ?? 0} / {plan.quotas.user.maxPublicSites}</strong></span>
            <span className="grid min-w-0 gap-1 text-xs"><span className="flex items-center gap-1.5 text-zinc-500"><Database className="h-3.5 w-3.5 shrink-0" />存储</span><strong className="min-w-0 break-words font-medium tabular-nums text-zinc-200">{formatBytes(usage?.storageBytes ?? 0)} / {formatBytes(plan.quotas.user.maxStorageBytes)}</strong></span>
            <span className="grid min-w-0 gap-1 text-xs"><span className="flex items-center gap-1.5 text-zinc-500"><RotateCcw className="h-3.5 w-3.5 shrink-0" />今日发布</span><strong className="min-w-0 break-words font-medium tabular-nums text-zinc-200">{usage?.deploymentsToday ?? 0} / {plan.quotas.user.maxDeploymentsPerDay}</strong></span>
            <span className="border-t border-white/10 pt-2 text-[11px] leading-4 text-zinc-600">来自项目、有效版本与域名记录，操作后自动更新</span>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
