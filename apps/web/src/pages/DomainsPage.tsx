import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  ExternalLink,
  FolderKanban,
  Globe2,
  Link2,
  Loader2,
  ShoppingBag,
  Unplug,
} from "lucide-react";
import { StudioSidebar } from "@/app/StudioSidebar";
import { ToastMessage } from "@/app/toast";
import { StudioLoading } from "@/app/feedback";
import {
  STUDIO_DOMAIN_PURCHASE_PATH,
  STUDIO_PROJECTS_PATH,
} from "@/app/navigation";
import {
  STUDIO_CONTENT_SHELL_CLASS,
  STUDIO_HEADER_CLASS,
  STUDIO_MAIN_CLASS,
  STUDIO_PANEL_CLASS,
  STUDIO_SECONDARY_BUTTON_CLASS,
  STUDIO_SECTION_CLASS,
  STUDIO_TITLE_CLASS,
} from "@/app/ui";
import {
  getCachedProjects,
  getCachedPublicSlots,
  listProjects,
  listPublicSlots,
  switchPublicSlot,
  type AccountProfile,
  type ProjectSummary,
  type PublicSlot,
} from "@/lib/api";

export function DomainsPage({
  account,
  authReady,
  onNavigate,
  session,
}: {
  account: AccountProfile | null;
  authReady: boolean;
  onNavigate: (path: string) => void;
  session: Session | null;
}) {
  const cachedProjects = getCachedProjects();
  const cachedSlots = getCachedPublicSlots();
  const [projects, setProjects] = useState<ProjectSummary[]>(
    cachedProjects ?? [],
  );
  const [slots, setSlots] = useState<PublicSlot[]>(cachedSlots ?? []);
  const [loading, setLoading] = useState(!cachedProjects || !cachedSlots);
  const [error, setError] = useState<string | null>(null);
  const [bindingSlotId, setBindingSlotId] = useState<string | null>(null);
  const [editingSlot, setEditingSlot] = useState<PublicSlot | null>(null);
  const [pendingBinding, setPendingBinding] = useState<{
    slot: PublicSlot;
    siteId: string | null;
  } | null>(null);

  useEffect(() => {
    if (!session) return;
    Promise.all([listProjects(), listPublicSlots()])
      .then(([nextProjects, nextSlots]) => {
        setProjects(nextProjects);
        setSlots(nextSlots);
      })
      .catch((cause) =>
        setError(cause instanceof Error ? cause.message : "域名加载失败"),
      )
      .finally(() => setLoading(false));
  }, [session]);

  if (!authReady || (session && loading && slots.length === 0))
    return (
      <StudioLoading
        account={account}
        active="domains"
        label="正在读取域名"
        onNavigate={onNavigate}
      />
    );

  const projectsById = new Map(
    projects.map((project) => [project.id, project]),
  );
  const boundProjectIds = new Set(
    slots.flatMap((slot) => (slot.siteId ? [slot.siteId] : [])),
  );
  const bindableProjects = projects.filter(
    (project) =>
      !boundProjectIds.has(project.id) && project.status === "active",
  );

  async function changeBinding(slot: PublicSlot, siteId: string | null) {
    setBindingSlotId(slot.id);
    setError(null);
    try {
      const updatedSlot = await switchPublicSlot(slot.id, siteId);
      setSlots((current) =>
        current.map((item) => (item.id === slot.id ? updatedSlot : item)),
      );
      setEditingSlot(null);
      setPendingBinding(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "域名绑定失败");
    } finally {
      setBindingSlotId(null);
    }
  }

  return (
    <div className="min-h-dvh bg-black">
      <section className={STUDIO_SECTION_CLASS}>
        <div className={STUDIO_CONTENT_SHELL_CLASS}>
          <StudioSidebar
            account={account}
            active="domains"
            onNavigate={onNavigate}
          />
          <div className={STUDIO_MAIN_CLASS}>
            <div className={STUDIO_HEADER_CLASS}>
              <div>
                <h1 className={STUDIO_TITLE_CLASS}>域名</h1>
                <p className="mt-2 text-sm text-zinc-500">
                  管理已租赁和平台赠送的域名。绑定变更后 10 分钟内不能再次修改。
                </p>
              </div>
              <button
                className={STUDIO_SECONDARY_BUTTON_CLASS}
                onClick={() => onNavigate(STUDIO_DOMAIN_PURCHASE_PATH)}
                type="button"
              >
                <ShoppingBag className="h-4 w-4" />
                租赁新域名
              </button>
            </div>
            <ToastMessage message={error} />
            {slots.length === 0 ? (
              <div
                className={`${STUDIO_PANEL_CLASS} mt-5 flex min-h-64 flex-col items-center justify-center p-8 text-center`}
              >
                <Globe2 className="h-7 w-7 text-zinc-500" />
                <h2 className="mt-4 text-base font-semibold">还没有平台地址</h2>
                <p className="mt-2 max-w-md text-sm leading-6 text-zinc-500">
                  购买平台地址后，可以在这里直接选择项目进行绑定。
                </p>
                <button
                  className={`${STUDIO_SECONDARY_BUTTON_CLASS} mt-5`}
                  onClick={() => onNavigate(STUDIO_DOMAIN_PURCHASE_PATH)}
                  type="button"
                >
                  <ShoppingBag className="h-4 w-4" />
                  查看平台地址方案
                </button>
              </div>
            ) : (
              <div className={`${STUDIO_PANEL_CLASS} mt-5 overflow-hidden`}>
                {slots.map((slot) => {
                  const project = slot.siteId
                    ? projectsById.get(slot.siteId)
                    : null;
                  return (
                    <div
                      className="grid gap-4 border-b border-white/10 p-4 last:border-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center"
                      key={slot.id}
                    >
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 truncate text-sm font-semibold text-white">
                          <Globe2 className="h-4 w-4 shrink-0 text-zinc-400" />
                          {slot.hostname}
                        </p>
                        <p className="mt-1 text-xs text-zinc-500">
                          {slot.type === "custom_domain"
                            ? "自定义域名"
                            : "平台域名"}
                        </p>
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs text-zinc-600">绑定项目</p>
                        {project ? (
                          <button
                            className="mt-1 flex max-w-full cursor-pointer items-center gap-2 text-left text-sm text-zinc-200 hover:text-white"
                            onClick={() =>
                              onNavigate(
                                `${STUDIO_PROJECTS_PATH}/${project.id}`,
                              )
                            }
                            type="button"
                          >
                            <FolderKanban className="h-4 w-4 shrink-0" />
                            <span className="truncate">{project.name}</span>
                          </button>
                        ) : (
                          <div className="mt-1 flex min-w-0 items-center gap-2">
                            {bindingSlotId === slot.id ? (
                              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-zinc-400" />
                            ) : (
                              <Link2 className="h-4 w-4 shrink-0 text-zinc-500" />
                            )}
                            <select
                              aria-label={`为 ${slot.hostname} 选择绑定项目`}
                              className="h-9 min-w-0 max-w-full cursor-pointer rounded-md border border-white/15 bg-black px-2 text-sm text-zinc-200 outline-none focus:border-white/40 disabled:cursor-not-allowed disabled:text-zinc-600"
                              disabled={
                                bindingSlotId !== null ||
                                bindableProjects.length === 0
                              }
                              onChange={(event) => {
                                const siteId = event.target.value;
                                if (siteId) setPendingBinding({ slot, siteId });
                              }}
                              value=""
                            >
                              <option value="">
                                {bindableProjects.length > 0
                                  ? "选择未绑定项目"
                                  : "暂无可绑定项目"}
                              </option>
                              {bindableProjects.map((candidate) => (
                                <option key={candidate.id} value={candidate.id}>
                                  {candidate.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <a
                          className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-white/15 px-3 text-sm text-zinc-300 hover:bg-white/5"
                          href={slot.publicUrl}
                          rel="noreferrer"
                          target="_blank"
                        >
                          访问网站
                          <ExternalLink className="h-4 w-4" />
                        </a>
                        {project ? (
                          <button
                            className="inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md bg-white px-3 text-sm font-semibold text-black"
                            onClick={() => setEditingSlot(slot)}
                            type="button"
                          >
                            <Link2 className="h-4 w-4" />
                            换绑 / 解绑
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {editingSlot && !pendingBinding ? (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
                role="dialog"
                aria-modal="true"
              >
                <div className="w-full max-w-md rounded-md border border-white/20 bg-black p-5">
                  <h2 className="text-base font-semibold text-white">
                    管理绑定
                  </h2>
                  <p className="mt-2 break-all text-sm text-zinc-400">
                    {editingSlot.hostname}
                  </p>
                  <p className="mt-3 text-sm leading-6 text-zinc-500">
                    选择操作后还需要再次确认。每次变更后需等待 10
                    分钟才能再次修改。
                  </p>
                  <select
                    aria-label="选择新的绑定项目"
                    className="mt-4 h-10 w-full rounded-md border border-white/15 bg-black px-3 text-sm text-zinc-200 outline-none"
                    disabled={bindingSlotId !== null}
                    onChange={(event) => {
                      const siteId = event.target.value;
                      if (siteId)
                        setPendingBinding({ slot: editingSlot, siteId });
                    }}
                    value=""
                  >
                    <option value="">选择未绑定项目</option>
                    {bindableProjects.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.name}
                      </option>
                    ))}
                  </select>
                  <div className="mt-5 flex flex-wrap justify-between gap-2">
                    <button
                      className="inline-flex h-9 items-center gap-2 rounded-md border border-white/15 px-3 text-sm text-zinc-400 hover:bg-white/5"
                      disabled={bindingSlotId !== null}
                      onClick={() =>
                        setPendingBinding({ slot: editingSlot, siteId: null })
                      }
                      type="button"
                    >
                      <Unplug className="h-4 w-4" />
                      解绑当前项目
                    </button>
                    <button
                      className="h-9 rounded-md border border-white/15 px-3 text-sm text-zinc-300 hover:bg-white/5"
                      onClick={() => setEditingSlot(null)}
                      type="button"
                    >
                      取消
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
            {pendingBinding ? (
              <div
                className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
                role="alertdialog"
                aria-modal="true"
              >
                <div className="w-full max-w-md rounded-md border border-white/20 bg-black p-5">
                  <h2 className="text-base font-semibold text-white">
                    确认
                    {pendingBinding.siteId
                      ? pendingBinding.slot.siteId
                        ? "换绑"
                        : "绑定"
                      : "解绑"}
                  </h2>
                  <dl className="mt-4 grid gap-3 rounded-md border border-white/10 p-4 text-sm">
                    <div>
                      <dt className="text-xs text-zinc-600">平台地址</dt>
                      <dd className="mt-1 break-all text-zinc-200">
                        {pendingBinding.slot.hostname}
                      </dd>
                    </div>
                    {pendingBinding.slot.siteId ? (
                      <div>
                        <dt className="text-xs text-zinc-600">当前项目</dt>
                        <dd className="mt-1 text-zinc-200">
                          {projectsById.get(pendingBinding.slot.siteId)?.name ??
                            "未知项目"}
                        </dd>
                      </div>
                    ) : null}
                    <div>
                      <dt className="text-xs text-zinc-600">
                        {pendingBinding.siteId ? "目标项目" : "操作结果"}
                      </dt>
                      <dd className="mt-1 text-zinc-200">
                        {pendingBinding.siteId
                          ? (projectsById.get(pendingBinding.siteId)?.name ??
                            "未知项目")
                          : "平台地址将暂时无法访问"}
                      </dd>
                    </div>
                  </dl>
                  <p className="mt-4 text-sm leading-6 text-zinc-500">
                    确认后会立即生效，并在 10 分钟内禁止再次修改该地址的绑定。
                  </p>
                  <div className="mt-5 flex justify-end gap-2">
                    <button
                      className="h-9 rounded-md border border-white/15 px-3 text-sm text-zinc-300"
                      disabled={bindingSlotId !== null}
                      onClick={() => setPendingBinding(null)}
                      type="button"
                    >
                      返回
                    </button>
                    <button
                      className="inline-flex h-9 items-center gap-2 rounded-md bg-white px-3 text-sm font-semibold text-black disabled:opacity-50"
                      disabled={bindingSlotId !== null}
                      onClick={() =>
                        void changeBinding(
                          pendingBinding.slot,
                          pendingBinding.siteId,
                        )
                      }
                      type="button"
                    >
                      {bindingSlotId ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Link2 className="h-4 w-4" />
                      )}
                      确认操作
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
