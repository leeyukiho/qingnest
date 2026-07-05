import { unzipSync } from "fflate";
import { scanDeploymentFiles, type ScanInputFile } from "@qingnest/shared/deployment/scan";
import { platformConfig } from "@qingnest/shared/config/platform";

const textPreviewExtensions = new Set([".html", ".htm", ".js", ".mjs", ".css", ".json", ".txt"]);

function extensionOf(path: string) {
  const index = path.lastIndexOf(".");
  return index >= 0 ? path.slice(index).toLowerCase() : "";
}

function decodePreview(path: string, bytes: Uint8Array) {
  if (!textPreviewExtensions.has(extensionOf(path))) {
    return undefined;
  }

  const maxBytes = platformConfig.deployment.maxPreviewHtmlBytes;
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, maxBytes));
}

export async function scanZipFile(file: File, planName = "free") {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const entries = unzipSync(bytes);
  const files: ScanInputFile[] = [];

  for (const [path, content] of Object.entries(entries)) {
    if (path.endsWith("/")) {
      continue;
    }

    files.push({
      path,
      size: content.byteLength,
      text: decodePreview(path, content)
    });
  }

  return scanDeploymentFiles(files, planName);
}

export function isAcceptedArchive(file: File) {
  const lowerName = file.name.toLowerCase();
  return platformConfig.deployment.acceptedArchiveExtensions.some((extension) => lowerName.endsWith(extension));
}


