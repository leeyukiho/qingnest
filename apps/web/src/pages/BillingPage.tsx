import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, ChevronRight, CreditCard, ExternalLink, FileText, Loader2, ReceiptText, WalletCards, X } from "lucide-react";
import { getPlanConfig } from "@qingnest/shared/config/platform";
import { StudioSidebar } from "@/app/StudioSidebar";
import { formatBytes } from "@/app/deployment-view";
import { getStudioOrderPath, PRICING_PATH, STUDIO_DOMAIN_PURCHASE_PATH, STUDIO_ORDERS_PATH } from "@/app/navigation";
import {
  STUDIO_CONTENT_SHELL_CLASS,
  STUDIO_HEADER_CLASS,
  STUDIO_MAIN_CLASS,
  STUDIO_PANEL_CLASS,
  STUDIO_SECTION_CLASS,
  STUDIO_TITLE_CLASS,
} from "@/app/ui";
import { cancelOrder, createWalletTopup, getOrder, getOrders, getWallet, type AccountProfile, type PaymentOrder, type WalletSummary } from "@/lib/api";

const orderStatus: Record<PaymentOrder["status"], string> = {
  pending: "等待支付", payment_failed: "创建支付失败", paid: "已到账", fulfilling: "正在开通",
  fulfilled: "已完成", fulfillment_failed: "开通失败，客服处理中", expired: "已超时",
  refund_pending: "退款处理中", refunded: "已退款", cancelled: "已取消",
};

const topupPresets = [5, 10, 20, 50, 100, 200];

const orderTypeLabel: Record<PaymentOrder["type"], string> = {
  plan_subscription: "套餐订阅",
  domain_rental: "域名购买",
  domain_renewal: "域名续费",
  wallet_topup: "余额充值",
};

export type BillingSection = "wallet" | "plan" | "orders" | "order-detail";

function percentage(current: number, limit: number) {
  if (limit <= 0) return 0;
  return Math.min(100, Math.round((current / limit) * 100));
}

