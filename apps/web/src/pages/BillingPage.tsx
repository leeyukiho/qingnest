import { useEffect, useState } from "react";
import { ArrowRight, CreditCard, FileText, Loader2, ReceiptText, X } from "lucide-react";
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
import { cancelOrder, getOrders, type AccountProfile, type PaymentOrder } from "@/lib/api";

const orderStatus: Record<PaymentOrder["status"], string> = {
  pending: "等待支付", payment_failed: "创建支付失败", paid: "已到账", fulfilling: "正在开通",
  fulfilled: "已完成", fulfillment_failed: "开通失败，客服处理中", expired: "已超时",
  refund_pending: "退款处理中", refunded: "已退款", cancelled: "已取消",
};

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
  const [orders, setOrders] = useState<PaymentOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersError, setOrdersError] = useState("");
  const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    getOrders().then((data) => { if (active) setOrders(data); }).catch((cause) => { if (active) setOrdersError(cause instanceof Error ? cause.message : "订单加载失败"); }).finally(() => { if (active) setOrdersLoading(false); });
    return () => { active = false; };
  }, []);
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
                <span className="text-xs text-zinc-600">共 {orders.length} 笔</span>
              </div>
              {ordersLoading ? <div className="flex min-h-56 items-center justify-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" />正在读取订单</div> : null}
              {ordersError ? <p className="py-8 text-sm text-red-300">{ordersError}</p> : null}
              {!ordersLoading && orders.length ? <div className="divide-y divide-white/10">{orders.map((order) => <article className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_8rem_10rem] sm:items-center" key={order.id}><div><p className="text-sm font-medium text-zinc-200">{order.productName}</p><p className="mt-1 text-xs text-zinc-600">{order.orderNo} · {new Date(order.createdAt).toLocaleString("zh-CN")}</p>{order.status === "pending" ? <p className="mt-1 text-xs text-zinc-500">请在 {new Date(order.expiresAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} 前支付</p> : null}{order.failureMessage ? <p className="mt-1 text-xs text-amber-300">{order.failureMessage}</p> : null}</div><div className="text-sm tabular-nums text-zinc-300">¥{(order.amountCents / 100).toFixed(2)}{order.actualAmountCents !== null && order.actualAmountCents !== order.amountCents ? <span className="block text-xs text-zinc-600">实付 ¥{(order.actualAmountCents / 100).toFixed(2)}</span> : null}</div><div className="flex items-center justify-end gap-3"><span className="text-sm text-zinc-400">{orderStatus[order.status]}</span>{order.status === "pending" || order.status === "payment_failed" ? <button aria-label="取消订单" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 hover:bg-white/5 hover:text-white disabled:opacity-40" disabled={cancellingOrderId !== null} onClick={() => void handleCancelOrder(order.id)} title="取消订单" type="button">{cancellingOrderId === order.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}</button> : null}</div></article>)}</div> : null}
              {!ordersLoading && !ordersError && !orders.length ? <div className="flex min-h-56 flex-col items-center justify-center px-4 text-center">
                <span className="flex h-10 w-10 items-center justify-center rounded-md border border-white/10 bg-white/[0.03]"><FileText className="h-5 w-5 text-zinc-500" aria-hidden="true" /></span>
                <p className="mt-4 text-sm font-medium text-zinc-300">暂无订单</p>
                <p className="mt-1 text-xs text-zinc-600">订单功能上线后，付款记录和状态会显示在这里。</p>
                <button className="mt-4 inline-flex h-9 items-center gap-2 text-sm font-medium text-zinc-300 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60" onClick={() => onNavigate(STUDIO_DOMAIN_PURCHASE_PATH)} type="button">
                  浏览可租赁域名 <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </div> : null}
            </section>
          </main>
        </div>
      </section>
    </div>
  );
}
