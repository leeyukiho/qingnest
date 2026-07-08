import { platformConfig, getPlanConfig } from "../config/platform";
import { getContentType } from "./mime";
import type { DeploymentFile, DeploymentScanIssue, DeploymentScanResult } from "./types";

export type ScanInputFile = {
  path: string;
  size: number;
  text?: string;
};

export function normalizeDeploymentPath(path: string) {
  return path
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part.length > 0 && part !== ".")
    .join("/");
}

function isPathTraversal(path: string) {
  return path.split("/").some((part) => part === "..");
}

function isArchiveMetadataPath(path: string) {
  const normalized = normalizeDeploymentPath(path);
  const lowerPath = normalized.toLowerCase();

  return (
    lowerPath === ".ds_store" ||
    lowerPath.endsWith("/.ds_store") ||
    lowerPath === "thumbs.db" ||
    lowerPath.endsWith("/thumbs.db") ||
    lowerPath === "__macosx" ||
    lowerPath.startsWith("__macosx/")
  );
}

function startsWithBlockedPath(path: string) {
  const normalized = normalizeDeploymentPath(path).toLowerCase();
  return platformConfig.deployment.blockedPaths.some((blockedPath) => {
    const blocked = blockedPath.toLowerCase();
    return blocked.endsWith("/") ? normalized.startsWith(blocked) : normalized === blocked || normalized.endsWith(`/${blocked}`);
  });
}

function normalizeFiles<T extends ScanInputFile>(inputFiles: T[]) {
  return inputFiles
    .map((file) => ({
      ...file,
      path: normalizeDeploymentPath(file.path)
    }))
    .filter((file) => !isArchiveMetadataPath(file.path));
}

