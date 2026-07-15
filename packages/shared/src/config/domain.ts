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

function decodePunycodeLabel(label: string) {
  const input = label.slice(4).toLowerCase();
  const output = input.includes("-")
    ? Array.from(input.slice(0, input.lastIndexOf("-")), (character) =>
        character.codePointAt(0)!,
      )
    : [];
  let index = input.includes("-") ? input.lastIndexOf("-") + 1 : 0;
  let codePoint = 128;
  let bias = 72;
  let delta = 0;

  while (index < input.length) {
    const previousDelta = delta;
    let weight = 1;
    for (let position = 36; ; position += 36) {
      if (index >= input.length) throw new Error("Invalid punycode label");
      const character = input.charCodeAt(index++);
      const digit =
        character >= 48 && character <= 57
          ? character - 22
          : character >= 97 && character <= 122
            ? character - 97
            : 36;
      if (digit >= 36) throw new Error("Invalid punycode label");
      delta += digit * weight;
      const threshold =
        position <= bias ? 1 : position >= bias + 26 ? 26 : position - bias;
      if (digit < threshold) break;
      weight *= 36 - threshold;
    }

    const length = output.length + 1;
    const change = delta - previousDelta;
    let adjustment = previousDelta === 0 ? Math.floor(change / 700) : change >> 1;
    adjustment += Math.floor(adjustment / length);
    let nextBias = 0;
    while (adjustment > 455) {
      adjustment = Math.floor(adjustment / 35);
      nextBias += 36;
    }
    bias = nextBias + Math.floor((36 * adjustment) / (adjustment + 38));
    codePoint += Math.floor(delta / length);
    delta %= length;
    output.splice(delta, 0, codePoint);
    delta += 1;
  }

  return String.fromCodePoint(...output);
}

export function displayHostname(hostname: string) {
  return hostname
    .split(".")
    .map((label) => {
      if (!label.toLowerCase().startsWith("xn--")) return label;
      try {
        return decodePunycodeLabel(label);
      } catch {
        return label;
      }
    })
    .join(".");
}
