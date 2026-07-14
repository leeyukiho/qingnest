import {
  ArrowRight,
  CreditCard,
  Database,
  FolderKanban,
  Globe2,
  Layers3,
} from "lucide-react";
import { getPlanConfig } from "@qingnest/shared/config/platform";
import { StudioSidebar } from "@/app/StudioSidebar";
import { formatBytes } from "@/app/deployment-view";
import { STUDIO_DOMAIN_PURCHASE_PATH } from "@/app/navigation";
import {
  STUDIO_CONTENT_SHELL_CLASS,
  STUDIO_HEADER_CLASS,
  STUDIO_MAIN_CLASS,
  STUDIO_PANEL_CLASS,
  STUDIO_SECTION_CLASS,
  STUDIO_TITLE_CLASS,
} from "@/app/ui";
import type { AccountProfile } from "@/lib/api";

export function BillingPage({
  account,
  onNavigate,
}: {
  account: AccountProfile | null;
  onNavigate: (path: string) => void;
}) {
  const plan = getPlanConfig(account?.plan);
  const usage = account?.usage;
  const items = [
    [FolderKanban, "项目", usage?.sites ?? 0, plan.quotas.user.maxSites],
    [
      Globe2,
      "公开站点",
      usage?.publicSites ?? 0,
      plan.quotas.user.maxPublicSites,
    ],
    [
      Database,
      "存储",
      formatBytes(usage?.storageBytes ?? 0),
      formatBytes(plan.quotas.user.maxStorageBytes),
    ],
  ] as const;
  return (
    <div className="min-h-dvh bg-black">
      <section className={STUDIO_SECTION_CLASS}>
        <div className={STUDIO_CONTENT_SHELL_CLASS}>
          <StudioSidebar
            account={account}
            active="billing"
            onNavigate={onNavigate}
          />
          <div className={STUDIO_MAIN_CLASS}>
            <div className={STUDIO_HEADER_CLASS}>
              <div>
                <h1 className={STUDIO_TITLE_CLASS}>套餐与账单</h1>
                <p className="mt-2 text-sm text-zinc-500">
                  在一处管理资源套餐、域名租赁与账单。
                </p>
              </div>
            </div>
            <div className="mt-5 grid gap-5 xl:grid-cols-2">
              <section
                className={`${STUDIO_PANEL_CLASS} flex min-h-72 flex-col p-5 sm:p-6`}
              >
                <div className="flex items-start gap-3">
                  <CreditCard className="mt-0.5 h-5 w-5 text-zinc-400" />
                  <div>
                    <p className="text-xs text-zinc-500">当前资源套餐</p>
                    <h2 className="mt-1 text-lg font-semibold">{plan.label}</h2>
                    <p className="mt-2 text-sm leading-6 text-zinc-500">
                      决定项目数量、公开站点、存储与部署额度。
                    </p>
                  </div>
                </div>
                <div className="mt-6 grid gap-3 sm:grid-cols-3">
                  {items.map(([Icon, label, current, limit]) => (
                    <div
                      className="rounded-md border border-white/10 p-4"
                      key={label}
                    >
                      <Icon className="h-4 w-4 text-zinc-500" />
                      <p className="mt-3 text-xs text-zinc-500">{label}</p>
                      <p className="mt-1 break-words text-sm font-semibold tabular-nums">
                        {current} / {limit}
                      </p>
                    </div>
                  ))}
                </div>
                <p className="mt-auto border-t border-white/10 pt-5 text-xs text-zinc-600">
                  套餐升级与账单支付接口尚未接入。
                </p>
              </section>
              <section
                className={`${STUDIO_PANEL_CLASS} flex min-h-72 flex-col p-5 sm:p-6`}
              >
                <div className="flex items-start gap-3">
                  <Layers3 className="mt-0.5 h-5 w-5 text-zinc-400" />
                  <div>
                    <p className="text-xs text-zinc-500">独立服务</p>
                    <h2 className="mt-1 text-lg font-semibold">可租赁域名</h2>
                    <p className="mt-2 text-sm leading-6 text-zinc-500">
                      从平台提供的多个域名后缀中选择地址。每个地址独立租赁，可在你的项目之间换绑，不受资源套餐变更影响。
                    </p>
                  </div>
                </div>
                <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-white/10 bg-white/10">
                  <div className="bg-black p-4">
                    <p className="text-xs text-zinc-500">可选范围</p>
                    <p className="mt-2 text-sm font-medium">多个平台域名</p>
                  </div>
                  <div className="bg-black p-4">
                    <p className="text-xs text-zinc-500">绑定方式</p>
                    <p className="mt-2 text-sm font-medium">每次绑定一个项目</p>
                  </div>
                </div>
                <button
                  className="mt-auto inline-flex h-10 w-fit items-center gap-2 pt-5 text-sm font-semibold text-white hover:text-zinc-300"
                  onClick={() => onNavigate(STUDIO_DOMAIN_PURCHASE_PATH)}
                  type="button"
                >
                  查看可租赁域名
                  <ArrowRight className="h-4 w-4" />
                </button>
              </section>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
