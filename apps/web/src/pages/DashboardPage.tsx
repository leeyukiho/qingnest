import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { Check, ChevronLeft, ChevronRight, ExternalLink, FileCheck2, Globe2, Loader2, Rocket, UploadCloud } from "lucide-react";
import { getPlanConfig } from "@qingnest/shared/config/platform";
import { StudioSidebar } from "@/app/StudioSidebar";
import { ToastMessage } from "@/app/toast";
import { formatBytes, getIssueClass, getRiskLabel, hasBlockingScanIssues } from "@/app/deployment-view";
import { StudioLoading } from "@/app/feedback";
import { STUDIO_PROJECTS_PATH } from "@/app/navigation";
import { STUDIO_CONTENT_SHELL_CLASS, STUDIO_HEADER_CLASS, STUDIO_MAIN_CLASS, STUDIO_PANEL_CLASS, STUDIO_SECTION_CLASS, STUDIO_TITLE_CLASS } from "@/app/ui";
import { FileUpload } from "@/components/ui/file-upload";
import { createSite, createUploadSession, getProject, uploadArchive, uploadFiles, type AccountProfile, type SiteDraft, type UploadArchiveResult } from "@/lib/api";
import { prepareProjectDeployment, type PreparedUploadFile, type SelectedUploadFile } from "@/lib/archive";
import { cn } from "@/lib/utils";

type Step = 1 | 2 | 3;
type PreparedProject = Awaited<ReturnType<typeof prepareProjectDeployment>>;

const steps = [
  { id: 1 as const, label: "创建项目", icon: Globe2 },
  { id: 2 as const, label: "上传资源", icon: UploadCloud },
  { id: 3 as const, label: "生成版本", icon: Rocket }
];

