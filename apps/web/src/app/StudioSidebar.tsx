import {
  Bell,
  CreditCard,
  FolderKanban,
  Globe2,
  ListOrdered,
  Plus,
  Settings,
  ShoppingBag,
  UserRound,
  WalletCards,
  type LucideIcon
} from "lucide-react";
import { getPlanConfig } from "@qingnest/shared/config/platform";
import type { AccountProfile } from "@/lib/api";
import { formatBytes } from "@/app/deployment-view";
import {
  STUDIO_ADMIN_PATH,
  STUDIO_BILLING_PATH,
  STUDIO_DOMAINS_PATH,
  STUDIO_MY_DOMAINS_PATH,
  STUDIO_NOTIFICATIONS_PATH,
  STUDIO_ORDERS_PATH,
  STUDIO_PATH,
  STUDIO_PROFILE_PATH,
  STUDIO_PROJECTS_PATH,
  STUDIO_WALLET_PATH
} from "@/app/navigation";
import { cn } from "@/lib/utils";

type StudioNavItem = {
  active: boolean;
  description: string;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
};

type StudioNavGroup = {
  items: StudioNavItem[];
  label: string;
};

export type StudioActiveNav = "create" | "projects" | "domains" | "domain-management" | "wallet" | "billing" | "orders" | "profile" | "notifications" | "admin";

