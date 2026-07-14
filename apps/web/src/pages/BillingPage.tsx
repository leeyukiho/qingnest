import { CreditCard, Database, FolderKanban, Globe2 } from "lucide-react";
import { getPlanConfig } from "@qingnest/shared/config/platform";
import { StudioSidebar } from "@/app/StudioSidebar";
import { formatBytes } from "@/app/deployment-view";
import { STUDIO_CONTENT_SHELL_CLASS, STUDIO_HEADER_CLASS, STUDIO_MAIN_CLASS, STUDIO_PANEL_CLASS, STUDIO_SECTION_CLASS, STUDIO_TITLE_CLASS } from "@/app/ui";
import type { AccountProfile } from "@/lib/api";

export function BillingPage({ account, onNavigate }: { account: AccountProfile | null; onNavigate: (path: string) => void }) {
  const plan = getPlanConfig(account?.plan);
  const usage = account?.usage;
  const items = [[FolderKanban, "项目", usage?.sites ?? 0, plan.quotas.user.maxSites], [Globe2, "公开站点", usage?.publicSites ?? 0, plan.quotas.user.maxPublicSites], [Database, "存储", formatBytes(usage?.storageBytes ?? 0), formatBytes(plan.quotas.user.maxStorageBytes)]] as const;
  return <div className="min-h-dvh bg-black"><section className={STUDIO_SECTION_CLASS}><div className={STUDIO_CONTENT_SHELL_CLASS}>
    <StudioSidebar account={account} active="billing" onNavigate={onNavigate} />
    <div className={STUDIO_MAIN_CLASS}><div className={STUDIO_HEADER_CLASS}><div><h1 className={STUDIO_TITLE_CLASS}>套餐与账单</h1><p className="mt-2 text-sm text-zinc-500">管理项目、公开站点、存储和部署额度。平台地址购买在域名页面单独处理。</p></div></div>
      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]"><div className={`${STUDIO_PANEL_CLASS} p-5 sm:p-6`}><div className="flex items-center gap-3"><CreditCard className="h-5 w-5 text-zinc-400" /><div><p className="text-xs text-zinc-500">当前套餐</p><h2 className="mt-1 text-lg font-semibold">{plan.label}</h2></div></div><div className="mt-6 grid gap-3 sm:grid-cols-3">{items.map(([Icon, label, current, limit]) => <div className="rounded-md border border-white/10 p-4" key={label}><Icon className="h-4 w-4 text-zinc-500" /><p className="mt-3 text-xs text-zinc-500">{label}</p><p className="mt-1 break-words text-sm font-semibold tabular-nums">{current} / {limit}</p></div>)}</div></div><aside className={`${STUDIO_PANEL_CLASS} h-fit p-5`}><h2 className="text-sm font-semibold">升级套餐</h2><p className="mt-2 text-sm leading-6 text-zinc-500">升级只增加项目、公开站点、存储和部署等资源额度，不包含购买新的平台地址。</p><p className="mt-4 border-t border-white/10 pt-4 text-xs text-zinc-600">支付和账单接口尚未接入。</p></aside></div>
    </div>
  </div></section></div>;
}
