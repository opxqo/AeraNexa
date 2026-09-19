// 统一 HTTP 请求客户端：同源 /api 接口，会话走 HttpOnly Cookie

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public errors?: Record<string, string[]>,
    /** 服务端业务错误码，用于前端做分支处理而不必解析文案。 */
    public code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function toErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function toJsonObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : null;
}

function getApiMessage(value: unknown, fallback: string): string {
  const json = toJsonObject(value);
  if (typeof json?.message === "string") return json.message;
  if (typeof json?.error === "string") return json.error;
  return fallback;
}

function getApiErrors(value: unknown): Record<string, string[]> | undefined {
  const root = toJsonObject(value);
  // 兼容两种字段名：errors（V2Board 风格）与 details（AeraNexa 风格）。
  const errors = toJsonObject(root?.errors) ?? toJsonObject(root?.details);
  if (!errors) return undefined;

  const validEntries = Object.entries(errors).filter(
    (entry): entry is [string, string[]] =>
      Array.isArray(entry[1]) && entry[1].every((message) => typeof message === "string"),
  );
  return validEntries.length ? Object.fromEntries(validEntries) : undefined;
}

function getApiCode(value: unknown): string | undefined {
  const code = toJsonObject(value)?.code;
  return typeof code === "string" && code ? code : undefined;
}

const AUTH_STORAGE_KEY = "v2_auth_data";

/** 清除迁移前 V2Board 前端留在浏览器里的旧登录令牌（AeraNexa 改用 HttpOnly Cookie 会话）。 */
export function clearAuthToken(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(AUTH_STORAGE_KEY);
}

interface LocalRequestOptions extends Omit<RequestInit, "body"> {
  params?: Record<string, string | number | boolean | undefined>;
  silentUnauthorized?: boolean;
  body?: BodyInit | Record<string, unknown>;
}

// AeraNexa 自有用户系统：使用同源 HttpOnly Cookie，不把会话令牌暴露给浏览器脚本。
export interface FullApiResponse<T> {
  data: T;
  meta?: Record<string, unknown>;
}

/**
 * 与 localApiRequest 相同，但保留 data 之外的 meta（分页信息等）。
 * 列表类接口使用此方法，避免丢失 total / has_more。
 */
export async function localApiRequestFull<T = unknown>(
  endpoint: string,
  options: LocalRequestOptions = {},
): Promise<FullApiResponse<T>> {
  const { params, silentUnauthorized, headers, body, ...restOptions } = options;
  let url = `/api/${endpoint.replace(/^\/+/, "")}`;

  if (params) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) searchParams.set(key, String(value));
    }
    const query = searchParams.toString();
    if (query) url += `?${query}`;
  }

  const reqHeaders: Record<string, string> = {
    Accept: "application/json",
    ...(headers as Record<string, string>),
  };

  let requestBody: BodyInit | null | undefined;
  if (body && !(body instanceof FormData) && typeof body === "object") {
    reqHeaders["Content-Type"] = "application/json";
    requestBody = JSON.stringify(body);
  } else {
    requestBody = body as BodyInit | null | undefined;
  }

  let response: Response;
  try {
    response = await fetch(url, { ...restOptions, body: requestBody, credentials: "include", headers: reqHeaders });
  } catch (error: unknown) {
    throw new ApiError(0, toErrorMessage(error, "网络连接失败，请检查服务状态"));
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    json = null;
  }

  if (!response.ok) {
    const message = getApiMessage(json, `请求失败 (${response.status})`);
    if (response.status === 401 && !silentUnauthorized && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("v2:unauthorized"));
    }
    throw new ApiError(response.status, message, getApiErrors(json), getApiCode(json));
  }

  const root = toJsonObject(json);
  if (root && "data" in root) {
    const meta = toJsonObject(root.meta);
    return { data: root.data as T, ...(meta ? { meta } : {}) };
  }
  return { data: json as T };
}

export async function localApiRequest<T = unknown>(
  endpoint: string,
  options: LocalRequestOptions = {},
): Promise<T> {
  const { params, silentUnauthorized, headers, body, ...restOptions } = options;
  let url = `/api/${endpoint.replace(/^\/+/, "")}`;

  if (params) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) searchParams.set(key, String(value));
    }
    const query = searchParams.toString();
    if (query) url += `?${query}`;
  }

  const reqHeaders: Record<string, string> = {
    Accept: "application/json",
    ...(headers as Record<string, string>),
  };

  let requestBody: BodyInit | null | undefined;
  if (body && !(body instanceof FormData) && typeof body === "object") {
    reqHeaders["Content-Type"] = "application/json";
    requestBody = JSON.stringify(body);
  } else {
    requestBody = body as BodyInit | null | undefined;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      ...restOptions,
      body: requestBody,
      credentials: "include",
      headers: reqHeaders,
    });
  } catch (error: unknown) {
    throw new ApiError(0, toErrorMessage(error, "网络连接失败，请检查服务状态"));
  }

  if (response.status === 204) return true as unknown as T;

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    json = null;
  }

  if (!response.ok) {
    const message = getApiMessage(json, `请求失败 (${response.status})`);
    if (response.status === 401 && !silentUnauthorized && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("v2:unauthorized"));
    }
    throw new ApiError(response.status, message, getApiErrors(json), getApiCode(json));
  }

  if (json && typeof json === "object" && "data" in json) {
    return (json as Record<string, unknown>).data as T;
  }
  return json as T;
}
