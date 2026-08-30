import type { z } from "zod";
import { API_URL } from "./config";
import { ApiClientError } from "./errors";

export async function apiFetch<T>(
  endpoint: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  init?: RequestInit,
): Promise<T> {
  const url = endpoint.startsWith("http") ? endpoint : `${API_URL}${endpoint}`;
  let res: Response;
  try {
    res = await fetch(url, {
      credentials: "include",
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
  } catch (err) {
    throw new ApiClientError(
      "NetworkError",
      err instanceof Error ? err.message : "네트워크 연결에 실패했습니다.",
    );
  }

  if (!res.ok) {
    let detail: string | undefined;
    let code: string | undefined;
    let retryAfterSeconds: number | undefined;
    let data: unknown;
    try {
      const body = (await res.json()) as {
        error?: string | { code?: string; message?: string; retryAfterSeconds?: number };
        detail?: string;
        message?: string;
        [k: string]: unknown;
      };
      data = body;
      if (body?.error && typeof body.error === "object" && typeof body.error.message === "string") {
        detail = body.error.message;
        code = body.error.code;
        retryAfterSeconds = body.error.retryAfterSeconds;
      } else if (typeof body?.error === "string") {
        detail = body.error;
      } else {
        detail = body?.detail || body?.message;
      }
    } catch {
      // Failed to parse body as json
    }
    const retryAfterHeader = Number.parseInt(res.headers.get("Retry-After") ?? "", 10);
    if (retryAfterSeconds === undefined && Number.isFinite(retryAfterHeader)) {
      retryAfterSeconds = retryAfterHeader;
    }
    const errOptions: {
      status?: number;
      detail?: string;
      code?: string;
      data?: unknown;
      retryAfterSeconds?: number;
    } = {};
    if (res.status) errOptions.status = res.status;
    if (detail) errOptions.detail = detail;
    if (code) errOptions.code = code;
    if (data !== undefined) errOptions.data = data;
    if (retryAfterSeconds !== undefined) errOptions.retryAfterSeconds = retryAfterSeconds;

    throw new ApiClientError(
      "HttpError",
      detail || `요청 처리에 실패했습니다. (HTTP ${res.status})`,
      errOptions,
    );
  }

  const json = await res.json();
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[Contract Mismatch]", parsed.error);
    }
    throw new ApiClientError("ContractError", "서버 응답 형식이 표준 계약과 일치하지 않습니다.");
  }

  return parsed.data;
}
