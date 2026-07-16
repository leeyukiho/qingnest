import { useCallback, useEffect, useState } from "react";
import { Bell, Check, Loader2, Mail } from "lucide-react";
import { StudioSidebar } from "@/app/StudioSidebar";
import { ToastMessage } from "@/app/toast";
import { STUDIO_CONTENT_SHELL_CLASS, STUDIO_HEADER_CLASS, STUDIO_MAIN_CLASS, STUDIO_PANEL_CLASS, STUDIO_SECTION_CLASS, STUDIO_TITLE_CLASS } from "@/app/ui";
import { acknowledgeNotification, getNotifications, type AccountProfile, type NotificationItem } from "@/lib/api";

const formatDate = (value: string) => new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));

export function NotificationsPage({ account, onNavigate }: { account: AccountProfile | null; onNavigate: (path: string) => void }) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await getNotifications());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "通知加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function acknowledge(item: NotificationItem) {
    if (item.acknowledgedAt || busyId) return;
    setBusyId(item.id);
    setError(null);
    try {
      const result = await acknowledgeNotification(item.id);
      setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, acknowledgedAt: result.acknowledgedAt } : candidate));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "确认失败，请重试");
    } finally {
      setBusyId(null);
    }
  }

  const unreadCount = items.filter((item) => !item.acknowledgedAt).length;

  return <div className="min-h-dvh bg-black">
    <section className={STUDIO_SECTION_CLASS}>
      <div className={STUDIO_CONTENT_SHELL_CLASS}>
        <StudioSidebar account={account} active="notifications" onNavigate={onNavigate} />
        <div className={STUDIO_MAIN_CLASS}>
          <div className={STUDIO_HEADER_CLASS}>
            <div>
              <h1 className={STUDIO_TITLE_CLASS}>通知</h1>
              <p className="mt-2 text-sm text-zinc-500">查看平台公告和发送给你的消息。未读 {unreadCount} 条。</p>
            </div>
          </div>
          <ToastMessage message={error} />
          <div className={`${STUDIO_PANEL_CLASS} mt-5 overflow-hidden`}>
            {loading ? <div className="flex min-h-52 items-center justify-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" />正在读取通知</div> : items.length ? items.map((item) => <article className="border-b border-white/10 p-5 last:border-0 sm:p-6" key={item.id}>
              <div className="flex items-start gap-4">
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${item.acknowledgedAt ? "bg-white/5 text-zinc-600" : "bg-cyan-400/10 text-cyan-300"}`}>{item.acknowledgedAt ? <Check className="h-4 w-4" /> : <Mail className="h-4 w-4" />}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div><p className="text-xs font-medium text-zinc-500">{item.audience === "all" ? "平台公告" : "发给你"}</p><h2 className="mt-1 text-base font-semibold text-zinc-100">{item.title}</h2></div>
                    <span className="shrink-0 text-xs text-zinc-600">{formatDate(item.createdAt)}</span>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-zinc-400">{item.body}</p>
                  {!item.acknowledgedAt ? <button className="mt-4 inline-flex h-9 items-center gap-2 rounded-md border border-white/20 px-3 text-sm font-medium text-zinc-200 transition-colors hover:border-white/35 hover:text-white disabled:cursor-wait disabled:opacity-50" disabled={busyId !== null} onClick={() => void acknowledge(item)} type="button">{busyId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}标记为已读</button> : null}
                </div>
              </div>
            </article>) : <div className="flex min-h-52 flex-col items-center justify-center text-center"><Bell className="h-6 w-6 text-zinc-600" /><p className="mt-3 text-sm text-zinc-500">暂无通知</p></div>}
          </div>
        </div>
      </div>
    </section>
  </div>;
}
