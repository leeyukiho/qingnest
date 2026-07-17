import { useCallback, useEffect, useState } from "react";
import { Bell, Check, Loader2, Mail } from "lucide-react";
import { StudioSidebar } from "@/app/StudioSidebar";
import { ToastMessage } from "@/app/toast";
import { STUDIO_CONTENT_SHELL_CLASS, STUDIO_HEADER_CLASS, STUDIO_MAIN_CLASS, STUDIO_PANEL_CLASS, STUDIO_SECTION_CLASS, STUDIO_TITLE_CLASS } from "@/app/ui";
import { acknowledgeNotification, getNotifications, type AccountProfile, type NotificationItem } from "@/lib/api";

const formatDate = (value: string) => new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));

function renderMarkdown(source: string) {
  return source.split(/\r?\n/).map((line, index) => {
    const content = line.replace(/\*\*(.+?)\*\*/g, "_$1_").replace(/`(.+?)`/g, "$1");
    if (/^#{1,3}\s/.test(line)) return <h3 className="mt-5 text-base font-semibold text-zinc-100 first:mt-0" key={index}>{content.replace(/^#{1,3}\s/, "")}</h3>;
    if (/^[-*]\s/.test(line)) return <li className="ml-5 list-disc text-zinc-300" key={index}>{content.replace(/^[-*]\s/, "")}</li>;
    if (!content.trim()) return <div className="h-3" key={index} />;
    return <p className="text-sm leading-7 text-zinc-300" key={index}>{content}</p>;
  });
}

export function NotificationsPage({ account, onNavigate }: { account: AccountProfile | null; onNavigate: (path: string) => void }) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<NotificationItem | null>(null);

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
      setSelected(null);
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
            <div className="min-w-0">
              <h1 className={STUDIO_TITLE_CLASS}>通知</h1>
              <p className="mt-2 text-sm text-zinc-500">查看平台公告和发送给你的消息。未读 {unreadCount} 条。</p>
            </div>
          </div>
          <ToastMessage message={error} />
          <div className="mt-6 space-y-3">
            {loading ? <div className={`${STUDIO_PANEL_CLASS} flex min-h-52 items-center justify-center gap-2 text-sm text-zinc-500`}><Loader2 className="h-4 w-4 animate-spin" />正在读取通知</div> : items.length ? items.map((item) => <article className={`${STUDIO_PANEL_CLASS} p-5 sm:p-6 ${item.acknowledgedAt ? "bg-transparent" : "bg-cyan-300/[0.025]"}`} key={item.id}>
              <div className="flex items-start gap-4">
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${item.acknowledgedAt ? "bg-white/5 text-zinc-600" : "bg-cyan-400/10 text-cyan-300"}`}>{item.acknowledgedAt ? <Check className="h-4 w-4" /> : <Mail className="h-4 w-4" />}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div><p className="text-xs font-medium text-zinc-500">{item.audience === "all" ? "平台公告" : "发给你"}</p><h2 className="mt-1 text-base font-semibold text-zinc-100">{item.title}</h2></div>
                    <div className="flex shrink-0 items-center gap-2 text-xs text-zinc-600">
                      {item.acknowledgedAt ? <span className="text-zinc-500">已读</span> : <span className="text-cyan-300">未读</span>}
                      <span>{formatDate(item.createdAt)}</span>
                    </div>
                  </div>
                  <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-white/10 pt-4">
                    <button className="inline-flex h-9 items-center justify-center rounded-md border border-white/15 px-3 text-sm font-medium text-zinc-200 transition-colors hover:border-white/35 hover:text-white" onClick={() => setSelected(item)} type="button">点击查看</button>
                  </div>
                </div>
              </div>
            </article>) : <div className={`${STUDIO_PANEL_CLASS} flex min-h-52 flex-col items-center justify-center text-center`}><Bell className="h-6 w-6 text-zinc-600" /><p className="mt-3 text-sm text-zinc-500">暂无通知</p></div>}
          </div>
        </div>
      </div>
    </section>
    {selected ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" onClick={() => { if (selected.acknowledgedAt) setSelected(null); }}><section className="flex max-h-[min(760px,calc(100dvh-2rem))] w-full max-w-2xl flex-col overflow-hidden rounded-md border border-white/15 bg-zinc-950 shadow-2xl" onClick={(event) => event.stopPropagation()}><div className="border-b border-white/10 px-5 py-4 sm:px-6"><p className="text-xs font-medium text-zinc-500">{selected.audience === "all" ? "平台公告" : "发给你"}</p><h2 className="mt-1 text-lg font-semibold text-white">{selected.title}</h2><p className="mt-1 text-xs text-zinc-600">{formatDate(selected.createdAt)}</p></div><div className="min-h-0 overflow-y-auto px-5 py-5 sm:px-6"><div className="space-y-1">{renderMarkdown(selected.body)}</div></div><div className="flex justify-end border-t border-white/10 px-5 py-4 sm:px-6"><button className="inline-flex h-9 items-center gap-2 rounded-md border border-white/15 px-3 text-sm text-zinc-300 transition-colors hover:border-white/30 hover:text-white disabled:cursor-wait disabled:opacity-50" disabled={busyId === selected.id} onClick={() => selected.acknowledgedAt ? setSelected(null) : void acknowledge(selected)} type="button">{busyId === selected.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{selected.acknowledgedAt ? "关闭" : "我已知道"}</button></div></section></div> : null}
  </div>;
}