export function StudioSidebar({
  account,
  active,
  onNavigate
}: {
  account: AccountProfile | null;
  active: StudioActiveNav;
  onNavigate: (path: string) => void;
}) {
  const navGroups: StudioNavGroup[] = [
    {
      label: "建站与发布",
      items: [
        {
          active: active === "create",
          description: "上传网站并生成版本",
          icon: Plus,
          label: "新建并发布",
          onClick: () => onNavigate(STUDIO_PATH)
        },
        {
          active: active === "projects",
          description: "管理站点、版本和发布",
          icon: FolderKanban,
          label: "项目与版本",
          onClick: () => onNavigate(STUDIO_PROJECTS_PATH)
        }
      ]
    },
    {
      label: "域名服务",
      items: [
        {
          active: active === "domains",
          description: "查找并购买可用域名",
          icon: ShoppingBag,
          label: "选购域名",
          onClick: () => onNavigate(STUDIO_DOMAINS_PATH)
        },
        {
          active: active === "domain-management",
          description: "绑定、换绑与续费",
          icon: Globe2,
          label: "我的域名",
          onClick: () => onNavigate(STUDIO_MY_DOMAINS_PATH)
        }
      ]
    },
    {
      label: "财务与账单",
      items: [
        {
          active: active === "wallet",
          description: "充值与资金明细",
          icon: WalletCards,
          label: "余额与充值",
          onClick: () => onNavigate(STUDIO_WALLET_PATH)
        },
        {
          active: active === "billing",
          description: "权益与资源配额",
          icon: CreditCard,
          label: "套餐与用量",
          onClick: () => onNavigate(STUDIO_BILLING_PATH)
        },
        {
          active: active === "orders",
          description: "套餐、域名与充值订单",
          icon: ListOrdered,
          label: "订单记录",
          onClick: () => onNavigate(STUDIO_ORDERS_PATH)
        }
      ]
    },
    {
      label: "账户",
      items: [
        {
          active: active === "notifications",
          description: "发布与服务动态",
          icon: Bell,
          label: "消息通知",
          onClick: () => onNavigate(STUDIO_NOTIFICATIONS_PATH)
        },
        {
          active: active === "profile",
          description: "资料与登录安全",
          icon: UserRound,
          label: "账户设置",
          onClick: () => onNavigate(STUDIO_PROFILE_PATH)
        }
      ]
    },
    ...(account?.role === "admin"
      ? [
          {
            label: "平台",
            items: [
              {
                active: active === "admin",
                description: "用户、资源与系统配置",
                icon: Settings,
                label: "平台管理",
                onClick: () => onNavigate(STUDIO_ADMIN_PATH)
              }
            ]
          }
        ]
      : [])
  ];
  const plan = getPlanConfig(account?.plan);
  const usage = account?.usage;
  const projectUsage = usage?.sites ?? 0;
  const storageUsage = usage?.storageBytes ?? 0;
  const projectLimit = plan.quotas.user.maxSites;
  const storageLimit = plan.quotas.user.maxStorageBytes;

  return (
    <aside className="flex h-fit w-full min-w-0 flex-col overflow-hidden rounded-md border border-white/20 bg-black p-3 lg:fixed lg:inset-y-0 lg:left-0 lg:z-40 lg:h-dvh lg:w-56 lg:overflow-y-auto lg:rounded-none lg:border-y-0 lg:border-l-0 lg:border-r lg:p-4 lg:pb-5 lg:pt-24">
      <nav aria-label="工作台导航" className="flex gap-2 overflow-x-auto lg:block lg:overflow-visible">
        {navGroups.map((group, groupIndex) => (
          <section className="contents lg:block" key={group.label}>
            <h2 className={cn("mb-1 hidden px-3 text-[11px] font-medium text-zinc-600 lg:block", groupIndex > 0 && "lg:mt-5")}>{group.label}</h2>
            <div className="contents lg:grid lg:gap-1">
              {group.items.map((item) => {
                const Icon = item.icon;

                return (
                  <button
                    aria-current={item.active ? "page" : undefined}
                    className={cn(
                      "group flex min-w-36 cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 lg:min-w-0 lg:py-2",
                      item.active
                        ? "border-white/20 bg-white/10 text-white"
                        : "border-transparent bg-transparent text-zinc-500 hover:border-white/10 hover:bg-white/5 hover:text-zinc-200"
                    )}
                    key={item.label}
                    onClick={item.onClick}
                    title={item.description}
                    type="button"
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{item.label}</span>
                      <span className={cn("mt-0.5 hidden truncate text-[11px] lg:block", item.active ? "text-zinc-400" : "text-zinc-600 group-hover:text-zinc-500")}>{item.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </nav>

      {account ? (
        <div className="mt-3 border-t border-white/10 pt-4 lg:mt-auto">
          <button className="w-full cursor-pointer rounded-md p-1 text-left transition-colors hover:bg-white/[0.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-white" onClick={() => onNavigate(STUDIO_PROFILE_PATH)} type="button">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-white/15 bg-white/[0.04] text-zinc-200"><UserRound className="h-4 w-4" aria-hidden="true" /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-zinc-100">{account.email}</span>
                <span className="mt-0.5 block text-xs text-zinc-500">{plan.label} · {account.role === "admin" ? "管理员" : "个人账户"}</span>
              </span>
            </div>
          </button>

          <button className="mt-4 hidden w-full cursor-pointer rounded-md border border-white/10 bg-white/[0.025] p-3 text-left transition-colors hover:border-white/20 hover:bg-white/[0.045] focus:outline-none focus-visible:ring-2 focus-visible:ring-white lg:block" onClick={() => onNavigate(STUDIO_BILLING_PATH)} type="button">
            <span className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-zinc-300">套餐用量</span>
              <span className="text-[11px] tabular-nums text-zinc-500">余额 ¥{(account.walletBalanceCents / 100).toFixed(2)}</span>
            </span>
              <span className="mt-3 block">
              <span className="flex items-center justify-between gap-2 text-[11px]"><span className="text-zinc-500">项目</span><strong className="font-medium tabular-nums text-zinc-300">{projectUsage} / {projectLimit}</strong></span>
              <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-white/10"><span className="block h-full rounded-full bg-zinc-300" style={{ width: `${Math.min(100, projectLimit > 0 ? (projectUsage / projectLimit) * 100 : 0)}%` }} /></span>
              </span>
              <span className="mt-3 grid grid-cols-2 gap-2 border-t border-white/10 pt-3 text-[11px]">
                <span><span className="block text-zinc-500">公开站点</span><strong className="mt-1 block font-medium tabular-nums text-zinc-300">{usage?.publicSites ?? 0} / {plan.quotas.user.maxPublicSites}</strong></span>
                <span><span className="block text-zinc-500">今日发布</span><strong className="mt-1 block font-medium tabular-nums text-zinc-300">{usage?.deploymentsToday ?? 0} / {plan.quotas.user.maxDeploymentsPerDay}</strong></span>
              </span>
            <span className="mt-3 block">
              <span className="flex items-center justify-between gap-2 text-[11px]"><span className="text-zinc-500">存储</span><strong className="font-medium tabular-nums text-zinc-300">{formatBytes(storageUsage)} / {formatBytes(storageLimit)}</strong></span>
              <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-white/10"><span className="block h-full rounded-full bg-zinc-300" style={{ width: `${Math.min(100, storageLimit > 0 ? (storageUsage / storageLimit) * 100 : 0)}%` }} /></span>
            </span>
            <span className="mt-3 flex items-center gap-1.5 border-t border-white/10 pt-2.5 text-[11px] font-medium text-zinc-500">
              <CreditCard className="h-3.5 w-3.5" aria-hidden="true" />
              查看套餐与用量
            </span>
          </button>
        </div>
      ) : null}
    </aside>
  );
}
