import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Eye,
  File,
  FolderTree,
  Globe2,
  Link2,
  Loader2,
  Lock,
  Save,
  Trash2,
  UploadCloud,
} from "lucide-react";
import {
  getPlanConfig,
  validateSubdomain,
} from "@qingnest/shared/config/platform";
import { StudioSidebar } from "@/app/StudioSidebar";
import { StudioBreadcrumbTitle } from "@/app/StudioBreadcrumbTitle";
import { ConfirmDialog } from "@/app/ConfirmDialog";
import {
  formatBytes,
  getStatusLabel,
  hasBlockingScanIssues,
} from "@/app/deployment-view";
import { StudioLoading } from "@/app/feedback";
import {
  STUDIO_CONTENT_SHELL_CLASS,
  STUDIO_HEADER_CLASS,
  STUDIO_MAIN_CLASS,
  STUDIO_PANEL_CLASS,
  STUDIO_SECTION_CLASS,
} from "@/app/ui";
import { FileUpload } from "@/components/ui/file-upload";
import {
  createPrivatePreview,
  createPublicSlot,
  createUploadSession,
  deleteProject,
  getCachedProject,
  getCachedPublicSlots,
  getProject,
  listPublicSlots,
  switchPublicSlot,
  updateProject,
  uploadArchive,
  uploadFiles,
  type AccountProfile,
  type ProjectDetail,
  type PublicSlot,
} from "@/lib/api";
import {
  prepareProjectDeployment,
  type PreparedUploadFile,
  type SelectedUploadFile,
} from "@/lib/archive";
import { cn } from "@/lib/utils";
import { ToastMessage, useToast } from "@/app/toast";
import { STUDIO_PROJECTS_PATH } from "@/app/navigation";

type Tab = "overview" | "versions" | "publishing" | "settings";
type PreparedProjectDeployment = Awaited<
  ReturnType<typeof prepareProjectDeployment>
>;

