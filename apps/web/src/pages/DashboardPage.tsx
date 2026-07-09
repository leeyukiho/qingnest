import { useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  Check,
  Crown,
  Globe2,
  LayoutDashboard,
  Loader2,
  LogIn,
  Plus,
  ScanSearch,
  UploadCloud,
} from "lucide-react";
import {
  checkSubdomain,
  createSite,
  createUploadSession,
  uploadArchive,
  uploadFiles,
  type AccountProfile,
  type SiteDraft,
  type SubdomainCheck,
  type UploadArchiveResult
} from "@/lib/api";
import { getPlanConfig, validateSubdomain } from "@qingnest/shared/config/platform";
import type { DeploymentScanResult } from "@qingnest/shared/deployment/types";
import { isAcceptedArchive, prepareProjectDeployment, type PreparedUploadFile, type SelectedUploadFile } from "@/lib/archive";
import { FileUpload } from "@/components/ui/file-upload";
import { AuroraHero } from "@/components/ui/hero-2";
import { HoverBorderGradient } from "@/components/ui/hover-border-gradient";
import { StudioSidebar } from "@/app/StudioSidebar";
import { STUDIO_ADMIN_PATH } from "@/app/navigation";
import {
  CONTENT_TRACK_CLASS,
  PRIMARY_CTA_BUTTON_CLASS,
  STUDIO_CONTENT_SHELL_CLASS,
  STUDIO_SECTION_CLASS
} from "@/app/ui";
import {
  clampPercent,
  formatBytes,
  getPlanDisplayName,
  getRiskLabel,
  getStatusLabel,
  hasBlockingScanIssues
} from "@/app/deployment-view";
import { LoadingScreen } from "@/app/feedback";
import { cn } from "@/lib/utils";

