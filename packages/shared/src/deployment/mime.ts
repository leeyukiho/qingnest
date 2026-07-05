import { platformConfig } from "../config/platform";

export function getExtension(path: string) {
  const cleanPath = path.split("?")[0]?.split("#")[0] ?? path;
  const index = cleanPath.lastIndexOf(".");
  return index >= 0 ? cleanPath.slice(index).toLowerCase() : "";
}

export function getContentType(path: string) {
  const extension = getExtension(path);
  return platformConfig.mimeTypes[extension] ?? "application/octet-stream";
}

export function isHashedAsset(path: string) {
  return /(?:^|[.-])[a-f0-9]{8,}(?:\.|$)/i.test(path);
}

export function getCacheControl(path: string) {
  const extension = getExtension(path);

  if (extension === ".html" || path.endsWith("/")) {
    return platformConfig.cache.html;
  }

  return isHashedAsset(path) ? platformConfig.cache.assetsWithHash : platformConfig.cache.assetsDefault;
}

