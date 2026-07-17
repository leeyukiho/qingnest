import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, CreditCard, LoaderCircle, Minus, WalletCards, X } from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import { CONTENT_TRACK_CLASS } from "@/app/ui";
import { STUDIO_BILLING_PATH, STUDIO_WALLET_PATH } from "@/app/navigation";
import { formatBytes } from "@/app/deployment-view";
import { createPlanPayment, getPublicPlans, type PublicPlan } from "@/lib/api";
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
  const saving = plan.monthly_price_cents > plan.renewal_price_cents
    ? Math.round((1 - plan.renewal_price_cents / plan.monthly_price_cents) * 100)
    : 0;

  return (
    <div className="mt-6 min-h-24">
      <div className="flex items-baseline gap-1.5">
        <span className="text-sm font-medium text-zinc-500">¥</span>
        <span className="text-4xl font-semibold leading-none tracking-normal text-white tabular-nums">{money(plan.renewal_price_cents)}</span>
        <span className="text-sm text-zinc-500">/ 月</span>
      </div>
      {isFree ? (
        <p className="mt-3 text-xs leading-5 text-zinc-500">永久免费，无需绑定支付方式</p>
      ) : (
        <p className="mt-3 text-xs leading-5 text-zinc-500">
          续费价格{saving ? `，相比月付节省 ${saving}%` : ""}
          {saving ? <span className="ml-1 text-zinc-600">· 月付 ¥{money(plan.monthly_price_cents)}</span> : null}
        </p>
      )}
    </div>
  );
}