export function BillingPage({
  account,
  onNavigate,
  orderId,
  section,
}: {
  account: AccountProfile | null;
  onNavigate: (path: string) => void;
  orderId?: string;
  section: BillingSection;
}) {
  const plan = account?.planConfig ?? getPlanConfig(account?.plan);
  const usage = account?.usage;
  const [orders, setOrders] = useState<PaymentOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(section === "orders");
  const [ordersError, setOrdersError] = useState("");
  const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(null);
  const [wallet, setWallet] = useState<WalletSummary | null>(null);
  const [topupYuan, setTopupYuan] = useState("50");
  const [topupBusy, setTopupBusy] = useState(false);
  const [orderDetail, setOrderDetail] = useState<PaymentOrder | null>(null);
  const normalizedTopupYuan = topupYuan.trim();
  const topupAmountYuan = Number(normalizedTopupYuan);
  const topupValidationError = !normalizedTopupYuan
    ? "请输入充值金额"
    : !/^\d+(?:\.\d{1,2})?$/.test(normalizedTopupYuan) || !Number.isFinite(topupAmountYuan)
      ? "请输入有效金额，最多保留两位小数"
      : topupAmountYuan < 5
        ? "单次充值不能低于 5 元"
        : topupAmountYuan > 1_000_000
          ? "单次充值不能超过 100 万元"
          : "";
  const topupAmountCents = topupValidationError ? 0 : Math.round(topupAmountYuan * 100);
  useEffect(() => {
    if (section !== "orders") return;
    let active = true;
    setOrdersLoading(true);
    getOrders().then((data) => { if (active) setOrders(data); }).catch((cause) => { if (active) setOrdersError(cause instanceof Error ? cause.message : "订单加载失败"); }).finally(() => { if (active) setOrdersLoading(false); });
    return () => { active = false; };
  }, [section]);
  useEffect(() => {
    if (section !== "order-detail" || !orderId) return;
    let active = true;
    setOrdersLoading(true);
    setOrdersError("");
    getOrder(orderId).then((data) => { if (active) setOrderDetail(data); }).catch((cause) => { if (active) setOrdersError(cause instanceof Error ? cause.message : "订单详情加载失败"); }).finally(() => { if (active) setOrdersLoading(false); });
    return () => { active = false; };
  }, [orderId, section]);
  useEffect(() => {
    if (section !== "wallet") return;
    void getWallet().then(setWallet).catch((cause) => setOrdersError(cause instanceof Error ? cause.message : "余额加载失败"));
  }, [section]);
  const handleTopup = async () => {
    if (topupValidationError) return;
    setTopupBusy(true); setOrdersError("");
    try { const checkout = await createWalletTopup(topupAmountCents); sessionStorage.setItem("kuaipage:pending-order-no", checkout.orderNo); window.location.assign(checkout.payUrl); }
    catch (cause) { setOrdersError(cause instanceof Error ? cause.message : "充值订单创建失败"); setTopupBusy(false); }
  };
  const handleCancelOrder = async (orderId: string) => {
    if (cancellingOrderId) return;
    setCancellingOrderId(orderId);
    setOrdersError("");
    try {
      const cancelled = await cancelOrder(orderId);
      setOrders((current) => current.map((order) => order.id === orderId ? cancelled : order));
    } catch (cause) {
      setOrdersError(cause instanceof Error ? cause.message : "取消订单失败");
    } finally {
      setCancellingOrderId(null);
    }
  };
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
  const pageMeta = {
    wallet: { title: "余额与充值", description: "管理账户余额，查看最近的资金变动。" },
    plan: { title: "套餐与用量", description: "查看当前套餐权益、资源配额和使用进度。" },
    orders: { title: "订单记录", description: "集中查看套餐、域名和余额充值订单。" },
    "order-detail": { title: "订单详情", description: "查看订单状态、金额和付款信息。" },
  }[section];

  return (
    <div className="min-h-dvh bg-black">
      <section className={STUDIO_SECTION_CLASS}>
        <div className={STUDIO_CONTENT_SHELL_CLASS}>
          <StudioSidebar account={account} active={section === "wallet" ? "wallet" : section === "orders" ? "orders" : "billing"} onNavigate={onNavigate} />
          <main className={STUDIO_MAIN_CLASS}>
            <header className={STUDIO_HEADER_CLASS}>
              <div>
                <h1 className={STUDIO_TITLE_CLASS}>{pageMeta.title}</h1>
                <p className="mt-2 text-sm text-zinc-500">{pageMeta.description}</p>
              </div>
            </header>

            {section === "wallet" ? <section className={`${STUDIO_PANEL_CLASS} mt-5 p-5 sm:p-6`} aria-labelledby="wallet-title">
              <div className="flex flex-wrap items-start justify-between gap-5"><div className="flex items-start gap-3"><WalletCards className="mt-0.5 h-5 w-5 text-emerald-400" /><div><p className="text-xs text-zinc-500">账户余额</p><h2 className="mt-1 text-2xl font-semibold tabular-nums text-white" id="wallet-title">¥{((wallet?.balanceCents ?? account?.walletBalanceCents ?? 0) / 100).toFixed(2)}</h2></div></div><div className="w-full max-w-md"><label className="grid gap-1.5 text-xs text-zinc-500" htmlFor="topup-amount">充值金额（元，最低 5 元）</label><div className="mt-1.5 flex gap-2"><input aria-describedby="topup-amount-hint" aria-invalid={Boolean(topupValidationError)} className="h-10 min-w-0 flex-1 rounded-md border border-white/15 bg-black px-3 text-sm text-white outline-none focus:border-white/35 aria-[invalid=true]:border-red-400/60" id="topup-amount" inputMode="decimal" max="1000000" min="5" onChange={(event) => setTopupYuan(event.target.value)} step="0.01" type="number" value={topupYuan} /><button className="inline-flex h-10 shrink-0 cursor-pointer items-center gap-2 rounded-md bg-white px-4 text-sm font-semibold text-black transition-colors hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-40" disabled={topupBusy || Boolean(topupValidationError)} onClick={() => void handleTopup()} type="button">{topupBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}支付宝充值</button></div><p className={`mt-2 min-h-5 text-xs ${topupValidationError ? "text-red-300" : "text-zinc-600"}`} id="topup-amount-hint" role={topupValidationError ? "alert" : undefined}>{topupValidationError || "支持充值 5 元至 100 万元，金额最多保留两位小数"}</p><div className="mt-1 grid grid-cols-6 gap-1.5" aria-label="充值金额快捷选项">{topupPresets.map((amount) => <button className={`h-8 cursor-pointer rounded-md border text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 ${topupYuan === String(amount) ? "border-white bg-white text-black" : "border-white/15 text-zinc-400 hover:border-white/35 hover:text-white"}`} key={amount} onClick={() => setTopupYuan(String(amount))} type="button">¥{amount}</button>)}</div></div></div>
              {ordersError ? <p className="mt-4 text-sm text-red-300" role="alert">{ordersError}</p> : null}
              {wallet?.ledger.length ? <div className="mt-5 divide-y divide-white/10 border-t border-white/10">{wallet.ledger.slice(0, 5).map((entry) => <div className="flex items-center justify-between gap-4 py-3 text-sm" key={entry.id}><div><p className="text-zinc-300">{entry.description}</p><p className="mt-1 text-xs text-zinc-600">{new Date(entry.created_at).toLocaleString("zh-CN")}</p></div><span className={entry.amount_cents > 0 ? "tabular-nums text-emerald-400" : "tabular-nums text-zinc-300"}>{entry.amount_cents > 0 ? "+" : ""}¥{(entry.amount_cents / 100).toFixed(2)}</span></div>)}</div> : null}
            </section> : null}

            {section === "plan" ? <section className={`${STUDIO_PANEL_CLASS} mt-5 p-5 sm:p-6`} aria-labelledby="plan-title">
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
            </section> : null}

            {section === "orders" ? <section className={`${STUDIO_PANEL_CLASS} mt-5 min-h-80 p-5 sm:p-6`} aria-labelledby="orders-title">
              <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-4">
                <div className="flex items-center gap-3">
                  <ReceiptText className="h-5 w-5 text-zinc-400" aria-hidden="true" />
                  <div>
                    <h2 className="text-base font-semibold text-white" id="orders-title">订单记录</h2>
                    <p className="mt-1 text-xs text-zinc-500">套餐与域名购买记录</p>
                  </div>
                </div>
                <span className="text-xs text-zinc-600">共 {orders.length} 笔</span>
              </div>
              {ordersLoading ? <div className="flex min-h-56 items-center justify-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" />正在读取订单</div> : null}
              {ordersError ? <p className="py-8 text-sm text-red-300">{ordersError}</p> : null}
              {!ordersLoading && orders.length ? <div className="divide-y divide-white/10">{orders.map((order) => <article className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_8rem_16rem] sm:items-center" key={order.id}><div><p className="text-sm font-medium text-zinc-200">{order.productName}</p><p className="mt-1 text-xs text-zinc-600">{order.orderNo} · {new Date(order.createdAt).toLocaleString("zh-CN")}</p>{order.status === "pending" ? <p className="mt-1 text-xs text-zinc-500">请在 {new Date(order.expiresAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} 前支付</p> : null}{order.failureMessage ? <p className="mt-1 text-xs text-amber-300">{order.failureMessage}</p> : null}</div><div className="text-sm tabular-nums text-zinc-300">¥{(order.amountCents / 100).toFixed(2)}{order.actualAmountCents !== null && order.actualAmountCents !== order.amountCents ? <span className="block text-xs text-zinc-600">实付 ¥{(order.actualAmountCents / 100).toFixed(2)}</span> : null}</div><div className="flex items-center justify-end gap-2"><span className="mr-1 text-sm text-zinc-400">{orderStatus[order.status]}</span>{order.payUrl ? <button className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md bg-white px-3 text-xs font-semibold text-black hover:bg-zinc-200" onClick={() => window.location.assign(order.payUrl!)} type="button">支付<ExternalLink className="h-3.5 w-3.5" /></button> : null}<button aria-label="查看订单详情" className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-md px-2 text-xs text-zinc-400 transition-colors hover:bg-white/5 hover:text-white" onClick={() => onNavigate(getStudioOrderPath(order.id))} type="button">详情<ChevronRight className="h-3.5 w-3.5" /></button>{order.status === "pending" || order.status === "payment_failed" ? <button aria-label="取消订单" className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-zinc-500 hover:bg-white/5 hover:text-white disabled:opacity-40" disabled={cancellingOrderId !== null} onClick={() => void handleCancelOrder(order.id)} title="取消订单" type="button">{cancellingOrderId === order.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}</button> : null}</div></article>)}</div> : null}
              {!ordersLoading && !ordersError && !orders.length ? <div className="flex min-h-56 flex-col items-center justify-center px-4 text-center">
                <span className="flex h-10 w-10 items-center justify-center rounded-md border border-white/10 bg-white/[0.03]"><FileText className="h-5 w-5 text-zinc-500" aria-hidden="true" /></span>
                <p className="mt-4 text-sm font-medium text-zinc-300">暂无订单</p>
                <p className="mt-1 text-xs text-zinc-600">订单功能上线后，付款记录和状态会显示在这里。</p>
                <button className="mt-4 inline-flex h-9 items-center gap-2 text-sm font-medium text-zinc-300 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60" onClick={() => onNavigate(STUDIO_DOMAIN_PURCHASE_PATH)} type="button">
                  浏览可租赁域名 <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </div> : null}
            </section> : null}

            {section === "order-detail" ? <section className={`${STUDIO_PANEL_CLASS} mt-5 min-h-80 p-5 sm:p-6`} aria-labelledby="order-detail-title">
              <button className="inline-flex h-9 cursor-pointer items-center gap-2 text-sm text-zinc-400 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60" onClick={() => onNavigate(STUDIO_ORDERS_PATH)} type="button"><ArrowLeft className="h-4 w-4" />返回订单记录</button>
              {ordersLoading ? <div className="flex min-h-56 items-center justify-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" />正在读取订单详情</div> : null}
              {ordersError ? <div className="py-12 text-center"><p className="text-sm text-red-300" role="alert">{ordersError}</p><button className="mt-4 text-sm text-zinc-400 hover:text-white" onClick={() => onNavigate(STUDIO_ORDERS_PATH)} type="button">返回订单记录</button></div> : null}
              {!ordersLoading && !ordersError && orderDetail ? <div className="mt-5">
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-5"><div><p className="text-xs text-zinc-500">{orderTypeLabel[orderDetail.type]}</p><h2 className="mt-2 text-xl font-semibold text-white" id="order-detail-title">{orderDetail.productName}</h2><p className="mt-2 font-mono text-xs text-zinc-600">{orderDetail.orderNo}</p></div><span className="rounded-md border border-white/15 px-3 py-1.5 text-sm text-zinc-300">{orderStatus[orderDetail.status]}</span></div>
                <dl className="grid sm:grid-cols-2">
                  <div className="border-b border-white/10 py-4 sm:pr-6"><dt className="text-xs text-zinc-600">订单金额</dt><dd className="mt-1 text-base font-medium tabular-nums text-white">¥{(orderDetail.amountCents / 100).toFixed(2)}</dd></div>
                  <div className="border-b border-white/10 py-4 sm:pl-6"><dt className="text-xs text-zinc-600">实际到账</dt><dd className="mt-1 text-base font-medium tabular-nums text-white">{orderDetail.actualAmountCents === null ? "-" : `¥${(orderDetail.actualAmountCents / 100).toFixed(2)}`}</dd></div>
                  <div className="border-b border-white/10 py-4 sm:pr-6"><dt className="text-xs text-zinc-600">创建时间</dt><dd className="mt-1 text-sm text-zinc-300">{new Date(orderDetail.createdAt).toLocaleString("zh-CN")}</dd></div>
                  <div className="border-b border-white/10 py-4 sm:pl-6"><dt className="text-xs text-zinc-600">支付截止</dt><dd className="mt-1 text-sm text-zinc-300">{new Date(orderDetail.expiresAt).toLocaleString("zh-CN")}</dd></div>
                  <div className="border-b border-white/10 py-4 sm:pr-6"><dt className="text-xs text-zinc-600">支付时间</dt><dd className="mt-1 text-sm text-zinc-300">{orderDetail.paidAt ? new Date(orderDetail.paidAt).toLocaleString("zh-CN") : "-"}</dd></div>
                  <div className="border-b border-white/10 py-4 sm:pl-6"><dt className="text-xs text-zinc-600">完成时间</dt><dd className="mt-1 text-sm text-zinc-300">{orderDetail.fulfilledAt ? new Date(orderDetail.fulfilledAt).toLocaleString("zh-CN") : "-"}</dd></div>
                </dl>
                {orderDetail.failureMessage ? <p className="mt-4 rounded-md border border-amber-400/20 bg-amber-400/[0.05] p-3 text-sm text-amber-300">{orderDetail.failureMessage}</p> : null}
                {orderDetail.payUrl ? <div className="mt-5 flex justify-end"><button className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md bg-white px-4 text-sm font-semibold text-black transition-colors hover:bg-zinc-200" onClick={() => window.location.assign(orderDetail.payUrl!)} type="button">继续支付<ExternalLink className="h-4 w-4" /></button></div> : null}
              </div> : null}
            </section> : null}
          </main>
        </div>
      </section>
    </div>
  );
}