function scoreHtmlRisk(file: ScanInputFile) {
  const text = file.text?.slice(0, platformConfig.deployment.maxPreviewHtmlBytes) ?? "";
  let score = 0;
  const issues: DeploymentScanIssue[] = [];

  if (!text) {
    return { score, issues };
  }

  for (const keyword of platformConfig.riskRules.highRiskKeywords) {
    if (text.includes(keyword)) {
      score += 10;
      issues.push({
        severity: "warning",
        code: "high_risk_keyword",
        message: `页面包含高风险词：${keyword}`,
        path: file.path
      });
    }
  }

  if (/<input[^>]+type=["']?password/i.test(text)) {
    score += platformConfig.riskRules.passwordInputRiskScore;
    issues.push({
      severity: "warning",
      code: "password_input",
      message: "页面包含密码输入框，可能需要审核",
      path: file.path
    });
  }

  if (/<form[^>]+action=["']https?:\/\//i.test(text)) {
    score += platformConfig.riskRules.externalFormActionRiskScore;
    issues.push({
      severity: "warning",
      code: "external_form_action",
      message: "页面表单提交到外部域名，可能需要审核",
      path: file.path
    });
  }

  if (/(eval\(|atob\(|fromCharCode|base64)/i.test(text)) {
    score += platformConfig.riskRules.obfuscatedScriptRiskScore;
    issues.push({
      severity: "warning",
      code: "obfuscated_script",
      message: "页面可能包含混淆脚本",
      path: file.path
    });
  }

  return { score, issues };
}

function findSuggestedOutputDirectory(paths: string[]) {
  for (const dir of platformConfig.deployment.staticOutputDirectories) {
    if (paths.includes(`${dir}/index.html`)) {
      return dir;
    }
  }

  return null;
}

function findSingleTopLevelDirectory(paths: string[]) {
  const roots = new Set<string>();

  for (const path of paths) {
    const [root, ...rest] = path.split("/");

    if (!root || rest.length === 0) {
      return null;
    }

    roots.add(root);
  }

  return roots.size === 1 ? [...roots][0] : null;
}

function stripRootDirectory<T extends ScanInputFile>(files: T[], root: string) {
  const prefix = `${root}/`;

  return files
    .filter((file) => file.path.startsWith(prefix))
    .map((file) => ({
      ...file,
      path: file.path.slice(prefix.length)
    }))
    .filter((file) => file.path.length > 0);
}

function hasSameDeploymentPaths<T extends ScanInputFile>(left: T[], right: T[]) {
  return left.length === right.length && left.every((file, index) => file.path === right[index]?.path);
}

function isHtmlPath(path: string) {
  const lowerPath = path.toLowerCase();
  return lowerPath.endsWith(".html") || lowerPath.endsWith(".htm");
}

function prepareSingleHtmlEntrypoint<T extends ScanInputFile>(files: T[]) {
  if (files.length !== 1 || !isHtmlPath(files[0].path)) {
    return files;
  }

  return [
    {
      ...files[0],
      path: platformConfig.deployment.entrypoints[0] ?? "index.html"
    }
  ];
}

export function scanDeploymentFiles(inputFiles: ScanInputFile[], planName = "free"): DeploymentScanResult {
  const plan = getPlanConfig(planName);
  const issues: DeploymentScanIssue[] = [];
  const files: DeploymentFile[] = [];
  const paths = inputFiles.map((file) => normalizeDeploymentPath(file.path));
  let totalBytes = 0;
  let riskScore = 0;

  for (const inputFile of inputFiles) {
    const path = normalizeDeploymentPath(inputFile.path);
    totalBytes += inputFile.size;

    if (!path || isPathTraversal(path)) {
      issues.push({
        severity: "error",
        code: "unsafe_path",
        message: "文件路径不安全，不能包含空路径或 ../",
        path: inputFile.path
      });
      continue;
    }

    if (startsWithBlockedPath(path)) {
      issues.push({
        severity: "error",
        code: "blocked_path",
        message: "包含不应发布的文件或目录",
        path
      });
    }

    if (path.length > plan.quotas.deployment.maxPathLength) {
      issues.push({
        severity: "error",
        code: "path_too_long",
        message: `文件路径超过当前套餐限制：${plan.quotas.deployment.maxPathLength} 个字符`,
        path
      });
    }

    if (inputFile.size > plan.quotas.deployment.maxFileBytes) {
      issues.push({
        severity: "error",
        code: "file_too_large",
        message: `单个文件超过当前套餐限制：${Math.round(plan.quotas.deployment.maxFileBytes / 1024 / 1024)} MB`,
        path
      });
    }

    if (path.toLowerCase().endsWith(".html")) {
      const risk = scoreHtmlRisk({ ...inputFile, path });
      riskScore += risk.score;
      issues.push(...risk.issues);
    }

    files.push({
      path,
      size: inputFile.size,
      contentType: getContentType(path)
    });
  }

  if (files.length > plan.quotas.deployment.maxFiles) {
    issues.push({
      severity: "error",
      code: "too_many_files",
      message: `文件数量超过当前套餐限制：${plan.quotas.deployment.maxFiles} 个`
    });
  }

  if (totalBytes > plan.quotas.site.maxSiteBytes) {
    issues.push({
      severity: "error",
      code: "site_too_large",
      message: `站点总大小超过当前套餐限制：${Math.round(plan.quotas.site.maxSiteBytes / 1024 / 1024)} MB`
    });
  }

  const entrypoint = platformConfig.deployment.entrypoints.find((entry) => paths.includes(entry)) ?? null;
  const suggestedOutputDirectory = findSuggestedOutputDirectory(paths);
  const likelySourceProject = platformConfig.deployment.sourceIndicators.some((indicator) => paths.includes(indicator));

  if (!entrypoint && suggestedOutputDirectory) {
    issues.push({
      severity: "warning",
      code: "nested_static_output",
      message: `检测到 ${suggestedOutputDirectory}/index.html，建议发布 ${suggestedOutputDirectory} 文件夹内的内容`
    });
  }

  if (!entrypoint && likelySourceProject && !suggestedOutputDirectory) {
    issues.push({
      severity: "error",
      code: "source_project_without_build",
      message: "检测到源码项目但没有构建产物。请先运行 npm install 和 npm run build，再上传 dist/build/out 文件夹"
    });
  }

  if (!entrypoint && !suggestedOutputDirectory) {
    issues.push({
      severity: "error",
      code: "missing_index",
      message: "没有找到 index.html，静态站点必须包含入口文件"
    });
  }

  const hasRoutingScript = inputFiles.some((file) => {
    const text = file.text ?? "";
    return /createBrowserRouter|BrowserRouter|history\.pushState|vue-router|svelte-routing/.test(text);
  });

  const riskLevel =
    riskScore >= platformConfig.riskRules.highRiskThreshold
      ? "high"
      : riskScore >= platformConfig.riskRules.manualReviewThreshold
        ? "medium"
        : "low";

  return {
    fileCount: files.length,
    totalBytes,
    entrypoint,
    likelySourceProject,
    suggestedOutputDirectory,
    spaFallbackRecommended: platformConfig.deployment.spaFallbackDefault || hasRoutingScript,
    riskScore,
    riskLevel,
    issues,
    files
  };
}

export function prepareDeploymentFiles<T extends ScanInputFile>(inputFiles: T[], planName = "free") {
  const normalizedFiles = prepareSingleHtmlEntrypoint(normalizeFiles(inputFiles));
  let files = normalizedFiles;
  const sourceRoots: string[] = [];

  for (let depth = 0; depth < 4; depth += 1) {
    const scan = scanDeploymentFiles(files, planName);

    if (scan.entrypoint) {
      return {
        files,
        sourceRoot: sourceRoots.length > 0 ? sourceRoots.join("/") : null,
        scan
      };
    }

    const paths = files.map((file) => file.path);
    const nextRoot = scan.suggestedOutputDirectory ?? findSingleTopLevelDirectory(paths);

    if (!nextRoot) {
      return {
        files,
        sourceRoot: sourceRoots.length > 0 ? sourceRoots.join("/") : null,
        scan
      };
    }

    const nextFiles = stripRootDirectory(files, nextRoot);

    if (nextFiles.length === 0 || hasSameDeploymentPaths(nextFiles, files)) {
      return {
        files,
        sourceRoot: sourceRoots.length > 0 ? sourceRoots.join("/") : null,
        scan
      };
    }

    sourceRoots.push(nextRoot);
    files = nextFiles;
  }

  return {
    files,
    sourceRoot: sourceRoots.length > 0 ? sourceRoots.join("/") : null,
    scan: scanDeploymentFiles(files, planName)
  };
}
