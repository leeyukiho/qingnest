export type NormalizedHostname =
  | { ok: true; ascii: string; display: string }
  | { ok: false; reason: string };

const INVALID_HOSTNAME_CHARACTERS = /[\s/\\@:#?\[\]]/;
const ASCII_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function normalizeHostname(value: string): NormalizedHostname {
  const display = value
    .trim()
    .toLowerCase()
    .replace(/[。．｡]/g, ".")
    .replace(/^\.+|\.+$/g, "");

  if (!display || INVALID_HOSTNAME_CHARACTERS.test(display)) {
    return { ok: false, reason: "请输入有效的根域名，例如 example.com" };
  }

  let ascii: string;
  try {
    ascii = new URL(`http://${display}`).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return { ok: false, reason: "请输入有效的根域名，例如 example.com" };
  }

  const labels = ascii.split(".");
  if (
    ascii.length < 4 ||
    ascii.length > 253 ||
    labels.length < 2 ||
    labels.some((label) => !ASCII_LABEL.test(label)) ||
    labels.at(-1)!.length < 2
  ) {
    return { ok: false, reason: "请输入有效的根域名，例如 example.com" };
  }

  return { ok: true, ascii, display };
}

export function platformDomainType(hostname: string) {
  return hostname.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