export function DashboardPage({
  account,
  authReady,
  onNavigate,
  session
}: {
  account: AccountProfile | null;
  authReady: boolean;
  onNavigate: (path: string) => void;
  session: Session | null;
}) {
  type CreateSiteStage = "idle" | "checking_domain" | "checking_project" | "creating_site" | "uploading" | "complete" | "blocked";

  const [siteName, setSiteName] = useState("");
  const [subdomain, setSubdomain] = useState("");
  const [availability, setAvailability] = useState<SubdomainCheck | null>(null);
  const [createdSite, setCreatedSite] = useState<SiteDraft | null>(null);
  const [archiveFile, setArchiveFile] = useState<File | null>(null);
  const [projectFiles, setProjectFiles] = useState<SelectedUploadFile[]>([]);
  const [deploymentScan, setDeploymentScan] = useState<DeploymentScanResult | null>(null);
  const [deploymentSourceRoot, setDeploymentSourceRoot] = useState<string | null>(null);
  const [publishResult, setPublishResult] = useState<UploadArchiveResult | null>(null);
  const [createStage, setCreateStage] = useState<CreateSiteStage>("idle");
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scanHasBlockingIssues = hasBlockingScanIssues(deploymentScan);
  const subdomainValidation = useMemo(() => {
    return subdomain.trim() ? validateSubdomain(subdomain) : null;
  }, [subdomain]);
  const localDomainProblem = subdomainValidation && !subdomainValidation.ok ? subdomainValidation.reason : null;
  const localDomainReviewHint =
    subdomainValidation?.ok && subdomainValidation.requiresReview ? "命中敏感词，提交后可能进入人工审核。" : null;

  const planName = account?.plan ?? "free";
  const planConfig = getPlanConfig(planName);
  const planDisplayName = getPlanDisplayName(planName);
  const siteSizeLimit = planConfig.quotas.site.maxSiteBytes;
  const fileLimit = planConfig.quotas.deployment.maxFiles;
  const sizeUsagePercent = deploymentScan ? (deploymentScan.totalBytes / siteSizeLimit) * 100 : 0;
  const fileUsagePercent = deploymentScan ? (deploymentScan.fileCount / fileLimit) * 100 : 0;
  const isBusy = creating;
  const currentStageIndex: Record<CreateSiteStage, number> = {
    idle: -1,
    checking_domain: 0,
    checking_project: 1,
    creating_site: 2,
    uploading: 2,
    complete: 3,
    blocked: 1
  };
  const stageIndex = currentStageIndex[createStage];
  const quotaMeters = [
    {
      exceeded: deploymentScan ? deploymentScan.totalBytes > siteSizeLimit : false,
      label: "站点大小",
      percent: sizeUsagePercent,
      text: deploymentScan ? `${formatBytes(deploymentScan.totalBytes)} / ${formatBytes(siteSizeLimit)}` : `0 B / ${formatBytes(siteSizeLimit)}`
    },
    {
      exceeded: deploymentScan ? deploymentScan.fileCount > fileLimit : false,
      label: "文件数量",
      percent: fileUsagePercent,
      text: deploymentScan ? `${deploymentScan.fileCount} / ${fileLimit}` : `0 / ${fileLimit}`
    }
  ];
  const progressSteps = [
    {
      detail: availability
        ? availability.available
          ? `${availability.normalized} 可用`
          : availability.reason ?? "域名不可用"
        : localDomainProblem ?? localDomainReviewHint ?? "提交后先确认域名是否可用",
      icon: Globe2,
      state:
        availability?.available === false || localDomainProblem
          ? "failed"
          : stageIndex > 0 || createStage === "complete"
            ? "done"
            : createStage === "checking_domain"
              ? "active"
              : "idle",
      title: "检查域名"
    },
    {
      detail: deploymentScan
        ? `${deploymentScan.fileCount} 个文件，${formatBytes(deploymentScan.totalBytes)}`
        : "域名通过后解析 ZIP 并计算项目体积",
      icon: ScanSearch,
      state:
        createStage === "blocked"
          ? "failed"
          : stageIndex > 1 || createStage === "complete"
            ? "done"
            : createStage === "checking_project"
              ? "active"
              : "idle",
      title: "检查项目"
    },
    {
      detail: publishResult
        ? getStatusLabel(publishResult.status)
        : createdSite
          ? createdSite.publicUrl
          : "检查通过后创建站点并上传文件",
      icon: UploadCloud,
      state: createStage === "complete" ? "done" : createStage === "creating_site" || createStage === "uploading" ? "active" : "idle",
      title: "创建发布"
    }
  ];

  function resetOutput() {
    setAvailability(null);
    setCreatedSite(null);
    setDeploymentScan(null);
    setDeploymentSourceRoot(null);
    setPublishResult(null);
    setCreateStage("idle");
  }

  async function handleCreateSite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);
    resetOutput();

    if (!subdomain.trim()) {
      setError("请输入子域名。");
      return;
    }

    const validation = validateSubdomain(subdomain);
    if (!validation.ok) {
      const reason = validation.reason ?? "子域名格式不符合要求。";
      setAvailability({
        available: false,
        normalized: validation.normalized,
        reason
      });
      setError(reason);
      return;
    }

    if (projectFiles.length === 0) {
      setError("请上传包含 index.html 的文件夹、文件或 ZIP。");
      return;
    }

    setCreating(true);
    try {
      setCreateStage("checking_domain");
      const domainResult = await checkSubdomain(validation.normalized);
      setAvailability(domainResult);

      if (!domainResult.available) {
        setCreateStage("idle");
        setError(domainResult.reason ?? "域名不可用，请换一个再试。");
        return;
      }

      setCreateStage("checking_project");
      setMessage("域名可用，正在检查项目文件。");
      const prepared = await prepareProjectDeployment(projectFiles, planName);
      setDeploymentScan(prepared.scan);
      setDeploymentSourceRoot(prepared.sourceRoot);

      if (hasBlockingScanIssues(prepared.scan)) {
        setCreateStage("blocked");
        setError("项目检查未通过：存在超过额度或阻断发布的问题。");
        return;
      }

      setCreateStage("creating_site");
      const site = await createSite({
        name: siteName.trim() || "未命名站点",
        subdomain: domainResult.normalized
      });
      setCreatedSite(site);

      setCreateStage("uploading");
      const uploadSession = await createUploadSession({
        siteId: site.id,
        scan: prepared.scan
      });

      if (uploadSession.status === "blocked") {
        setCreateStage("blocked");
        setError("服务端检查阻止了这个项目，请修正后重新上传。");
        return;
      }

      const result =
        prepared.kind === "archive"
          ? await uploadArchive({
              uploadSessionId: uploadSession.uploadSessionId,
              deploymentId: uploadSession.deploymentId,
              archive: prepared.archive
            })
          : await uploadFiles({
              uploadSessionId: uploadSession.uploadSessionId,
              deploymentId: uploadSession.deploymentId,
              files: prepared.files.map((file: PreparedUploadFile) => ({
                file: file.file,
                path: file.path
              }))
            });

      setPublishResult(result);
      setCreatedSite({
        ...site,
        publicUrl: result.publicUrl,
        status: result.status === "blocked" ? "pending_review" : result.status
      });
      setCreateStage("complete");
      setMessage(result.status === "active" ? "站点已创建并发布。" : "站点已创建，正在等待审核。");
    } catch (createError) {
      const text = createError instanceof Error ? createError.message : "创建失败";
      setCreateStage("idle");
      setError(text);
    } finally {
      setCreating(false);
    }
  }

  function handleSelectedArchive(file: File | null, resetInput?: () => void) {
    setMessage(null);
    setError(null);
    setArchiveFile(null);
    setDeploymentScan(null);
    setDeploymentSourceRoot(null);
    setPublishResult(null);
    setCreatedSite(null);
    setCreateStage("idle");

    if (!file) return;

    if (!isAcceptedArchive(file)) {
      setError("请上传 ZIP 格式的静态站点压缩包。");
      resetInput?.();
      return;
    }

    setArchiveFile(file);
  }

  function getUploadPath(file: File) {
    return file.webkitRelativePath || file.name;
  }

  function handleFileUpload(files: File[]) {
    setMessage(null);
    setError(null);
    setArchiveFile(files.length === 1 && isAcceptedArchive(files[0]) ? files[0] : null);
    setDeploymentScan(null);
    setDeploymentSourceRoot(null);
    setPublishResult(null);
    setCreatedSite(null);
    setCreateStage("idle");
    setProjectFiles(
      files.map((file) => ({
        file,
        path: getUploadPath(file)
      }))
    );
  }

  if (!authReady) {
    return <LoadingScreen label="正在读取账号" />;
  }

  if (!session) {
    return (
      <AuroraHero className="min-h-dvh">
        <section className={cn(CONTENT_TRACK_CLASS, "flex min-h-dvh items-center pt-20")}>
          <div className="max-w-xl">
            <h1 className="text-4xl font-bold tracking-normal text-white">登录后继续</h1>
            <p className="mt-4 text-base leading-7 text-zinc-300">登录账号后可以创建和管理站点。</p>
            <HoverBorderGradient
              alwaysOn
              as="button"
              className={cn("mt-6 h-11", PRIMARY_CTA_BUTTON_CLASS)}
              onClick={() => onNavigate("/auth")}
              type="button"
            >
              <LogIn aria-hidden="true" className="h-4 w-4" />
              登录
            </HoverBorderGradient>
          </div>
        </section>
      </AuroraHero>
    );
  }

  return (
    <AuroraHero className="min-h-dvh">
      <section className={STUDIO_SECTION_CLASS}>
        <div className={STUDIO_CONTENT_SHELL_CLASS}>
          <StudioSidebar account={account} active="create" onNavigate={onNavigate} />
          <div className="mx-auto w-full min-w-0 max-w-5xl">
            <div className="grid w-full gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="rounded-lg border border-white/10 bg-black p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-black px-3 py-1.5 text-sm font-medium text-zinc-300">
                  <Plus className="h-4 w-4" />
                  三步创建
                </p>
                <h1 className="mt-4 text-2xl font-semibold tracking-normal text-white">创建站点</h1>
                <p className="mt-1 text-sm leading-6 text-zinc-400">填写项目名、选择域名并上传 ZIP，提交后自动完成检查和发布。</p>
              </div>
              {account?.role === "admin" ? (
                <button
                  className="inline-flex h-10 w-fit items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-4 text-sm font-semibold text-zinc-200 transition-colors hover:bg-white/10 hover:text-white"
                  onClick={() => onNavigate(STUDIO_ADMIN_PATH)}
                  type="button"
                >
                  <LayoutDashboard className="h-4 w-4" />
                  管理员面板
                </button>
              ) : null}
            </div>

            <form className="mt-6 grid gap-5" onSubmit={handleCreateSite}>
              <div className="grid gap-4 lg:grid-cols-2">
                <label className="grid gap-2 text-sm font-medium text-zinc-200">
                  站点名称
                  <input
                    className="h-11 rounded-md border border-white/10 bg-black px-3 text-sm text-white outline-none transition-colors placeholder:text-zinc-600 focus:border-white/40 disabled:opacity-60"
                    disabled={isBusy}
                    onChange={(event) => {
                      setSiteName(event.target.value);
                      setCreatedSite(null);
                      setPublishResult(null);
                    }}
                    placeholder="例如：春季活动页"
                    value={siteName}
                  />
                </label>

                <label className="grid gap-2 text-sm font-medium text-zinc-200">
                  域名
                  <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] overflow-hidden rounded-md border border-white/10 bg-black focus-within:border-white/40">
                    <input
                      className="h-11 min-w-0 bg-transparent px-3 text-sm text-white outline-none placeholder:text-zinc-600 disabled:opacity-60"
                      disabled={isBusy}
                      onChange={(event) => {
                        setSubdomain(event.target.value);
                        resetOutput();
                      }}
                      placeholder="my-page"
                      required
                      value={subdomain}
                    />
                    <span className="inline-flex h-11 items-center border-l border-white/10 px-3 text-sm font-medium text-zinc-400">
                      .985201314.xyz
                    </span>
                  </div>
                </label>
              </div>

              <div className="grid gap-2 text-sm font-medium text-zinc-200">
                上传项目
                <FileUpload allowDirectories disabled={isBusy} files={projectFiles.map((item) => item.file)} multiple onChange={handleFileUpload} />
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                {progressSteps.map((item) => {
                  const Icon = item.icon;
                  return (
                    <div
                      className={cn(
                        "rounded-lg border bg-black px-3 py-3",
                        item.state === "done"
                          ? "border-white/20"
                          : item.state === "failed"
                            ? "border-white/20"
                            : item.state === "active"
                              ? "border-white/30"
                              : "border-white/10"
                      )}
                      key={item.title}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-black",
                            item.state === "done"
                              ? "border-white/20 text-white"
                              : item.state === "failed"
                                ? "border-white/20 text-white"
                                : item.state === "active"
                                  ? "border-white/30 text-white"
                                  : "border-white/10 text-zinc-400"
                          )}
                        >
                          {item.state === "active" ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : item.state === "done" ? (
                            <Check className="h-4 w-4" />
                          ) : (
                            <Icon className="h-4 w-4" />
                          )}
                        </span>
                        <p className="text-sm font-semibold text-white">{item.title}</p>
                      </div>
                      <p className="mt-3 min-h-10 text-sm leading-5 text-zinc-400">{item.detail}</p>
                    </div>
                  );
                })}
              </div>

              {message ? (
                <p className="rounded-lg border border-white/10 bg-black px-3 py-3 text-sm leading-6 text-emerald-200">
                  {message}
                </p>
              ) : null}
              {error ? (
                <p className="rounded-lg border border-white/10 bg-black px-3 py-3 text-sm leading-6 text-rose-200">
                  {error}
                </p>
              ) : null}

              <HoverBorderGradient
                alwaysOn
                as="button"
                className="h-11 w-full bg-white text-black hover:bg-zinc-100 sm:w-fit"
                containerClassName="w-full rounded-full sm:w-fit"
                disabled={isBusy || projectFiles.length === 0}
                type="submit"
              >
                {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {isBusy ? "正在创建" : "创建站点"}
              </HoverBorderGradient>
            </form>

            {createdSite || deploymentScan ? (
              <div className="mt-6 space-y-4">
                {createdSite ? (
                  <div className="rounded-lg border border-white/10 bg-black p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-white">{createdSite.name}</p>
                        <a className="mt-2 block break-all text-sm text-zinc-400 transition-colors hover:text-white" href={createdSite.publicUrl}>
                          {createdSite.publicUrl}
                        </a>
                      </div>
                      <span className="inline-flex h-8 w-fit items-center rounded-md border border-white/10 bg-black px-3 text-xs font-semibold text-zinc-200">
                        {getStatusLabel(createdSite.status)}
                      </span>
                    </div>
                  </div>
                ) : null}

                {deploymentScan ? (
                  <div className="space-y-3">
                    <div className="grid gap-2 sm:grid-cols-4">
                      {[
                        ["文件", deploymentScan.fileCount],
                        ["大小", formatBytes(deploymentScan.totalBytes)],
                        ["入口", deploymentScan.entrypoint ?? "未找到"],
                        ["风险", getRiskLabel(deploymentScan.riskLevel)]
                      ].map(([label, value]) => (
                        <div className="rounded-lg border border-white/10 bg-black px-3 py-3" key={label}>
                          <p className="text-xs font-medium text-zinc-500">{label}</p>
                          <p className="mt-1 truncate text-sm font-semibold text-zinc-100">{value}</p>
                        </div>
                      ))}
                    </div>

                    {deploymentSourceRoot ? (
                      <p className="rounded-lg border border-white/10 bg-black px-3 py-3 text-sm leading-6 text-zinc-200">
                        已自动使用 {deploymentSourceRoot}/ 作为发布目录。
                      </p>
                    ) : null}

                    {deploymentScan.issues.length > 0 ? (
                      <div className="space-y-2">
                        {deploymentScan.issues.slice(0, 5).map((issue) => (
                          <p
                            className={cn(
                              "rounded-lg border border-white/10 bg-black px-3 py-2 text-sm leading-6",
                              issue.severity === "error"
                                ? "text-rose-200"
                                : issue.severity === "warning"
                                  ? "text-amber-200"
                                  : "text-zinc-300"
                            )}
                            key={`${issue.code}-${issue.path ?? issue.message}`}
                          >
                            {issue.path ? `${issue.path}：` : ""}
                            {issue.message}
                          </p>
                        ))}
                        {deploymentScan.issues.length > 5 ? (
                          <p className="text-sm text-zinc-500">还有 {deploymentScan.issues.length - 5} 条诊断未显示。</p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <aside className="h-fit rounded-lg border border-white/10 bg-black p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-zinc-500">当前计划</p>
                <h2 className="mt-1 text-2xl font-semibold tracking-normal text-white">{planDisplayName}</h2>
              </div>
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-white/10 bg-black text-white">
                <Crown className="h-5 w-5" />
              </span>
            </div>

            <div className="mt-6 space-y-5">
              {quotaMeters.map((meter) => (
                <div key={meter.label}>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-zinc-300">{meter.label}</p>
                    <p className={cn("text-xs font-semibold", meter.exceeded ? "text-rose-200" : "text-zinc-500")}>{meter.text}</p>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-white"
                      style={{ width: `${clampPercent(meter.percent)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 grid gap-2 text-sm leading-6 text-zinc-400">
              <p>单站上限：{formatBytes(siteSizeLimit)}</p>
              <p>文件上限：{fileLimit} 个</p>
              <p>单文件上限：{formatBytes(planConfig.quotas.deployment.maxFileBytes)}</p>
            </div>

            {scanHasBlockingIssues ? (
              <p className="mt-5 rounded-lg border border-white/10 bg-black px-3 py-3 text-sm leading-6 text-rose-200">
                当前项目未通过额度或安全检查。
              </p>
            ) : deploymentScan ? (
              <p className="mt-5 rounded-lg border border-white/10 bg-black px-3 py-3 text-sm leading-6 text-emerald-200">
                当前项目在计划额度内。
              </p>
            ) : null}
          </aside>
        </div>
        </div>
      </div>
      </section>
    </AuroraHero>
  );
}
