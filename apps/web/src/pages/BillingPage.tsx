import { ArrowRight, CreditCard, FileText, ReceiptText } from "lucide-react";
import { getPlanConfig } from "@qingnest/shared/config/platform";
import { StudioSidebar } from "@/app/StudioSidebar";
import { formatBytes } from "@/app/deployment-view";
import { PRICING_PATH, STUDIO_DOMAIN_PURCHASE_PATH } from "@/app/navigation";
import {
  STUDIO_CONTENT_SHELL_CLASS,
  STUDIO_HEADER_CLASS,
  STUDIO_MAIN_CLASS,
  STUDIO_PANEL_CLASS,
  STUDIO_SECTION_CLASS,
  STUDIO_TITLE_CLASS,
} from "@/app/ui";
import type { AccountProfile } from "@/lib/api";

function percentage(current: number, limit: number) {
  if (limit <= 0) return 0;
  return Math.min(100, Math.round((current / limit) * 100));
}

export function BillingPage({
  account,
  onNavigate,
}: {
  account: AccountProfile | null;
  onNavigate: (path: string) => void;
}) {
  const plan = account?.planConfig ?? getPlanConfig(account?.plan);
  const usage = account?.usage;
  const quotaItems: Array<{ label: string; current: number; limit: number; unit?: string; formatted?: boolean }> = [
    { label: "项目", current: usage?.sites ?? 0, limit: plan.quotas.user.maxSites, unit: "个" },
    { label: "公开站点", current: usage?.publicSites ?? 0, limit: plan.quotas.user.maxPublicSites, unit: "个" },
    { label: "存储空间", current: usage?.storageBytes ?? 0, limit: plan.quotas.user.maxStorageBytes, formatted: true },
    { label: "今日发布", current: usage?.deploymentsToday ?? 0, limit: plan.quotas.user.maxDeploymentsPerDay, unit: "次" },
  ];
  const includedItems = [
    `单站最大 ${formatBytes(plan.quotas.site.maxSiteBytes)}`,
    `单次最多 ${plan.quotas.deployment.maxFiles.toLocaleString("zh-CN")} 个文件`,
    `每小时上传 ${plan.quotas.user.maxUploadSessionsPerHour} 次`,
    `每个项目绑定 ${plan.quotas.site.maxDomainsPerSite} 个域名`,
    "访问流量与传输带宽不单独计量",
  ];

  return (
    <div className="min-h-dvh bg-black">
      <section className={STUDIO_SECTION_CLASS}>
        <div className={STUDIO_CONTENT_SHELL_CLASS}>
          <StudioSidebar account={account} active="billing" onNavigate={onNavigate} />
          <main className={STUDIO_MAIN_CLASS}>
            <header className={STUDIO_HEADER_CLASS}>
              <div>
                <h1 className={STUDIO_TITLE_CLASS}>套餐与账单</h1>
                <p className="mt-2 text-sm text-zinc-500">查看套餐用量和历史订单。</p>
              </div>
            </header>

            <section className={`${STUDIO_PANEL_CLASS} mt-5 p-5 sm:p-6`} aria-labelledby="plan-title">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <CreditCard className="mt-0.5 h-5 w-5 text-emerald-400" aria-hidden="true" />
                  <div>
                    <p className="text-xs text-zinc-500">当前套餐</p>
                    <h2 className="mt-1 text-lg font-semibold text-white" id="plan-title">{plan.label}</h2>
                  </div>
                </div>
                <button className="inline-flex h-9 items-center gap-2 text-sm font-medium text-zinc-200 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60" onClick={() => onNavigate(PRICING_PATH)} type="button">
                  查看套餐 <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>

              <dl className="mt-5 grid gap-x-8 sm:grid-cols-2">
                {quotaItems.map((item) => {
                  const used = percentage(item.current, item.limit);
                  const current = item.formatted ? formatBytes(item.current) : `${item.current}${item.unit}`;
                  const limit = item.formatted ? formatBytes(item.limit) : `${item.limit}${item.unit}`;
                  return (
                    <div className="border-t border-white/10 py-3" key={item.label}>
                      <div className="flex items-baseline justify-between gap-4">
                        <dt className="text-sm text-zinc-400">{item.label}</dt>
                        <dd className="text-sm font-medium tabular-nums text-zinc-100">{current} / {limit} <span className="ml-2 text-xs text-zinc-500">{used}%</span></dd>
                      </div>
                      <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10" aria-hidden="true"><div className="h-full rounded-full bg-emerald-400" style={{ width: `${used}%` }} /></div>
                    </div>
                  );
                })}
              </dl>
              <ul className="mt-1 flex flex-wrap gap-x-5 gap-y-2 border-t border-white/10 pt-4 text-xs text-zinc-500">
                {includedItems.map((item) => <li className="before:mr-2 before:text-zinc-700 before:content-['·']" key={item}>{item}</li>)}
              </ul>
            </section>

            <section className={`${STUDIO_PANEL_CLASS} mt-5 min-h-80 p-5 sm:p-6`} aria-labelledby="orders-title">
              <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-4">
                <div className="flex items-center gap-3">
                  <ReceiptText className="h-5 w-5 text-zinc-400" aria-hidden="true" />
                  <div>
                    <h2 className="text-base font-semibold text-white" id="orders-title">订单记录</h2>
                    <p className="mt-1 text-xs text-zinc-500">套餐与域名购买记录</p>
                  </div>
                </div>
                <span className="text-xs text-zinc-600">共 0 笔</span>
              </div>
              <div className="flex min-h-56 flex-col items-center justify-center px-4 text-center">
                <span className="flex h-10 w-10 items-center justify-center rounded-md border border-white/10 bg-white/[0.03]"><FileText className="h-5 w-5 text-zinc-500" aria-hidden="true" /></span>
                <p className="mt-4 text-sm font-medium text-zinc-300">暂无订单</p>
                <p className="mt-1 text-xs text-zinc-600">订单功能上线后，付款记录和状态会显示在这里。</p>
                <button className="mt-4 inline-flex h-9 items-center gap-2 text-sm font-medium text-zinc-300 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60" onClick={() => onNavigate(STUDIO_DOMAIN_PURCHASE_PATH)} type="button">
                  浏览可租赁域名 <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </section>
          </main>
        </div>
      </section>
    </div>
  );
}
