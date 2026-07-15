import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Bell, Check, Loader2, Mail } from "lucide-react";
import { acknowledgeNotification, getNotifications, type NotificationItem } from "@/lib/api";
import { cn } from "@/lib/utils";

const formatDate = (value: string) => new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));

export function NotificationCenter({ enabled }: { enabled: boolean }) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!enabled) return;
    try {
      setItems(await getNotifications());
    } catch {
      // The account shell remains usable if notifications are temporarily unavailable.
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) { setItems([]); setOpen(false); return; }
    void load();
    const timer = window.setInterval(load, 60_000);
    window.addEventListener("focus", load);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", load); };
  }, [enabled, load]);

  const pending = useMemo(() => [...items].reverse().find((item) => !item.acknowledgedAt) ?? null, [items]);
  const unreadCount = items.filter((item) => !item.acknowledgedAt).length;

  async function acknowledge() {
    if (!pending || busy) return;
    setBusy(true); setError(null);
    try {
      const result = await acknowledgeNotification(pending.id);
      setItems((current) => current.map((item) => item.id === pending.id ? { ...item, acknowledgedAt: result.acknowledgedAt } : item));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "确认失败，请重试");
    } finally { setBusy(false); }
  }

  if (!enabled) return null;
  const forcedDialog = pending ? <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 px-4 backdrop-blur-sm" role="alertdialog" aria-modal="true" aria-labelledby="notification-title">
    <section className="w-full max-w-md rounded-md border border-white/15 bg-zinc-950 p-5 shadow-2xl sm:p-6">
      <div className="flex h-10 w-10 items-center justify-center rounded-md bg-cyan-400/10 text-cyan-300"><Bell className="h-5 w-5" /></div>
      <p className="mt-5 text-xs font-semibold text-cyan-300">{pending.audience === "all" ? "平台公告" : "通知"}</p>
      <h2 className="mt-2 text-xl font-semibold text-white" id="notification-title">{pending.title}</h2>
      <p className="mt-3 max-h-[45vh] overflow-y-auto whitespace-pre-wrap break-words text-sm leading-7 text-zinc-300">{pending.body}</p>
      <p className="mt-4 text-xs text-zinc-600">{formatDate(pending.createdAt)}</p>
      {error ? <p className="mt-3 text-sm text-red-300" role="alert">{error}</p> : null}
      <button autoFocus className="mt-6 flex h-11 w-full items-center justify-center gap-2 rounded-md bg-white text-sm font-semibold text-black transition-colors hover:bg-zinc-200 disabled:cursor-wait disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300" disabled={busy} onClick={() => void acknowledge()} type="button">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}我已收到</button>
    </section>
  </div> : null;

  return <>
    <div className="relative z-[70]">
      <button aria-label="查看通知" className="relative flex h-10 w-10 items-center justify-center rounded-md border border-white/15 bg-zinc-950/95 text-zinc-300 shadow-xl backdrop-blur transition-colors hover:border-white/30 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70" onClick={() => setOpen((value) => !value)} type="button">
        <Bell className="h-4 w-4" />
        {unreadCount ? <span className="absolute -right-1 -top-1 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-4 text-white">{Math.min(unreadCount, 99)}</span> : null}
      </button>
      {open ? <section aria-label="通知列表" className="absolute right-0 mt-2 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-md border border-white/15 bg-zinc-950 shadow-2xl">
        <header className="flex h-12 items-center justify-between border-b border-white/10 px-4"><h2 className="text-sm font-semibold text-white">通知</h2><span className="text-xs text-zinc-500">{items.length} 条</span></header>
        <div className="max-h-[min(32rem,70vh)] overflow-y-auto">{items.length ? items.map((item) => <article className="border-b border-white/10 px-4 py-3 last:border-0" key={item.id}>
          <div className="flex items-start gap-3"><span className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md", item.acknowledgedAt ? "bg-white/5 text-zinc-600" : "bg-cyan-400/10 text-cyan-300")}>{item.acknowledgedAt ? <Check className="h-4 w-4" /> : <Mail className="h-4 w-4" />}</span><div className="min-w-0"><h3 className="text-sm font-medium text-zinc-100">{item.title}</h3><p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-zinc-400">{item.body}</p><p className="mt-2 text-xs text-zinc-600">{formatDate(item.createdAt)} · {item.audience === "all" ? "平台公告" : "发给你"}</p></div></div>
        </article>) : <p className="px-4 py-10 text-center text-sm text-zinc-600">暂无通知</p>}</div>
      </section> : null}
    </div>

    {forcedDialog && typeof document !== "undefined" ? createPortal(forcedDialog, document.body) : null}
  </>;
}
