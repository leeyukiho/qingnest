import { unzipSync } from "fflate";
import { prepareDeploymentFiles, type ScanInputFile } from "@qingnest/shared/deployment/scan";
import { platformConfig } from "@qingnest/shared/config/platform";

const textPreviewExtensions = new Set([".html", ".htm", ".js", ".mjs", ".css", ".json", ".txt"]);

export type SelectedUploadFile = {
  file: File;
  path: string;
};

export type PreparedUploadFile = ScanInputFile & {
  file: File;
};

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

async function decodeFilePreview(path: string, file: File) {
  if (!textPreviewExtensions.has(extensionOf(path))) {
    return undefined;
  }

  const maxBytes = platformConfig.deployment.maxPreviewHtmlBytes;
  const bytes = new Uint8Array(await file.slice(0, maxBytes).arrayBuffer());
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

export async function scanZipFile(file: File, planName = "free") {
  return (await prepareZipDeployment(file, planName)).scan;
}

export async function prepareZipDeployment(file: File, planName = "free") {
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

  return prepareDeploymentFiles(files, planName);
}

export async function prepareProjectDeployment(files: SelectedUploadFile[], planName = "free") {
  if (files.length === 1 && isAcceptedArchive(files[0].file)) {
    return {
      kind: "archive" as const,
      archive: files[0].file,
      ...(await prepareZipDeployment(files[0].file, planName))
    };
  }

  const inputFiles: PreparedUploadFile[] = await Promise.all(
    files.map(async ({ file, path }) => ({
      file,
      path,
      size: file.size,
      text: await decodeFilePreview(path, file)
    }))
  );

  return {
    kind: "files" as const,
    ...prepareDeploymentFiles(inputFiles, planName)
  };
}

export function isAcceptedArchive(file: File) {
  const lowerName = file.name.toLowerCase();
  return platformConfig.deployment.acceptedArchiveExtensions.some((extension) => lowerName.endsWith(extension));
}


