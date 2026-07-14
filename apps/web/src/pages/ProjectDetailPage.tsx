import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { ExternalLink, Loader2, Save, UploadCloud } from "lucide-react";
import { StudioSidebar } from "@/app/StudioSidebar";
import { formatBytes, getStatusLabel, hasBlockingScanIssues } from "@/app/deployment-view";
import { StudioLoading } from "@/app/feedback";
import { STUDIO_CONTENT_SHELL_CLASS, STUDIO_HEADER_CLASS, STUDIO_MAIN_CLASS, STUDIO_PANEL_CLASS, STUDIO_SECTION_CLASS, STUDIO_TITLE_CLASS } from "@/app/ui";
import { FileUpload } from "@/components/ui/file-upload";
import { createUploadSession, getProject, updateProject, uploadArchive, uploadFiles, type AccountProfile, type ProjectDetail } from "@/lib/api";
import { prepareProjectDeployment, type PreparedUploadFile, type SelectedUploadFile } from "@/lib/archive";
import { cn } from "@/lib/utils";

type Tab = "overview" | "update" | "settings" | "deployments";

export function ProjectDetailPage({ account, authReady, onNavigate, session, siteId }: {
  account: AccountProfile | null;
  authReady: boolean;
  onNavigate: (path: string) => void;
  session: Session | null;
  siteId: string;
}) {
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [name, setName] = useState("");
  const [files, setFiles] = useState<SelectedUploadFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = () => getProject(siteId).then((data) => { setProject(data); setName(data.name); });
  useEffect(() => { if (session) refresh().catch((cause) => setError(cause instanceof Error ? cause.message : "项目加载失败")); }, [session, siteId]);

  async function saveName(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(null); setMessage(null);
    try { const updated = await updateProject(siteId, { name }); setProject(updated); setMessage("项目名称已保存"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "保存失败"); }
    finally { setBusy(false); }
  }

  async function publish(event: React.FormEvent) {
    event.preventDefault();
    if (!project || files.length === 0) return;
    setBusy(true); setError(null); setMessage("正在检查项目文件");
    try {
      const prepared = await prepareProjectDeployment(files, account?.plan ?? "free");
      if (hasBlockingScanIssues(prepared.scan)) throw new Error("项目检查未通过，请根据文件诊断修正后再上传");
      const uploadSession = await createUploadSession({ siteId: project.id, scan: prepared.scan });
      if (uploadSession.status === "blocked") throw new Error("服务端检查未通过");
      if (prepared.kind === "archive") {
        await uploadArchive({ uploadSessionId: uploadSession.uploadSessionId, deploymentId: uploadSession.deploymentId, archive: prepared.archive });
      } else {
        await uploadFiles({ uploadSessionId: uploadSession.uploadSessionId, deploymentId: uploadSession.deploymentId, files: prepared.files.map((file: PreparedUploadFile) => ({ file: file.file, path: file.path })) });
      }
      await refresh(); setFiles([]); setMessage("新版本已发布"); setTab("deployments");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "发布失败"); }
    finally { setBusy(false); }
  }

  if (!authReady || (session && !project && !error)) return <StudioLoading account={account} active="projects" label="正在读取项目" onNavigate={onNavigate} />;

  const tabs: Array<[Tab, string]> = [["overview", "项目详情"], ["update", "更新项目"], ["settings", "项目设置"], ["deployments", "部署记录"]];
  return (
    <div className="min-h-dvh bg-black">
      <section className={STUDIO_SECTION_CLASS}>
        <div className={STUDIO_CONTENT_SHELL_CLASS}>
          <StudioSidebar account={account} active="projects" onNavigate={onNavigate} />
          <div className={STUDIO_MAIN_CLASS}>
            <div className={STUDIO_HEADER_CLASS}>
              <h1 className={STUDIO_TITLE_CLASS}>{project?.name ?? "项目"}</h1>
              {project?.publicUrl ? <a className="inline-flex h-10 items-center gap-2 rounded-md border border-white/15 px-4 text-sm text-zinc-300 transition-colors hover:bg-white/5 hover:text-white" href={project.publicUrl} rel="noreferrer" target="_blank">访问站点<ExternalLink className="h-4 w-4" /></a> : null}
            </div>
            <div className="mt-5 flex gap-1 overflow-x-auto border-b border-white/10" role="tablist">
              {tabs.map(([value, label]) => <button aria-selected={tab === value} className={cn("cursor-pointer whitespace-nowrap border-b-2 px-4 py-3 text-sm transition-colors", tab === value ? "border-white text-white" : "border-transparent text-zinc-500 hover:text-zinc-200")} key={value} onClick={() => { setTab(value); setError(null); setMessage(null); }} role="tab" type="button">{label}</button>)}
            </div>

            {error ? <p className="mt-5 rounded-md border border-white/20 p-4 text-sm text-zinc-300">{error}</p> : null}
            {message ? <p className="mt-5 rounded-md border border-white/20 p-4 text-sm text-zinc-300">{message}</p> : null}

            {project && tab === "overview" ? <div className={`${STUDIO_PANEL_CLASS} mt-5 grid gap-px overflow-hidden bg-white/10 sm:grid-cols-2`}>
              {[["项目名称", project.name], ["发布状态", getStatusLabel(project.status)], ["平台域名", project.subdomain], ["最近更新", new Date(project.updatedAt).toLocaleString("zh-CN")]].map(([label, value]) => <div className="bg-black p-5" key={label}><p className="text-xs text-zinc-500">{label}</p><p className="mt-2 break-all text-sm font-medium text-zinc-100">{value}</p></div>)}
            </div> : null}

            {project && tab === "update" ? <form className={`${STUDIO_PANEL_CLASS} mt-5 p-5 sm:p-6`} onSubmit={publish}>
              <FileUpload allowDirectories disabled={busy} files={files.map((item) => item.file)} multiple onChange={(selected) => setFiles(selected.map((file) => ({ file, path: file.webkitRelativePath || file.name })))} />
              <button className="mt-5 inline-flex h-10 cursor-pointer items-center gap-2 rounded-md bg-white px-4 text-sm font-semibold text-black transition-colors hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50" disabled={busy || files.length === 0} type="submit">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}{busy ? "正在发布" : "发布新版本"}</button>
            </form> : null}

            {project && tab === "settings" ? <form className={`${STUDIO_PANEL_CLASS} mt-5 max-w-2xl p-5 sm:p-6`} onSubmit={saveName}>
              <label className="grid gap-2 text-sm text-zinc-300">项目名称<input className="h-11 rounded-md border border-white/20 bg-black px-3 text-white outline-none focus:border-white/50" maxLength={80} onChange={(event) => setName(event.target.value)} value={name} /></label>
              <button className="mt-5 inline-flex h-10 cursor-pointer items-center gap-2 rounded-md bg-white px-4 text-sm font-semibold text-black disabled:opacity-50" disabled={busy || !name.trim() || name.trim() === project.name} type="submit">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}保存</button>
            </form> : null}

            {project && tab === "deployments" ? <div className={`${STUDIO_PANEL_CLASS} mt-5 overflow-hidden`}>
              {project.deployments.length === 0 ? <p className="p-6 text-sm text-zinc-500">暂无部署记录</p> : project.deployments.map((deployment) => <div className="grid gap-3 border-b border-white/10 p-4 last:border-0 sm:grid-cols-[6rem_1fr_auto] sm:items-center" key={deployment.id}><p className="text-sm font-semibold text-white">版本 {deployment.version}</p><p className="text-sm text-zinc-500">{deployment.fileCount} 个文件 · {formatBytes(deployment.totalBytes)} · {new Date(deployment.createdAt).toLocaleString("zh-CN")}</p><span className="w-fit rounded-md border border-white/10 px-2 py-1 text-xs text-zinc-400">{getStatusLabel(deployment.status)}</span></div>)}
            </div> : null}
          </div>
        </div>
      </section>
    </div>
  );
}
