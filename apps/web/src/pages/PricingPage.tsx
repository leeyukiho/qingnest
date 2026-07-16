import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, Crown, Database, Globe2, LoaderCircle, Rocket, UploadCloud, X } from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import { CONTENT_TRACK_CLASS } from "@/app/ui";
import { STUDIO_BILLING_PATH } from "@/app/navigation";
import { formatBytes } from "@/app/deployment-view";
import { getPublicPlans, type PublicPlan } from "@/lib/api";
import { cn } from "@/lib/utils";

const capabilityRows: Array<{ label: string; key: keyof PublicPlan }> = [
  { label: "自定义域名", key: "custom_domain" },
  { label: "访问密码保护", key: "password_protection" },
  { label: "访问数据分析", key: "access_analytics" },
  { label: "移除平台标识", key: "remove_branding" },
  { label: "版本回滚", key: "rollback" },
  { label: "源码构建", key: "source_build" },
];

const productTabs = [
  { key: "hosting", label: "站点托管", available: true },
  { key: "domains", label: "域名服务", available: false },
  { key: "addons", label: "增值服务", available: false },
] as const;

function money(cents: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2, minimumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
}

function PlanPrice({ plan }: { plan: PublicPlan }) {
  const isFree = plan.renewal_price_cents === 0;
  const daily = plan.renewal_price_cents / 100 / 30;
  const saving = plan.monthly_price_cents > plan.renewal_price_cents
    ? Math.round((1 - plan.renewal_price_cents / plan.monthly_price_cents) * 100)
    : 0;

  return (
    <div className="mt-5 min-h-[6.5rem]">
      <div className="flex items-end justify-center gap-2">
        <span className="pb-2 text-xl font-semibold text-zinc-500">¥</span>
        <span className="text-6xl font-bold leading-none tracking-normal text-white sm:text-7xl">{money(plan.renewal_price_cents)}</span>
        <span className="pb-2 text-sm font-medium text-zinc-500">/ 月</span>
      </div>
      {isFree ? (
        <p className="mt-3 text-sm font-semibold text-emerald-300">永久免费，无需绑定支付方式</p>
      ) : (
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <span className="rounded border border-emerald-300/30 bg-emerald-300/10 px-2 py-1 text-xs font-semibold text-emerald-200">续费特惠{saving ? ` · 省 ${saving}%` : ""}</span>
          <span className="text-sm text-zinc-400">折合每天仅 <strong className="text-lg font-bold text-white">¥{daily.toFixed(2)}</strong></span>
        </div>
      )}
      {saving ? <p className="mt-2 text-xs text-zinc-600">普通月价 ¥{money(plan.monthly_price_cents)}，续费长期享特惠价</p> : null}
    </div>
  );
}