export function ProjectDetailPage({
  account,
  authReady,
  onNavigate,
  session,
  siteId,
}: {
  account: AccountProfile | null;
  authReady: boolean;
  onNavigate: (path: string) => void;
  session: Session | null;
  siteId: string;
}) {
  const cachedProject = getCachedProject(siteId);
  const [project, setProject] = useState<ProjectDetail | null>(cachedProject);
  const [tab, setTab] = useState<Tab>(() => {
    const requested = new URLSearchParams(window.location.search).get("tab");
    return requested === "versions" ||
      requested === "publishing" ||
      requested === "settings"
      ? requested
      : "overview";
  });
  const [name, setName] = useState(cachedProject?.name ?? "");
  const [files, setFiles] = useState<SelectedUploadFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [prepared, setPrepared] = useState<PreparedProjectDeployment | null>(
    null,
  );
  const [slots, setSlots] = useState<PublicSlot[]>(
    getCachedPublicSlots() ?? [],
  );
  const [showBindReminder, setShowBindReminder] = useState(false);
  const [subdomain, setSubdomain] = useState("");
  const [publishingBusy, setPublishingBusy] = useState(false);
  const [confirmAction, setConfirmAction] = useState<
    { type: "bind" | "unbind"; slot: PublicSlot } | { type: "delete" } | null
  >(null);
  const { showToast } = useToast();

  const refresh = () =>
    Promise.all([getProject(siteId), listPublicSlots()]).then(
      ([data, publicSlots]) => {
        setProject(data);
        setName(data.name);
        setSlots(publicSlots);
      },
    );
  useEffect(() => {
    if (session)
      refresh().catch((cause) =>
        setError(cause instanceof Error ? cause.message : "项目加载失败"),
      );
  }, [session, siteId]);

  async function saveName(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const updated = await updateProject(siteId, { name });
      setProject(updated);
      showToast("项目名称已保存", "success");
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "保存失败", "error");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    let active = true;
    setPrepared(null);
    if (files.length === 0) {
      setChecking(false);
      return () => {
        active = false;
      };
    }

    setChecking(true);
    showToast("正在检查项目文件");
    prepareProjectDeployment(files, account?.plan ?? "free")
      .then((result) => {
        if (!active) return;
        setPrepared(result);
        showToast(
          hasBlockingScanIssues(result.scan)
            ? "项目文件检查未通过"
            : `检查完成：${result.scan.fileCount} 个文件，${formatBytes(result.scan.totalBytes)}`,
          hasBlockingScanIssues(result.scan) ? "error" : "success",
        );
      })
      .catch((cause) => {
        if (active)
          showToast(
            cause instanceof Error ? cause.message : "项目文件检查失败",
            "error",
          );
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, [account?.plan, files, showToast]);

  async function publish(event: React.FormEvent) {
    event.preventDefault();
    if (!project || !prepared || hasBlockingScanIssues(prepared.scan)) return;
    setBusy(true);
    try {
      const uploadSession = await createUploadSession({
        siteId: project.id,
        scan: prepared.scan,
      });
      if (uploadSession.status === "blocked")
        throw new Error("服务端检查未通过");
      if (prepared.kind === "archive") {
        await uploadArchive({
          uploadSessionId: uploadSession.uploadSessionId,
          deploymentId: uploadSession.deploymentId,
          archive: prepared.archive,
        });
      } else {
        await uploadFiles({
          uploadSessionId: uploadSession.uploadSessionId,
          deploymentId: uploadSession.deploymentId,
          files: prepared.files.map((file: PreparedUploadFile) => ({
            file: file.file,
            path: file.path,
          })),
        });
      }
      await refresh();
      setFiles([]);
      showToast("新版本已发布", "success");
      setShowBindReminder(!slots.some((slot) => slot.siteId === siteId));
      selectTab("versions");
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "发布失败", "error");
    } finally {
      setBusy(false);
    }
  }

  async function createAndBindSlot(event: React.FormEvent) {
    event.preventDefault();
    const validation = validateSubdomain(subdomain);
    if (!validation.ok)
      return showToast(validation.reason ?? "请输入可用的公开地址", "error");
    setPublishingBusy(true);
    try {
      await createPublicSlot({ siteId, subdomain: validation.normalized });
      await refresh();
      setSubdomain("");
      showToast("公开地址已绑定到当前项目", "success");
    } catch (cause) {
      showToast(
        cause instanceof Error ? cause.message : "公开地址创建失败",
        "error",
      );
    } finally {
      setPublishingBusy(false);
    }
  }

  async function bindSlot(slot: PublicSlot) {
    if (slot.siteId === siteId) return;
    if (slot.siteId) return setConfirmAction({ type: "bind", slot });
    await performBinding(slot, siteId);
  }

  async function performBinding(slot: PublicSlot, nextSiteId: string | null) {
    setPublishingBusy(true);
    try {
      await switchPublicSlot(slot.id, nextSiteId);
      await refresh();
      showToast(
        nextSiteId ? "公开地址已切换到当前项目" : "公开地址已解绑",
        "success",
      );
      setConfirmAction(null);
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "切换失败", "error");
    } finally {
      setPublishingBusy(false);
    }
  }

  async function unbindSlot(slot: PublicSlot) {
    setConfirmAction({ type: "unbind", slot });
  }

  async function removeProject() {
    setBusy(true);
    try {
      await deleteProject(siteId);
      showToast("项目已删除", "success");
      onNavigate(STUDIO_PROJECTS_PATH);
    } catch (cause) {
      showToast(
        cause instanceof Error ? cause.message : "项目删除失败",
        "error",
      );
      setConfirmAction(null);
    } finally {
      setBusy(false);
    }
  }

  async function previewPrivateProject() {
    const previewWindow = window.open("", "_blank");
    if (previewWindow) previewWindow.opener = null;
    setPublishingBusy(true);
    try {
      const preview = await createPrivatePreview(siteId);
      if (previewWindow) previewWindow.location.replace(preview.url);
      else window.location.assign(preview.url);
      showToast("私人预览链接将在 10 分钟后失效");
    } catch (cause) {
      previewWindow?.close();
      showToast(
        cause instanceof Error ? cause.message : "无法创建私人预览",
        "error",
      );
    } finally {
      setPublishingBusy(false);
    }
  }

  if (!authReady || (session && !project && !error))
    return (
      <StudioLoading
        account={account}
        active="projects"
        label="正在读取项目"
        onNavigate={onNavigate}
      />
    );

  function selectTab(nextTab: Tab) {
    setTab(nextTab);
    const url = new URL(window.location.href);
    if (nextTab === "overview") url.searchParams.delete("tab");
    else url.searchParams.set("tab", nextTab);
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
  }

  const tabs: Array<[Tab, string]> = [
    ["overview", "概览"],
    ["versions", "版本"],
    ["publishing", "域名与公开"],
    ["settings", "设置"],
  ];
  const currentSlot = slots.find((slot) => slot.siteId === siteId);
  const plan = getPlanConfig(account?.plan);
  const canPublish = Boolean(
    project?.deployments.some((deployment) => deployment.status === "active"),
  );
  return (
    <div className="min-h-dvh bg-black">
      <section className={STUDIO_SECTION_CLASS}>
        <div className={STUDIO_CONTENT_SHELL_CLASS}>
          <StudioSidebar
            account={account}
            active="projects"
            onNavigate={onNavigate}
          />
          <div className={STUDIO_MAIN_CLASS}>
            <div className={STUDIO_HEADER_CLASS}>
              <StudioBreadcrumbTitle backLabel="我的项目" currentLabel={project?.name ?? "项目"} onBack={() => onNavigate(STUDIO_PROJECTS_PATH)} />
              <div className="flex flex-wrap items-center gap-2">
                {project?.publicUrl ? (
                <a
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-white/15 px-4 text-sm text-zinc-300 transition-colors hover:bg-white/5 hover:text-white"
                  href={project.publicUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  访问站点
                  <ExternalLink className="h-4 w-4" />
                </a>
              ) : canPublish ? (
                <button
                  className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-white/15 px-4 text-sm text-zinc-300 transition-colors hover:bg-white/5 hover:text-white disabled:opacity-50"
                  disabled={publishingBusy}
                  onClick={previewPrivateProject}
                  type="button"
                >
                  {publishingBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                  私人预览
                </button>
              ) : (
                <span className="inline-flex h-10 items-center gap-2 rounded-md border border-white/10 px-4 text-sm text-zinc-500">
                  <Lock className="h-4 w-4" />
                  仅自己可见
                </span>
                )}
              </div>
            </div>
            <div
              className="mt-5 flex gap-1 overflow-x-auto border-b border-white/10"
              role="tablist"
            >
              {tabs.map(([value, label]) => (
                <button
                  aria-selected={tab === value}
                  className={cn(
                    "cursor-pointer whitespace-nowrap border-b-2 px-4 py-3 text-sm transition-colors",
                    tab === value
                      ? "border-white text-white"
                      : "border-transparent text-zinc-500 hover:text-zinc-200",
                  )}
                  key={value}
                  onClick={() => {
                    selectTab(value);
                    setError(null);
                  }}
                  role="tab"
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>

            <ToastMessage message={error} />

            {project && tab === "overview" ? (
              <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
                <div className={`${STUDIO_PANEL_CLASS} overflow-hidden`}>
                  <div className="p-5 sm:p-6">
                    <p className="text-xs font-medium text-zinc-500">
                      当前状态
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                      <span className="rounded-md border border-white/15 px-2.5 py-1 text-zinc-200">
                        {canPublish ? "版本已生成" : "尚无可用版本"}
                      </span>
                      <ArrowRight className="h-4 w-4 text-zinc-700" />
                      <span
                        className={cn(
                          "rounded-md border px-2.5 py-1",
                          currentSlot
                            ? "border-white/30 text-white"
                            : "border-white/10 text-zinc-500",
                        )}
                      >
                        {currentSlot ? "已公开" : "尚未公开"}
                      </span>
                    </div>
                    <p className="mt-4 text-sm leading-6 text-zinc-500">
                      {currentSlot
                        ? `访客可通过 ${currentSlot.hostname} 访问当前版本。`
                        : canPublish
                          ? "版本已准备好，绑定公开地址后访客即可访问。"
                          : "请先上传项目资源并生成第一个私人版本。"}
                    </p>
                    <div className="mt-5 flex flex-wrap gap-3">
                      <button
                        className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md bg-white px-4 text-sm font-semibold text-black"
                        onClick={() => selectTab("versions")}
                        type="button"
                      >
                        <UploadCloud className="h-4 w-4" />
                        {canPublish ? "发布新版本" : "上传项目资源"}
                      </button>
                      {canPublish && !currentSlot ? (
                        <button
                          className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-white/15 px-4 text-sm text-zinc-200 hover:bg-white/5"
                          onClick={() => selectTab("publishing")}
                          type="button"
                        >
                          <Globe2 className="h-4 w-4" />
                          设置公开地址
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <div className="grid gap-px border-t border-white/10 bg-white/10 sm:grid-cols-3">
                    {[
                      ["可见范围", currentSlot ? "公开访问" : "仅自己可见"],
                      ["公开地址", currentSlot?.hostname || "未绑定"],
                      [
                        "最近更新",
                        new Date(project.updatedAt).toLocaleString("zh-CN"),
                      ],
                    ].map(([label, value]) => (
                      <div className="bg-black p-4" key={label}>
                        <p className="text-xs text-zinc-500">{label}</p>
                        <p className="mt-2 break-all text-sm font-medium text-zinc-100">
                          {value}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
                <aside className={`${STUDIO_PANEL_CLASS} h-fit p-5`}>
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-sm font-semibold text-white">
                      最近版本
                    </h2>
                    <button
                      className="cursor-pointer text-xs text-zinc-500 hover:text-white"
                      onClick={() => selectTab("versions")}
                      type="button"
                    >
                      查看全部
                    </button>
                  </div>
                  {project.deployments.length === 0 ? (
                    <p className="mt-4 text-sm text-zinc-500">暂无版本记录</p>
                  ) : (
                    <div className="mt-3 grid gap-3">
                      {project.deployments.slice(0, 3).map((deployment) => (
                        <div
                          className="border-t border-white/10 pt-3 first:border-0 first:pt-0"
                          key={deployment.id}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-medium text-zinc-200">
                              版本 {deployment.version}
                            </p>
                            <span className="text-xs text-zinc-500">
                              {getStatusLabel(deployment.status)}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-zinc-600">
                            {new Date(deployment.createdAt).toLocaleString(
                              "zh-CN",
                            )}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </aside>
              </div>
            ) : null}

            {project && tab === "publishing" ? (
              <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_18rem]">
                <div className={`${STUDIO_PANEL_CLASS} p-5 sm:p-6`}>
                  <div className="flex items-start gap-3">
                    <Globe2 className="mt-0.5 h-5 w-5 text-zinc-400" />
                    <div>
                      <h2 className="text-base font-semibold text-white">
                        公开站点
                      </h2>
                      <p className="mt-1 text-sm leading-6 text-zinc-500">
                        选择一个地址即可公开当前项目；也可以把已有地址从其他项目切换到这里。
                      </p>
                    </div>
                  </div>
                  {!canPublish ? (
                    <p className="mt-5 rounded-md border border-white/10 px-4 py-3 text-sm text-zinc-400">
                      当前项目还没有可公开的版本。请先在“版本”中生成一个私人版本。
                    </p>
                  ) : null}
                  <div className="mt-5 grid gap-3">
                    {slots.map((slot) => (
                      <div
                        className="flex flex-col gap-3 rounded-md border border-white/10 p-4 sm:flex-row sm:items-center"
                        key={slot.id}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-zinc-100">
                            {slot.hostname}
                          </p>
                          <p className="mt-1 text-xs text-zinc-500">
                            {slot.siteId === siteId
                              ? "当前项目正在公开"
                              : slot.siteId
                                ? "正在展示其他项目"
                                : "空闲公开地址"}
                          </p>
                        </div>
                        {slot.siteId === siteId ? (
                          <>
                            <a
                              aria-label="访问公开站点"
                              className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-white/15 px-3 text-sm text-zinc-300 hover:bg-white/5"
                              href={slot.publicUrl}
                              rel="noreferrer"
                              target="_blank"
                            >
                              访问
                              <ExternalLink className="h-4 w-4" />
                            </a>
                            <button
                              className="inline-flex h-9 cursor-pointer items-center justify-center rounded-md border border-white/15 px-3 text-sm text-zinc-400 hover:bg-white/5"
                              disabled={publishingBusy}
                              onClick={() => unbindSlot(slot)}
                              type="button"
                            >
                              解绑
                            </button>
                          </>
                        ) : (
                          <button
                            className="inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md bg-white px-3 text-sm font-semibold text-black disabled:opacity-50"
                            disabled={!canPublish || publishingBusy}
                            onClick={() => bindSlot(slot)}
                            type="button"
                          >
                            <Link2 className="h-4 w-4" />
                            绑定当前项目
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  {slots.length < plan.quotas.user.maxPublicSites ? (
                    <form
                      className="mt-6 border-t border-white/10 pt-5"
                      onSubmit={createAndBindSlot}
                    >
                      <label className="grid gap-2 text-sm font-medium text-zinc-300">
                        创建新的公开地址
                        <div className="grid grid-cols-[minmax(0,1fr)_auto] overflow-hidden rounded-md border border-white/20 focus-within:border-white/50">
                          <input
                            className="h-11 min-w-0 bg-black px-3 text-white outline-none placeholder:text-zinc-600"
                            disabled={!canPublish || publishingBusy}
                            onChange={(event) =>
                              setSubdomain(event.target.value.toLowerCase())
                            }
                            placeholder="my-project"
                            value={subdomain}
                          />
                          <span className="inline-flex items-center border-l border-white/15 px-3 text-sm text-zinc-500">
                            .985201314.xyz
                          </span>
                        </div>
                      </label>
                      <button
                        className="mt-4 inline-flex h-10 cursor-pointer items-center gap-2 rounded-md bg-white px-4 text-sm font-semibold text-black disabled:opacity-50"
                        disabled={
                          !canPublish || publishingBusy || !subdomain.trim()
                        }
                        type="submit"
                      >
                        {publishingBusy ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Globe2 className="h-4 w-4" />
                        )}
                        创建并公开
                      </button>
                    </form>
                  ) : (
                    <p className="mt-6 border-t border-white/10 pt-5 text-sm text-zinc-500">
                      公开站点额度已用完。升级套餐或购买额外公开地址后，可以同时公开更多项目。
                    </p>
                  )}
                </div>
                <aside className={`${STUDIO_PANEL_CLASS} h-fit p-5`}>
                  <p className="text-xs text-zinc-500">公开站点额度</p>
                  <p className="mt-2 text-2xl font-semibold text-white">
                    {slots.length} / {plan.quotas.user.maxPublicSites}
                  </p>
                  <p className="mt-4 text-sm leading-6 text-zinc-500">
                    私人项目不占用公开额度。切换项目不会改变公开地址。
                  </p>
                  {currentSlot ? (
                    <p className="mt-4 border-t border-white/10 pt-4 text-xs text-zinc-400">
                      当前：{currentSlot.hostname}
                    </p>
                  ) : null}
                </aside>
              </div>
            ) : null}

            {project && tab === "versions" ? (
              <div className="mt-5 grid gap-5">
                <form
                  className={`${STUDIO_PANEL_CLASS} p-5 sm:p-6`}
                  onSubmit={publish}
                >
                  {showBindReminder ? (
                    <div className="mb-5 flex flex-col gap-3 rounded-md border border-white/20 bg-white/[0.04] p-4 sm:flex-row sm:items-center">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-white">
                          新版本目前仅自己可见
                        </p>
                        <p className="mt-1 text-sm text-zinc-400">
                          绑定公开地址后，其他人就能访问这个项目。
                        </p>
                      </div>
                      <button
                        className="inline-flex h-9 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md bg-white px-3 text-sm font-semibold text-black"
                        onClick={() => {
                          setShowBindReminder(false);
                          selectTab("publishing");
                        }}
                        type="button"
                      >
                        去绑定域名
                        <ArrowRight className="h-4 w-4" />
                      </button>
                    </div>
                  ) : null}
                  <div className="mb-5">
                    <h2 className="text-base font-semibold text-white">
                      发布新版本
                    </h2>
                    <p className="mt-1 text-sm text-zinc-500">
                      上传并检查资源后发布私人版本；是否对外公开由域名设置决定。
                    </p>
                  </div>
                  <FileUpload
                    allowDirectories
                    disabled={busy}
                    files={files.map((item) => item.file)}
                    multiple
                    onChange={(selected) =>
                      setFiles(
                        selected.map((file) => ({
                          file,
                          path: file.webkitRelativePath || file.name,
                        })),
                      )
                    }
                  />
                  {files.length > 0 ? (
                    <div className="mt-5 rounded-md border border-white/10 bg-white/[0.025] p-4">
                      <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
                        {checking ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : prepared &&
                          !hasBlockingScanIssues(prepared.scan) ? (
                          <CheckCircle2 className="h-4 w-4" />
                        ) : (
                          <AlertCircle className="h-4 w-4" />
                        )}
                        {checking
                          ? "正在检查项目文件"
                          : prepared && !hasBlockingScanIssues(prepared.scan)
                            ? "项目文件检查完成"
                            : "项目文件检查未通过"}
                      </div>
                      {prepared ? (
                        <>
                          <div className="mt-4 grid gap-px overflow-hidden rounded-md border border-white/10 bg-white/10 sm:grid-cols-3">
                            <div className="bg-black p-3">
                              <p className="text-xs text-zinc-500">文件数量</p>
                              <p className="mt-1 text-sm font-semibold text-white">
                                {prepared.scan.fileCount} 个
                              </p>
                            </div>
                            <div className="bg-black p-3">
                              <p className="text-xs text-zinc-500">项目大小</p>
                              <p className="mt-1 text-sm font-semibold text-white">
                                {formatBytes(prepared.scan.totalBytes)}
                              </p>
                            </div>
                            <div className="bg-black p-3">
                              <p className="text-xs text-zinc-500">入口文件</p>
                              <p className="mt-1 truncate text-sm font-semibold text-white">
                                {prepared.scan.entrypoint ?? "未找到"}
                              </p>
                            </div>
                          </div>
                          <div className="mt-4">
                            <p className="flex items-center gap-2 text-xs font-medium text-zinc-400">
                              <FolderTree className="h-3.5 w-3.5" />
                              项目结构
                            </p>
                            <div className="mt-2 grid gap-1.5">
                              {prepared.scan.files.slice(0, 8).map((item) => (
                                <p
                                  className="flex min-w-0 items-center gap-2 text-xs text-zinc-500"
                                  key={item.path}
                                >
                                  <File className="h-3 w-3 shrink-0" />
                                  <span className="truncate">{item.path}</span>
                                  <span className="ml-auto shrink-0">
                                    {formatBytes(item.size)}
                                  </span>
                                </p>
                              ))}
                            </div>
                            {prepared.scan.fileCount > 8 ? (
                              <p className="mt-2 text-xs text-zinc-600">
                                另有 {prepared.scan.fileCount - 8} 个文件
                              </p>
                            ) : null}
                          </div>
                          {prepared.scan.issues.length > 0 ? (
                            <div className="mt-4 grid gap-2">
                              {prepared.scan.issues
                                .slice(0, 4)
                                .map((issue, index) => (
                                  <p
                                    className="text-xs leading-5 text-zinc-400"
                                    key={`${issue.code}-${issue.path ?? index}`}
                                  >
                                    {issue.message}
                                    {issue.path ? ` · ${issue.path}` : ""}
                                  </p>
                                ))}
                            </div>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  ) : null}
                  <button
                    className="mt-5 inline-flex h-10 cursor-pointer items-center gap-2 rounded-md bg-white px-4 text-sm font-semibold text-black transition-colors hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={
                      busy ||
                      checking ||
                      !prepared ||
                      hasBlockingScanIssues(prepared.scan)
                    }
                    type="submit"
                  >
                    {busy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <UploadCloud className="h-4 w-4" />
                    )}
                    {busy ? "正在上传并发布" : checking ? "检查中" : "发布新版本"}
                  </button>
                </form>
                <div className={`${STUDIO_PANEL_CLASS} overflow-hidden`}>
                  <div className="border-b border-white/10 p-5">
                    <h2 className="text-base font-semibold text-white">
                      历史版本
                    </h2>
                    <p className="mt-1 text-sm text-zinc-500">
                      保留生成记录；已清理的历史资源不会占用存储额度。
                    </p>
                  </div>
                  {project.deployments.length === 0 ? (
                    <p className="p-6 text-sm text-zinc-500">暂无版本记录</p>
                  ) : (
                    project.deployments.map((deployment) => (
                      <div
                        className="grid gap-3 border-b border-white/10 p-4 last:border-0 sm:grid-cols-[6rem_1fr_auto] sm:items-center"
                        key={deployment.id}
                      >
                        <p className="text-sm font-semibold text-white">
                          版本 {deployment.version}
                        </p>
                        <p className="text-sm text-zinc-500">
                          {deployment.fileCount} 个文件 ·{" "}
                          {formatBytes(deployment.totalBytes)} ·{" "}
                          {new Date(deployment.createdAt).toLocaleString(
                            "zh-CN",
                          )}
                        </p>
                        <span className="w-fit rounded-md border border-white/10 px-2 py-1 text-xs text-zinc-400">
                          {getStatusLabel(deployment.status)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : null}

            {project && tab === "settings" ? (
              <div className="mt-5 grid gap-5">
                <form
                  className={`${STUDIO_PANEL_CLASS} p-5 sm:p-6`}
                  onSubmit={saveName}
                >
                  <label className="grid gap-2 text-sm text-zinc-300">
                    项目名称
                    <input
                      className="h-11 rounded-md border border-white/20 bg-black px-3 text-white outline-none focus:border-white/50"
                      maxLength={80}
                      onChange={(event) => setName(event.target.value)}
                      value={name}
                    />
                  </label>
                  <button
                    className="mt-5 inline-flex h-10 cursor-pointer items-center gap-2 rounded-md bg-white px-4 text-sm font-semibold text-black disabled:opacity-50"
                    disabled={
                      busy || !name.trim() || name.trim() === project.name
                    }
                    type="submit"
                  >
                    {busy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    保存
                  </button>
                </form>
                <section className="rounded-md border border-red-400/30 p-5 sm:p-6">
                  <h2 className="text-sm font-semibold text-white">危险操作</h2>
                  <p className="mt-2 text-sm leading-6 text-zinc-500">
                    删除项目会停止所有访问并删除项目记录；已租赁的域名会保留在你的账户中并自动解绑。
                  </p>
                  <button
                    className="mt-5 inline-flex h-10 items-center gap-2 rounded-md border border-red-400/40 px-4 text-sm font-semibold text-red-300 hover:bg-red-400/10"
                    onClick={() => setConfirmAction({ type: "delete" })}
                    type="button"
                  >
                    <Trash2 className="h-4 w-4" />
                    删除项目
                  </button>
                </section>
              </div>
            ) : null}
            <ConfirmDialog
              busy={busy || publishingBusy}
              confirmationText={confirmAction?.type === "delete" ? project?.name : undefined}
              confirmLabel={
                confirmAction?.type === "delete" ? "删除项目" : "确认操作"
              }
              description={
                confirmAction?.type === "delete"
                  ? `项目“${project?.name ?? ""}”将被永久删除，已租赁域名会保留并解绑。此操作无法撤销。`
                  : confirmAction?.type === "unbind"
                    ? `解绑后，${confirmAction.slot.hostname} 将暂时无法访问，但可立即绑定到其他项目。`
                    : confirmAction?.type === "bind"
                      ? `切换后，${confirmAction.slot.hostname} 的访客将看到当前项目，之后 24 小时内不能再次换绑或解绑。`
                      : ""
              }
              destructive={
                confirmAction?.type === "delete" ||
                confirmAction?.type === "unbind"
              }
              onCancel={() => setConfirmAction(null)}
              onConfirm={() => {
                if (confirmAction?.type === "delete") void removeProject();
                else if (confirmAction?.type === "unbind")
                  void performBinding(confirmAction.slot, null);
                else if (confirmAction?.type === "bind")
                  void performBinding(confirmAction.slot, siteId);
              }}
              open={confirmAction !== null}
              title={
                confirmAction?.type === "delete"
                  ? "确认删除项目"
                  : confirmAction?.type === "unbind"
                    ? "确认解绑域名"
                    : "确认切换绑定"
              }
            />
          </div>
        </div>
      </section>
    </div>
  );
}
