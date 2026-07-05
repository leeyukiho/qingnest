import { platformConfig } from "@qingnest/shared/config/platform";
import type { ApiResponse } from "./types";

export function json<T>(data: T, init?: ResponseInit) {
  const payload: ApiResponse<T> = { ok: true, data };
  return new Response(JSON.stringify(payload), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init?.headers ?? {})
    }
  });
}

export function problem(message: string, status = 400) {
  const payload: ApiResponse<never> = { ok: false, error: message };
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8"
    }
  });
}

export function withSecurityHeaders(response: Response) {
  const next = new Response(response.body, response);

  for (const [key, value] of Object.entries(platformConfig.securityHeaders)) {
    next.headers.set(key, value);
  }

  return next;
}

export async function readJson<T>(request: Request) {
  try {
    return (await request.json()) as T;
  } catch {
    throw new Error("请求体必须是合法 JSON");
  }
}


