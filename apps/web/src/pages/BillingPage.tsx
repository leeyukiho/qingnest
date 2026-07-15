import {
  ArrowRight,
  CreditCard,
  Database,
  FolderKanban,
  Globe2,
  Layers3,
  Rocket,
  UploadCloud,
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
  const plan = account?.planConfig ?? getPlanConfig(account?.plan);
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
  const benefits = [
    {
      icon: FolderKanban,
      title: "项目空间",
      value: `${plan.quotas.user.maxSites} 个项目`,
      description: `同时公开 ${plan.quotas.user.maxPublicSites} 个站点，从作品展示到业务官网都能集中管理。`,
    },
    {
      icon: Database,
      title: "托管存储",
      value: formatBytes(plan.quotas.user.maxStorageBytes),
      description: "平台负责存放网站当前线上版本，发布时会校验账户剩余空间。",
    },
    {
      icon: Rocket,
      title: "快速发布",
      value: `${plan.quotas.user.maxDeploymentsPerDay} 次 / 天`,
      description: "上传 ZIP 或文件夹即可更新网站，免服务器配置，把时间留给内容和业务。",
    },
    {
      icon: UploadCloud,
      title: "上传频次",
      value: `${plan.quotas.user.maxUploadSessionsPerHour} 次 / 小时`,
      description: "为频繁更新留出充足空间，达到上限后下一小时自动恢复。",
    },
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
                    <p className="mt-2 whitespace-nowrap text-sm text-zinc-500">掌握项目、站点和存储用量。</p>
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
                <p className="mt-auto border-t border-white/10 pt-5 text-xs text-zinc-600">在线升级和付款正在接入，目前不会自动扣费。</p>
                <button className="mt-3 inline-flex h-9 w-fit items-center gap-2 text-sm font-semibold text-white transition-colors hover:text-zinc-300" onClick={() => onNavigate("/#pricing")} type="button">
                  查看其他收费计划
                  <ArrowRight className="h-4 w-4" />
                </button>
              </section>
              <section
                className={`${STUDIO_PANEL_CLASS} flex min-h-72 flex-col p-5 sm:p-6`}
              >
                <div className="flex items-start gap-3">
                  <Layers3 className="mt-0.5 h-5 w-5 text-zinc-400" />
                  <div>
                    <p className="text-xs text-zinc-500">独立服务</p>
                    <h2 className="mt-1 text-lg font-semibold">可租赁域名</h2>
                    <p className="mt-2 whitespace-nowrap text-sm text-zinc-500">为网站选择更好记的公开地址。</p>
                  </div>
                </div>
                <div className="mt-6 grid grid-cols-3 gap-px overflow-hidden rounded-md border border-white/10 bg-white/10">
                  <div className="bg-black p-4">
                    <p className="text-xs text-zinc-500">地址选择</p>
                    <p className="mt-2 text-sm font-medium">多个后缀</p>
                  </div>
                  <div className="bg-black p-4">
                    <p className="text-xs text-zinc-500">项目管理</p>
                    <p className="mt-2 text-sm font-medium">支持换绑</p>
                  </div>
                  <div className="bg-black p-4">
                    <p className="text-xs text-zinc-500">计费方式</p>
                    <p className="mt-2 text-sm font-medium">独立购买</p>
                  </div>
                </div>
                <p className="mt-auto border-t border-white/10 pt-5 text-xs text-zinc-600">域名与资源套餐分开计费，套餐变更不影响已租地址。</p>
                <button
                  className="mt-3 inline-flex h-9 w-fit items-center gap-2 text-sm font-semibold text-white transition-colors hover:text-zinc-300"
                  onClick={() => onNavigate(STUDIO_DOMAIN_PURCHASE_PATH)}
                  type="button"
                >
                  查看可租赁域名
                  <ArrowRight className="h-4 w-4" />
                </button>
              </section>
            </div>
            <section className={`${STUDIO_PANEL_CLASS} mt-5 p-5 sm:p-6`}>
              <p className="text-xs text-zinc-500">当前等级</p>
              <h2 className="mt-1 text-base font-semibold">{plan.label}完整权益</h2>
              <p className="mt-2 text-sm text-zinc-500">从上传到公开访问，平台替你处理托管和分发，让网站更快上线。</p>
              <dl className="mt-5 grid gap-x-10 sm:grid-cols-2">
                {benefits.map(({ description, icon: Icon, title, value }) => (
                  <div className="grid min-h-28 grid-cols-[minmax(0,1fr)_auto] gap-x-4 border-b border-white/10 py-4" key={title}>
                    <dt className="min-w-0">
                      <span className="flex items-center gap-2 text-sm font-medium text-zinc-200"><Icon className="h-4 w-4 shrink-0 text-emerald-400" />{title}</span>
                      <span className="mt-2 block text-xs leading-5 text-zinc-500">{description}</span>
                    </dt>
                    <dd className="whitespace-nowrap text-right text-sm font-semibold tabular-nums text-zinc-100">{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          </div>
        </div>
      </section>
    </div>
  );
}