export function PricingPage({ onNavigate, session }: { onNavigate: (path: string) => void; session: Session | null }) {
  const [activeProduct, setActiveProduct] = useState<(typeof productTabs)[number]["key"]>("hosting");
  const [plans, setPlans] = useState<PublicPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    getPublicPlans()
      .then((data) => { if (active) setPlans(data.filter((plan) => plan.enabled)); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "套餐加载失败"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const recommendedKey = useMemo(() => plans.find((plan) => plan.key === "pro")?.key ?? plans.find((plan) => plan.renewal_price_cents > 0)?.key, [plans]);
  const availableProductTabs = productTabs.filter((tab) => tab.available);
  const startPath = session ? STUDIO_BILLING_PATH : "/auth?mode=sign_up";

  return (
    <main className="min-h-dvh bg-black pb-16 pt-24 text-white">
      <header className={cn(CONTENT_TRACK_CLASS, "border-b border-white/15 pb-6")}>
        <div className="mx-auto max-w-4xl text-center">
          <h1 className="text-balance text-4xl font-semibold leading-tight tracking-normal text-white sm:text-[3.5rem]">选择适合你的套餐</h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-zinc-400 sm:text-base">清晰的价格与权益，按需选择，随时升级。</p>
          {availableProductTabs.length > 1 ? (
          <div className="mx-auto mt-5 inline-grid max-w-full rounded-md border border-white/15 bg-white/[0.04] p-1" role="tablist" aria-label="定价产品" style={{ gridTemplateColumns: `repeat(${availableProductTabs.length}, minmax(0, 1fr))` }}>
            {availableProductTabs.map((tab) => (
              <button
                aria-selected={activeProduct === tab.key}
                className={cn(
                  "h-9 min-w-24 rounded px-3 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white sm:min-w-28",
                  activeProduct === tab.key ? "bg-white text-black" : "text-zinc-500",
                  "cursor-pointer hover:text-white"
                )}
                key={tab.key}
                onClick={() => setActiveProduct(tab.key)}
                role="tab"
                type="button"
              >
                {tab.label}
              </button>
            ))}
          </div>
          ) : null}
        </div>
      </header>

      <section className={cn(CONTENT_TRACK_CLASS, "py-4")} aria-label="套餐列表">
        {loading ? <div className="flex min-h-72 items-center justify-center gap-3 text-zinc-400"><LoaderCircle className="h-5 w-5 animate-spin" />正在读取套餐</div> : null}
        {error ? <p className="border-b border-red-400/30 py-10 text-red-300" role="alert">{error}</p> : null}
        {!loading && !error ? (
          <div className="grid border-b border-white/15 md:grid-cols-2 xl:grid-cols-4">
            {plans.map((plan) => {
              const recommended = plan.key === recommendedKey;
              return (
                <article key={plan.key} className={cn("relative flex min-h-[30rem] flex-col items-center border-b border-white/15 px-5 py-6 text-center md:border-r xl:border-b-0", recommended && "bg-white/[0.06]")}>
                  {recommended ? <span className="absolute right-4 top-4 flex items-center gap-1 rounded border border-cyan-300/30 bg-cyan-300/10 px-2 py-1 text-xs font-semibold text-cyan-200"><Crown className="h-3.5 w-3.5" />最受欢迎</span> : null}
                  <p className="text-sm font-semibold uppercase text-zinc-500">{plan.key}</p>
                  <h3 className="mt-2 text-2xl font-semibold tracking-normal">{plan.label}</h3>
                  <PlanPrice plan={plan} />
                  <button className={cn("mt-5 inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-md border px-4 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white", recommended ? "border-white bg-white text-black hover:bg-black hover:text-white" : "border-white/25 bg-black hover:border-white hover:bg-white hover:text-black")} onClick={() => onNavigate(startPath)} type="button">
                    {plan.renewal_price_cents === 0 ? "免费开始" : "选择此套餐"}<ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <ul className="mt-5 space-y-2.5 text-sm text-zinc-300">
                    <li className="flex justify-center gap-2"><Rocket className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />最多 {plan.max_sites} 个站点，{plan.max_public_sites} 个公开站点</li>
                    <li className="flex justify-center gap-2"><Database className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />总存储 {formatBytes(plan.max_storage_bytes)}</li>
                    <li className="flex justify-center gap-2"><UploadCloud className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />每天 {plan.max_deployments_per_day} 次部署</li>
                    <li className="flex justify-center gap-2"><Globe2 className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" />每站最多 {plan.max_domains_per_site} 个域名</li>
                  </ul>
                </article>
              );
            })}
          </div>
        ) : null}
      </section>

      {plans.length ? (
        <section className={cn(CONTENT_TRACK_CLASS, "pt-8")} aria-labelledby="compare-heading">
          <div className="border-b border-white/15 pb-4 text-center"><h2 id="compare-heading" className="text-2xl font-semibold tracking-normal">权益对比</h2></div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-center text-sm">
              <thead><tr className="border-b border-white/15"><th className="w-64 px-4 py-5 font-semibold text-zinc-400">权益与配额</th>{plans.map((plan) => <th className="px-4 py-5 text-base font-semibold" key={plan.key}>{plan.label}</th>)}</tr></thead>
              <tbody>
                <tr className="border-b border-white/10"><th className="px-4 py-4 font-medium text-zinc-400">单站容量</th>{plans.map((plan) => <td className="px-4 py-4" key={plan.key}>{formatBytes(plan.max_site_bytes)}</td>)}</tr>
                <tr className="border-b border-white/10"><th className="px-4 py-4 font-medium text-zinc-400">单次最多文件</th>{plans.map((plan) => <td className="px-4 py-4" key={plan.key}>{plan.max_files.toLocaleString("zh-CN")}</td>)}</tr>
                {capabilityRows.map((row) => <tr className="border-b border-white/10" key={row.key}><th className="px-4 py-4 font-medium text-zinc-400">{row.label}</th>{plans.map((plan) => <td className="px-4 py-4" key={plan.key}>{plan[row.key] ? <><Check className="inline h-4 w-4 text-emerald-300" aria-label="包含" /></> : <X className="inline h-4 w-4 text-zinc-700" aria-label="不包含" />}</td>)}</tr>)}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </main>
  );
}
