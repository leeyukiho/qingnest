import { Check, Database, FolderKanban, Globe2, Plus, RotateCcw, Settings, UserRound, type LucideIcon } from "lucide-react";
import { getPlanConfig } from "@qingnest/shared/config/platform";
import type { AccountProfile } from "@/lib/api";
import { formatBytes } from "@/app/deployment-view";
import { STUDIO_ADMIN_PATH, STUDIO_PATH, STUDIO_PROFILE_PATH, STUDIO_PROJECTS_PATH } from "@/app/navigation";
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
  active: "create" | "projects" | "profile" | "admin";
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
      active: active === "profile",
      icon: UserRound,
      label: "账户",
      onClick: () => onNavigate(STUDIO_PROFILE_PATH)
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
        <button className="mt-3 w-full cursor-pointer border-t border-white/10 pt-4 text-left lg:mt-auto" onClick={() => onNavigate(STUDIO_PROFILE_PATH)} type="button">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-white/15 bg-white/[0.04] text-zinc-200"><UserRound className="h-4 w-4" /></span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-zinc-100">{account.email}</span>
              <span className="mt-0.5 block text-xs text-zinc-500">{plan.label} · {account.role === "admin" ? "管理员" : "用户"}</span>
            </span>
          </div>
          <span className="mt-4 grid gap-2 rounded-md border border-white/10 bg-white/[0.025] p-3">
            <span className="flex items-center justify-between gap-2 text-xs"><span className="flex items-center gap-1.5 text-zinc-500"><FolderKanban className="h-3.5 w-3.5" />项目</span><strong className="font-medium text-zinc-200">{usage?.sites ?? 0} / {plan.quotas.user.maxSites}</strong></span>
            <span className="flex items-center justify-between gap-2 text-xs"><span className="flex items-center gap-1.5 text-zinc-500"><Globe2 className="h-3.5 w-3.5" />公开站点</span><strong className="font-medium text-zinc-200">{usage?.publicSites ?? 0} / {plan.quotas.user.maxPublicSites}</strong></span>
            <span className="flex items-center justify-between gap-2 text-xs"><span className="flex items-center gap-1.5 text-zinc-500"><Database className="h-3.5 w-3.5" />存储</span><strong className="font-medium text-zinc-200">{formatBytes(usage?.storageBytes ?? 0)} / {formatBytes(plan.quotas.user.maxStorageBytes)}</strong></span>
            <span className="flex items-center justify-between gap-2 text-xs"><span className="flex items-center gap-1.5 text-zinc-500"><RotateCcw className="h-3.5 w-3.5" />今日发布</span><strong className="font-medium text-zinc-200">{usage?.deploymentsToday ?? 0} / {plan.quotas.user.maxDeploymentsPerDay}</strong></span>
          </span>
          <span className="mt-3 flex items-center gap-1.5 text-xs text-zinc-500"><Check className="h-3.5 w-3.5" />支持版本回滚</span>
        </button>
      ) : null}
    </aside>
  );
}
