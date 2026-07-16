import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, CircleAlert, Clock3, Loader2, ReceiptText } from "lucide-react";
import { StudioSidebar } from "@/app/StudioSidebar";
import { STUDIO_DOMAIN_PURCHASE_PATH, STUDIO_ORDERS_PATH } from "@/app/navigation";
import { STUDIO_CONTENT_SHELL_CLASS, STUDIO_HEADER_CLASS, STUDIO_MAIN_CLASS, STUDIO_PANEL_CLASS, STUDIO_SECTION_CLASS, STUDIO_TITLE_CLASS } from "@/app/ui";
import { getOrderByNumber, type AccountProfile, type PaymentOrder } from "@/lib/api";

const terminalStatuses = new Set<PaymentOrder["status"]>(["fulfilled", "fulfillment_failed", "expired", "payment_failed", "refunded", "cancelled"]);

export function PaymentResultPage({ account, onNavigate, search }: { account: AccountProfile | null; onNavigate: (path: string) => void; search: string }) {
  const orderNo = useMemo(() => new URLSearchParams(search).get("orderNo") ?? new URLSearchParams(search).get("mchOrderNo") ?? sessionStorage.getItem("kuaipage:pending-order-no") ?? "", [search]);
  const [order, setOrder] = useState<PaymentOrder | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!orderNo) { setError("没有找到本次支付订单，请到订单记录中查看。"); return; }
    let active = true;
    let timer: number | null = null;
    let attempts = 0;
    const refresh = async () => {
      try {
        const next = await getOrderByNumber(orderNo);
        if (!active) return;
        setOrder(next);
        setError("");
        if (next.status === "fulfilled") sessionStorage.removeItem("kuaipage:pending-order-no");
        if (!terminalStatuses.has(next.status) && attempts < 40) {
          attempts += 1;
          timer = window.setTimeout(refresh, attempts < 10 ? 2_000 : 5_000);
        }
      } catch (cause) {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : "订单状态查询失败");
        if (attempts < 12) { attempts += 1; timer = window.setTimeout(refresh, 5_000); }
      }
    };
    void refresh();
    return () => { active = false; if (timer !== null) window.clearTimeout(timer); };
  }, [orderNo]);

  const fulfilled = order?.status === "fulfilled";
  const failed = order && ["fulfillment_failed", "payment_failed", "expired", "cancelled"].includes(order.status);
  return <div className="min-h-dvh bg-black"><section className={STUDIO_SECTION_CLASS}><div className={STUDIO_CONTENT_SHELL_CLASS}>
    <StudioSidebar account={account} active="orders" onNavigate={onNavigate} />
    <main className={STUDIO_MAIN_CLASS}><header className={STUDIO_HEADER_CLASS}><div><h1 className={STUDIO_TITLE_CLASS}>支付结果</h1><p className="mt-2 text-sm text-zinc-500">支付宝到账后会自动更新，无需重复付款。</p></div></header>
      <section className={`${STUDIO_PANEL_CLASS} mt-5 p-6 sm:p-8`}>
        <div className="flex items-start gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-white/15">
            {fulfilled ? <CheckCircle2 className="h-6 w-6 text-emerald-400" /> : failed || error ? <CircleAlert className="h-6 w-6 text-amber-300" /> : order?.paidAt ? <Clock3 className="h-6 w-6 text-cyan-300" /> : <Loader2 className="h-6 w-6 animate-spin text-zinc-300" />}
          </span>
          <div><h2 className="text-lg font-semibold text-white">{fulfilled ? "支付成功，权益已生效" : failed ? "订单需要处理" : order?.paidAt ? "已到账，正在开通权益" : "正在确认支付宝到账"}</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-500">{error || order?.failureMessage || (order ? `${order.productName} · 订单 ${order.orderNo}` : "请保留当前页面，系统正在查询本地订单状态。")}</p></div>
        </div>
        {order ? <dl className="mt-6 grid gap-3 border-t border-white/10 pt-5 text-sm sm:grid-cols-3"><div><dt className="text-xs text-zinc-600">应付金额</dt><dd className="mt-1 text-zinc-200">¥{(order.amountCents / 100).toFixed(2)}</dd></div><div><dt className="text-xs text-zinc-600">支付宝实际金额</dt><dd className="mt-1 text-zinc-200">{order.actualAmountCents === null ? "等待到账" : `¥${(order.actualAmountCents / 100).toFixed(2)}`}</dd></div><div><dt className="text-xs text-zinc-600">订单状态</dt><dd className="mt-1 text-zinc-200">{order.status}</dd></div></dl> : null}
        <div className="mt-7 flex flex-wrap gap-3"><button className="inline-flex h-10 items-center gap-2 rounded-md bg-white px-4 text-sm font-semibold text-black" onClick={() => onNavigate(STUDIO_ORDERS_PATH)} type="button"><ReceiptText className="h-4 w-4" />查看订单</button>{order?.type.includes("domain") ? <button className="h-10 rounded-md border border-white/15 px-4 text-sm text-zinc-300" onClick={() => onNavigate(STUDIO_DOMAIN_PURCHASE_PATH)} type="button">返回域名服务</button> : null}</div>
      </section>
    </main></div></section></div>;
}
