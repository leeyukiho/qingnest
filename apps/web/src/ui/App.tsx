import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  CloudUpload,
  ExternalLink,
  FileSearch,
  Globe2,
  LogIn,
  LogOut,
  Loader2,
  Rocket,
  ShieldAlert
} from "lucide-react";
import { validateSubdomain } from "@qingnest/shared/config/platform";
import type { DeploymentScanIssue, DeploymentScanResult } from "@qingnest/shared/deployment/types";
import {
  checkSubdomain,
  createSite,
  createUploadSession,
  setAccessTokenProvider,
  type SiteDraft,
  type SubdomainCheck
} from "../lib/api";
import { isAcceptedArchive, scanZipFile } from "../lib/archive";
import { clientPlatformConfig as platformConfig } from "../lib/platform";
import { isSupabaseConfigured, supabase } from "../lib/supabase";

type WorkflowState = "idle" | "checking" | "scanning" | "ready" | "publishing" | "published" | "error";

const severityLabel: Record<DeploymentScanIssue["severity"], string> = {
  info: "提示",
  warning: "警告",
  error: "阻断"
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function getBlockingIssueCount(scan: DeploymentScanResult | null) {
  return scan?.issues.filter((issue) => issue.severity === "error").length ?? 0;
}

export function App() {
  const [siteName, setSiteName] = useState("我的轻巢站点");
  const [subdomain, setSubdomain] = useState("demo");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [scan, setScan] = useState<DeploymentScanResult | null>(null);
  const [check, setCheck] = useState<SubdomainCheck | null>(null);
  const [site, setSite] = useState<SiteDraft | null>(null);
  const [state, setState] = useState<WorkflowState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState<string | null>(null);

  const localSubdomainCheck = useMemo(() => validateSubdomain(subdomain), [subdomain]);
  const blockingIssueCount = getBlockingIssueCount(scan);
  const authReady = !isSupabaseConfigured || Boolean(userEmail);
  const canPublish = Boolean(check?.available && scan && blockingIssueCount === 0 && selectedFile && authReady);

  useEffect(() => {
    setAccessTokenProvider(async () => {
      if (!supabase) return null;
      const { data } = await supabase.auth.getSession();
      return data.session?.access_token ?? null;
    });

    if (!supabase) {
      return () => setAccessTokenProvider(null);
    }

    supabase.auth.getSession().then(({ data }) => {
      setUserEmail(data.session?.user.email ?? null);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserEmail(session?.user.email ?? null);
    });

    return () => {
      data.subscription.unsubscribe();
      setAccessTokenProvider(null);
    };
  }, []);

  async function handleAuth(mode: "signin" | "signup") {
    if (!supabase) return;

    try {
      setAuthBusy(true);
      setAuthMessage(null);
      setError(null);

      const credentials = {
        email: authEmail.trim(),
        password: authPassword
      };
      const { error: authError } =
        mode === "signin"
          ? await supabase.auth.signInWithPassword(credentials)
          : await supabase.auth.signUp(credentials);

      if (authError) {
        throw authError;
      }

      setAuthMessage(mode === "signin" ? "已登录" : "账号已创建");
      setAuthPassword("");
    } catch (err) {
      setAuthMessage(null);
      setError(err instanceof Error ? err.message : "认证失败");
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleSignOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    setUserEmail(null);
  }

  async function handleCheckSubdomain() {
    setError(null);
    setCheck(null);

    if (!localSubdomainCheck.ok) {
      setError(localSubdomainCheck.reason ?? "子域名格式不符合规则");
      return;
    }

    try {
      setState("checking");
      const result = await checkSubdomain(subdomain);
      setCheck(result);
      setState(scan ? "ready" : "idle");
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : "子域名检查失败");
    }
  }

  async function handleFileChange(file: File | null) {
    setError(null);
    setSelectedFile(file);
    setScan(null);

    if (!file) {
      setState("idle");
      return;
    }

    if (!isAcceptedArchive(file)) {
      setState("error");
      setError(`当前只支持 ${platformConfig.deployment.acceptedArchiveExtensions.join(", ")} 文件`);
      return;
    }

    try {
      setState("scanning");
      const result = await scanZipFile(file);
      setScan(result);
      setState("ready");
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : "ZIP 解析失败，请确认文件没有损坏");
    }
  }

  async function handlePublish() {
    if (!scan || !canPublish) return;

    try {
      setError(null);
      setState("publishing");
      const createdSite = await createSite({
        name: siteName.trim() || "未命名站点",
        subdomain: check?.normalized ?? subdomain
      });
      await createUploadSession({
        siteId: createdSite.id,
        scan
      });
      setSite(createdSite);
      setState("published");
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : "发布失败");
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-mark">Q</div>
        <div>
          <p className="eyebrow">{platformConfig.brand.cnName}</p>
          <h1>{platformConfig.brand.name}</h1>
          <p className="lede">上传静态产物，拿到可分享的公开子域名。</p>
        </div>
        {isSupabaseConfigured && (
          <div className="auth-card">
            <span>账号</span>
            {userEmail ? (
              <>
                <strong>{userEmail}</strong>
                <button className="secondary-button" onClick={handleSignOut}>
                  <LogOut size={16} />
                  退出
                </button>
              </>
            ) : (
              <>
                <input
                  type="email"
                  placeholder="邮箱"
                  value={authEmail}
                  onChange={(event) => setAuthEmail(event.target.value)}
                />
                <input
                  type="password"
                  placeholder="密码"
                  value={authPassword}
                  onChange={(event) => setAuthPassword(event.target.value)}
                />
                <div className="auth-actions">
                  <button className="secondary-button" onClick={() => handleAuth("signin")} disabled={authBusy}>
                    <LogIn size={16} />
                    登录
                  </button>
                  <button className="secondary-button" onClick={() => handleAuth("signup")} disabled={authBusy}>
                    注册
                  </button>
                </div>
                {authMessage && <small>{authMessage}</small>}
              </>
            )}
          </div>
        )}
        <div className="quota-card">
          <span>免费版额度</span>
          <strong>{platformConfig.plans.free.quotas.user.maxSites} 个站点</strong>
          <small>
            单站 {formatBytes(platformConfig.plans.free.quotas.site.maxSiteBytes)}，单文件{" "}
            {formatBytes(platformConfig.plans.free.quotas.deployment.maxFileBytes)}
          </small>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Phase 1 MVP</p>
            <h2>新建静态站点</h2>
          </div>
          <a className="ghost-link" href={site?.publicUrl ?? "#"} target="_blank" rel="noreferrer">
            <Globe2 size={18} />
            {site?.publicUrl ? "打开站点" : platformConfig.domains.distributionRoot}
          </a>
        </header>

        <div className="grid">
          <section className="panel">
            <div className="panel-title">
              <Rocket size={18} />
              <h3>站点信息</h3>
            </div>

            <label className="field">
              <span>站点名称</span>
              <input value={siteName} onChange={(event) => setSiteName(event.target.value)} />
            </label>

            <label className="field">
              <span>平台子域名</span>
              <div className="subdomain-input">
                <input value={subdomain} onChange={(event) => setSubdomain(event.target.value.toLowerCase())} />
                <span>.{platformConfig.domains.distributionRoot}</span>
              </div>
            </label>

            <button className="primary-button" onClick={handleCheckSubdomain} disabled={state === "checking"}>
              {state === "checking" ? <Loader2 className="spin" size={18} /> : <FileSearch size={18} />}
              检查可用性
            </button>

            {check && (
              <div className={check.available ? "notice success" : "notice danger"}>
                {check.available ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
                <span>{check.available ? `可用：${check.publicUrl}` : check.reason}</span>
              </div>
            )}
          </section>

          <section className="panel">
            <div className="panel-title">
              <Archive size={18} />
              <h3>上传 ZIP</h3>
            </div>

            <label className="dropzone">
              <CloudUpload size={32} />
              <strong>{selectedFile ? selectedFile.name : "选择构建后的静态产物 ZIP"}</strong>
              <span>支持 index.html、dist、build、out 等静态产物</span>
              <input type="file" accept=".zip" onChange={(event) => handleFileChange(event.target.files?.[0] ?? null)} />
            </label>

            {scan && (
              <div className="scan-summary">
                <div>
                  <span>文件数</span>
                  <strong>{scan.fileCount}</strong>
                </div>
                <div>
                  <span>总大小</span>
                  <strong>{formatBytes(scan.totalBytes)}</strong>
                </div>
                <div>
                  <span>风险</span>
                  <strong>{scan.riskLevel}</strong>
                </div>
              </div>
            )}
          </section>
        </div>

        {scan && (
          <section className="panel full-width">
            <div className="panel-title">
              <ShieldAlert size={18} />
              <h3>部署诊断</h3>
            </div>
            <div className="diagnostics">
              {scan.issues.length === 0 ? (
                <div className="notice success">
                  <CheckCircle2 size={18} />
                  <span>未发现阻断问题，可以发布。</span>
                </div>
              ) : (
                scan.issues.map((issue, index) => (
                  <div className={`issue ${issue.severity}`} key={`${issue.code}-${index}`}>
                    <strong>{severityLabel[issue.severity]}</strong>
                    <span>{issue.message}</span>
                    {issue.path && <code>{issue.path}</code>}
                  </div>
                ))
              )}
            </div>
          </section>
        )}

        {error && (
          <div className="notice danger">
            <AlertTriangle size={18} />
            <span>{error}</span>
          </div>
        )}

        <footer className="action-bar">
          <div>
            <strong>{canPublish ? "已准备发布" : authReady ? "完成子域名检查和 ZIP 诊断后发布" : "登录后发布"}</strong>
            <span>发布 API 已预留 R2 上传会话和审核状态。</span>
          </div>
          <button className="primary-button" onClick={handlePublish} disabled={!canPublish || state === "publishing"}>
            {state === "publishing" ? <Loader2 className="spin" size={18} /> : <ExternalLink size={18} />}
            {state === "published" ? "已创建" : "创建发布"}
          </button>
        </footer>
      </section>
    </main>
  );
}