export function DashboardPage({ account, authReady, onNavigate, session }: {
  account: AccountProfile | null;
  authReady: boolean;
  onNavigate: (path: string) => void;
  session: Session | null;
}) {
  const [step, setStep] = useState<Step>(1);
  const [siteName, setSiteName] = useState("");
  const [site, setSite] = useState<SiteDraft | null>(null);
  const [files, setFiles] = useState<SelectedUploadFile[]>([]);
  const [prepared, setPrepared] = useState<PreparedProject | null>(null);
  const [result, setResult] = useState<UploadArchiveResult | null>(null);
  const [creating, setCreating] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const planName = account?.plan ?? "free";
  const plan = getPlanConfig(planName);
  const blocked = hasBlockingScanIssues(prepared?.scan ?? null);

  useEffect(() => {
    if (!session) return;
    const projectId = new URLSearchParams(window.location.search).get("project");
    if (!projectId) return;
    setRestoring(true);
    getProject(projectId)
      .then((project) => {
        setSite(project);
        setSiteName(project.name);
        setStep(2);
      })
      .catch(() => window.history.replaceState({}, "", "/studio"))
      .finally(() => setRestoring(false));
  }, [session]);

  async function createProject(event: React.FormEvent) {
    event.preventDefault();
    if (creating) return;
    setError(null);

    if (!siteName.trim()) return setError("请输入项目名称");
    setCreating(true);
    try {
      const created = await createSite({ name: siteName.trim() });
      setSite(created);
      setStep(2);
      window.history.replaceState({}, "", `/studio?project=${encodeURIComponent(created.id)}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "项目创建失败");
    } finally {
      setCreating(false);
    }
  }

  async function selectFiles(selected: File[]) {
    const selectedFiles = selected.map((file) => ({ file, path: file.webkitRelativePath || file.name }));
    setFiles(selectedFiles);
    setPrepared(null);
    setResult(null);
    setError(null);
    if (selectedFiles.length === 0) return;

    setAnalyzing(true);
    try {
      setPrepared(await prepareProjectDeployment(selectedFiles, planName));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法解析所选资源");
    } finally {
      setAnalyzing(false);
    }
  }

  async function deploy() {
    if (!site || !prepared || deploying || blocked) return;
    setDeploying(true);
    setError(null);
    try {
      const uploadSession = await createUploadSession({ siteId: site.id, scan: prepared.scan });
      if (uploadSession.status === "blocked") throw new Error("服务端检查未通过，请修正资源后重试");
      const deployed = prepared.kind === "archive"
        ? await uploadArchive({ uploadSessionId: uploadSession.uploadSessionId, deploymentId: uploadSession.deploymentId, archive: prepared.archive })
        : await uploadFiles({
            uploadSessionId: uploadSession.uploadSessionId,
            deploymentId: uploadSession.deploymentId,
            files: prepared.files.map((file: PreparedUploadFile) => ({ file: file.file, path: file.path }))
          });
      if (deployed.status === "blocked") throw new Error("版本生成被安全检查阻止，请根据诊断修正资源");
      setResult(deployed);
      setSite({ ...site, publicUrl: deployed.publicUrl, status: deployed.status });
      window.history.replaceState({}, "", "/studio");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "版本生成失败，请重试");
    } finally {
      setDeploying(false);
    }
  }

  if (!authReady || restoring) return <StudioLoading account={account} active="create" label={restoring ? "正在恢复创建进度" : "正在读取账号"} onNavigate={onNavigate} />;

  return (
    <div className="min-h-dvh bg-black">
      <section className={STUDIO_SECTION_CLASS}>
        <div className={STUDIO_CONTENT_SHELL_CLASS}>
          <StudioSidebar account={account} active="create" onNavigate={onNavigate} />
          <div className={STUDIO_MAIN_CLASS}>
            <div className={STUDIO_HEADER_CLASS}><h1 className={STUDIO_TITLE_CLASS}>新建项目</h1></div>

            <ol className="mt-5 grid grid-cols-3 border-b border-white/10" aria-label="创建进度">
              {steps.map((item) => {
                const Icon = item.icon;
                const complete = step > item.id || Boolean(result);
                const active = step === item.id && !result;
                return <li className={cn("flex min-w-0 items-center gap-2 border-b-2 px-2 py-4 sm:px-4", active ? "border-white text-white" : complete ? "border-white/30 text-zinc-300" : "border-transparent text-zinc-600")} key={item.id}>
                  <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs", active ? "border-white" : "border-white/15")}>{complete ? <Check className="h-3.5 w-3.5" /> : item.id}</span>
                  <Icon className="hidden h-4 w-4 sm:block" />
                  <span className="truncate text-sm font-medium">{item.label}</span>
                </li>;
              })}
            </ol>

            <ToastMessage message={error} />

            {step === 1 ? <form className={`${STUDIO_PANEL_CLASS} mt-5 max-w-3xl p-5 sm:p-6`} onSubmit={createProject}>
              <label className="grid max-w-xl gap-2 text-sm font-medium text-zinc-200">项目名称<input className="h-11 rounded-md border border-white/20 bg-black px-3 text-white outline-none transition-colors placeholder:text-zinc-600 focus:border-white/50" disabled={creating} maxLength={80} onChange={(event) => setSiteName(event.target.value)} placeholder="例如：个人作品集" value={siteName} /></label>
              <p className="mt-4 text-sm leading-6 text-zinc-500">项目创建后默认为仅自己可见。生成版本后，可以为它设置公开地址。</p>
              <button className="mt-6 inline-flex h-11 cursor-pointer items-center gap-2 rounded-md bg-white px-5 text-sm font-semibold text-black transition-colors hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50" disabled={creating || !siteName.trim()} type="submit">{creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4" />}{creating ? "正在创建" : "创建私人项目"}</button>
            </form> : null}

            {step === 2 && site ? <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_18rem]">
              <div className={`${STUDIO_PANEL_CLASS} p-5 sm:p-6`}>
                <FileUpload allowDirectories disabled={analyzing} files={files.map((item) => item.file)} multiple onChange={selectFiles} />
                {analyzing ? <div className="mt-4 flex items-center gap-2 text-sm text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" />正在解析资源</div> : null}
                {prepared ? <div className="mt-5">
                  <div className="grid gap-px overflow-hidden rounded-md border border-white/10 bg-white/10 sm:grid-cols-3">
                    {[["文件", `${prepared.scan.fileCount} 个`], ["大小", formatBytes(prepared.scan.totalBytes)], ["入口", prepared.scan.entrypoint ?? "未找到"]].map(([label, value]) => <div className="bg-black p-4" key={label}><p className="text-xs text-zinc-500">{label}</p><p className="mt-2 truncate text-sm font-medium text-white">{value}</p></div>)}
                  </div>
                  {prepared.sourceRoot ? <p className="mt-3 text-sm text-zinc-400">将使用 {prepared.sourceRoot}/ 作为发布目录</p> : null}
                  {prepared.scan.issues.length > 0 ? <div className="mt-4 grid gap-2">{prepared.scan.issues.map((issue) => <p className={cn("rounded-md border px-3 py-2 text-sm", getIssueClass(issue))} key={`${issue.code}-${issue.path ?? issue.message}`}>{issue.path ? `${issue.path}：` : ""}{issue.message}</p>)}</div> : null}
                </div> : null}
                <div className="mt-6 flex flex-wrap gap-3">
                  <button className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-white/15 px-4 text-sm text-zinc-300 hover:bg-white/5" onClick={() => onNavigate(STUDIO_PROJECTS_PATH)} type="button">稍后继续</button>
                  <button className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md bg-white px-4 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50" disabled={!prepared || blocked || analyzing} onClick={() => setStep(3)} type="button">确认资源<ChevronRight className="h-4 w-4" /></button>
                </div>
              </div>
              <aside className={`${STUDIO_PANEL_CLASS} h-fit p-5`}><p className="text-xs text-zinc-500">私人项目已创建</p><p className="mt-2 truncate text-sm font-semibold text-white">{site.name}</p><p className="mt-3 inline-flex items-center gap-2 text-sm text-zinc-400"><Globe2 className="h-4 w-4" />仅自己可见</p><p className="mt-5 border-t border-white/10 pt-4 text-sm leading-6 text-zinc-500">现在退出也不会丢失。版本生成后，可在项目详情中绑定或切换公开地址。</p></aside>
            </div> : null}

            {step === 3 && site && prepared ? <div className={`${STUDIO_PANEL_CLASS} mt-5 max-w-4xl p-5 sm:p-6`}>
              {result ? <div className="py-4 text-center"><span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-white/20"><Check className="h-5 w-5" /></span><h2 className="mt-4 text-xl font-semibold">私人版本已生成</h2><p className="mt-2 text-sm text-zinc-400">{result.fileCount} 个文件，{formatBytes(result.totalBytes)}。当前只有你可以访问。</p><div className="mt-6 flex flex-wrap justify-center gap-3"><button className="inline-flex h-10 cursor-pointer items-center rounded-md bg-white px-4 text-sm font-semibold text-black" onClick={() => onNavigate(`${STUDIO_PROJECTS_PATH}/${site.id}?tab=publishing`)} type="button">设置公开地址</button><button className="inline-flex h-10 cursor-pointer items-center rounded-md border border-white/15 px-4 text-sm text-zinc-300 hover:bg-white/5" onClick={() => onNavigate(`${STUDIO_PROJECTS_PATH}/${site.id}`)} type="button">查看项目概览</button><button className="inline-flex h-10 cursor-pointer items-center rounded-md border border-transparent px-4 text-sm text-zinc-500 hover:text-white" onClick={() => onNavigate(STUDIO_PROJECTS_PATH)} type="button">返回项目列表</button></div></div> : <>
                <div className="flex items-start gap-3"><FileCheck2 className="mt-0.5 h-5 w-5 text-zinc-400" /><div><h2 className="text-base font-semibold">生成版本确认</h2><p className="mt-1 text-sm text-zinc-500">{site.name} · {prepared.scan.fileCount} 个文件 · {formatBytes(prepared.scan.totalBytes)} · {getRiskLabel(prepared.scan.riskLevel)}</p></div></div>
                <div className="mt-5 grid gap-px overflow-hidden rounded-md border border-white/10 bg-white/10 sm:grid-cols-2"><div className="bg-black p-4"><p className="text-xs text-zinc-500">可见范围</p><p className="mt-2 text-sm text-white">仅自己可见</p></div><div className="bg-black p-4"><p className="text-xs text-zinc-500">入口文件</p><p className="mt-2 text-sm text-white">{prepared.scan.entrypoint}</p></div></div>
                <div className="mt-6 flex flex-wrap gap-3"><button className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-white/15 px-4 text-sm text-zinc-300 hover:bg-white/5" disabled={deploying} onClick={() => setStep(2)} type="button"><ChevronLeft className="h-4 w-4" />返回修改</button><button className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md bg-white px-5 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50" disabled={deploying} onClick={deploy} type="button">{deploying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}{deploying ? "正在生成" : "生成私人版本"}</button></div>
              </>}
            </div> : null}

            <p className="mt-5 text-xs text-zinc-600">单站点上限 {formatBytes(plan.quotas.site.maxSiteBytes)}，最多 {plan.quotas.deployment.maxFiles} 个文件，单文件上限 {formatBytes(plan.quotas.deployment.maxFileBytes)}</p>
          </div>
        </div>
      </section>
    </div>
  );
}