export function PricingPage({ onNavigate, session }: { onNavigate: (path: string) => void; session: Session | null }) {
  const [activeProduct, setActiveProduct] = useState<(typeof productTabs)[number]["key"]>("hosting");
  const [plans, setPlans] = useState<PublicPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [payingPlan, setPayingPlan] = useState<string | null>(null);
  const [checkoutPlan, setCheckoutPlan] = useState<PublicPlan | null>(null);

  useEffect(() => {
    if (!checkoutPlan) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape" && !payingPlan) setCheckoutPlan(null); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [checkoutPlan, payingPlan]);

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

  const choosePlan = async (plan: PublicPlan, paymentMethod: "wallet" | "alipay") => {
    if (!session || plan.renewal_price_cents === 0) { onNavigate(startPath); return; }
    setPayingPlan(plan.key);
    setError("");
    try {
      const result = await createPlanPayment(plan.key, 1, paymentMethod);
      if ("payUrl" in result) {
        sessionStorage.setItem("kuaipage:pending-order-no", result.orderNo);
        window.location.assign(result.payUrl);
      } else {
        onNavigate(STUDIO_BILLING_PATH);
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "套餐购买失败";
      if (paymentMethod === "wallet" && message.includes("余额不足")) {
        setCheckoutPlan(null);
        onNavigate(STUDIO_WALLET_PATH);
      } else {
        setError(message);
      }
      setPayingPlan(null);
    }
  };

  return (
    <main className="min-h-dvh bg-black pb-20 pt-24 text-white">
      <header className={cn(CONTENT_TRACK_CLASS, "pb-8 pt-6 sm:pb-10 sm:pt-10")}>
        <div className="max-w-2xl">
          <h1 className="text-3xl font-semibold leading-tight tracking-normal text-white sm:text-4xl">套餐与价格</h1>
          <p className="mt-3 text-sm leading-6 text-zinc-400 sm:text-base">按当前需求选择，所有套餐均可随时升级。</p>
          {availableProductTabs.length > 1 ? (
          <div className="mt-5 inline-grid max-w-full rounded-md border border-white/15 bg-white/[0.04] p-1" role="tablist" aria-label="定价产品" style={{ gridTemplateColumns: `repeat(${availableProductTabs.length}, minmax(0, 1fr))` }}>
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

      <section className={CONTENT_TRACK_CLASS} aria-label="套餐列表">
        {loading ? <div className="flex min-h-72 items-center justify-center gap-3 text-zinc-400"><LoaderCircle className="h-5 w-5 animate-spin" />正在读取套餐</div> : null}
        {error ? <p className="border-b border-red-400/30 py-10 text-red-300" role="alert">{error}</p> : null}
        {!loading && !error ? (
          <div className="grid gap-px overflow-hidden rounded-md border border-white/15 bg-white/15 md:grid-cols-2 xl:grid-cols-4">
            {plans.map((plan) => {
              const recommended = plan.key === recommendedKey;
              const benefits = [
                `最多 ${plan.max_sites} 个站点`,
                `其中 ${plan.max_public_sites} 个公开站点`,
                `总存储 ${formatBytes(plan.max_storage_bytes)}`,
                `单站容量 ${formatBytes(plan.max_site_bytes)}`,
                `单次最多 ${plan.max_files.toLocaleString("zh-CN")} 个文件`,
                `每天 ${plan.max_deployments_per_day} 次部署`,
                `每站最多 ${plan.max_domains_per_site} 个域名`,
              ];
              return (
                <article key={plan.key} className="flex min-h-[38rem] flex-col bg-black px-5 py-6 sm:px-6">
                  <div className="flex min-h-7 items-center justify-between gap-3">
                    <p className="text-xs font-medium uppercase text-zinc-600">{plan.key}</p>
                    {recommended ? <span className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-300"><span className="h-1.5 w-1.5 rounded-full bg-white" />最受欢迎</span> : null}
                  </div>
                  <h2 className="mt-3 text-xl font-semibold tracking-normal text-white">{plan.label}</h2>
                  <PlanPrice plan={plan} />
                  {plan.renewal_price_cents === 0 ? <button className="mt-5 inline-flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-white/25 px-4 text-sm font-semibold" disabled={payingPlan !== null} onClick={() => onNavigate(startPath)} type="button">免费开始<ArrowRight className="h-4 w-4" /></button> : <button className="mt-5 inline-flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-md bg-white px-4 text-sm font-semibold text-black transition-colors hover:bg-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-50" disabled={payingPlan !== null} onClick={() => session ? setCheckoutPlan(plan) : onNavigate(startPath)} type="button">购买套餐<ArrowRight className="h-4 w-4" /></button>}
                  <div className="mt-7 border-t border-white/10 pt-5">
                    <p className="text-xs font-medium text-zinc-500">包含权益</p>
                  </div>
                  <ul className="mt-2 divide-y divide-white/[0.07] text-sm text-zinc-300">
                    {benefits.map((benefit) => (
                      <li className="flex min-h-10 items-center gap-2.5 py-2" key={benefit}><Check className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden="true" /><span>{benefit}</span></li>
                    ))}
                    {capabilityRows.map((row) => {
                      const included = Boolean(plan[row.key]);
                      return (
                        <li className={cn("flex min-h-10 items-center gap-2.5 py-2", !included && "text-zinc-600")} key={row.key}>
                          {included ? <Check className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden="true" /> : <Minus className="h-4 w-4 shrink-0 text-zinc-700" aria-hidden="true" />}
                          <span>{row.label}</span>
                          {!included ? <span className="ml-auto text-xs text-zinc-700">未包含</span> : null}
                        </li>
                      );
                    })}
                  </ul>
                </article>
              );
            })}
          </div>
        ) : null}
      </section>

      {checkoutPlan ? <div aria-labelledby="checkout-title" aria-modal="true" className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-0 sm:items-center sm:p-6" onMouseDown={(event) => { if (event.currentTarget === event.target && !payingPlan) setCheckoutPlan(null); }} role="dialog">
        <div className="w-full border border-white/15 bg-zinc-950 p-5 shadow-2xl sm:max-w-md sm:rounded-md sm:p-6">
          <div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold text-white" id="checkout-title">选择支付方式</h2><p className="mt-1 text-sm text-zinc-500">{checkoutPlan.label} · ¥{money(checkoutPlan.renewal_price_cents)} / 月</p></div><button aria-label="关闭" className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-40" disabled={payingPlan !== null} onClick={() => setCheckoutPlan(null)} type="button"><X className="h-4 w-4" /></button></div>
          <div className="mt-5 grid gap-2">
            <button autoFocus className="flex min-h-16 cursor-pointer items-center gap-3 rounded-md border border-white/15 px-4 text-left transition-colors hover:border-white/35 hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-50" disabled={payingPlan !== null} onClick={() => void choosePlan(checkoutPlan, "wallet")} type="button"><WalletCards className="h-5 w-5 shrink-0 text-emerald-400" /><span><span className="block text-sm font-semibold text-white">账户余额</span><span className="mt-1 block text-xs text-zinc-500">余额不足时可前往钱包充值</span></span>{payingPlan === checkoutPlan.key ? <LoaderCircle className="ml-auto h-4 w-4 animate-spin" /> : <ArrowRight className="ml-auto h-4 w-4 text-zinc-600" />}</button>
            <button className="flex min-h-16 cursor-pointer items-center gap-3 rounded-md border border-white/15 px-4 text-left transition-colors hover:border-white/35 hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-50" disabled={payingPlan !== null} onClick={() => void choosePlan(checkoutPlan, "alipay")} type="button"><CreditCard className="h-5 w-5 shrink-0 text-sky-400" /><span><span className="block text-sm font-semibold text-white">支付宝</span><span className="mt-1 block text-xs text-zinc-500">创建订单后前往支付宝完成付款</span></span><ArrowRight className="ml-auto h-4 w-4 text-zinc-600" /></button>
          </div>
        </div>
      </div> : null}

    </main>
  );
}
