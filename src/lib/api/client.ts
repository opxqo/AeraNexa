// 统一 HTTP 请求客户端，集成 V2Board 认证头与错误处理

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public errors?: Record<string, string[]>,
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
  const errors = toJsonObject(toJsonObject(value)?.errors);
  if (!errors) return undefined;

  const validEntries = Object.entries(errors).filter(
    (entry): entry is [string, string[]] =>
      Array.isArray(entry[1]) && entry[1].every((message) => typeof message === "string"),
  );
  return validEntries.length ? Object.fromEntries(validEntries) : undefined;
}

const AUTH_STORAGE_KEY = "v2_auth_data";

export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(AUTH_STORAGE_KEY);
}

export function setAuthToken(token: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(AUTH_STORAGE_KEY, token);
}

export function clearAuthToken(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(AUTH_STORAGE_KEY);
}

export function getApiBaseUrl(): string {
  // 优先读取前端公开环境变量，默认走本域反向代理 /api/v1
  const custom = process.env.NEXT_PUBLIC_V2BOARD_API_URL;
  if (custom && custom.trim()) {
    return custom.replace(/\/+$/, "");
  }
  return "/api/v1";
}

interface RequestOptions extends RequestInit {
  params?: Record<string, string | number | boolean | undefined>;
  skipAuth?: boolean;
}

interface LocalRequestOptions extends Omit<RequestInit, "body"> {
  params?: Record<string, string | number | boolean | undefined>;
  silentUnauthorized?: boolean;
  body?: BodyInit | Record<string, unknown>;
}

export async function apiRequest<T = unknown>(
  endpoint: string,
  options: RequestOptions = {},
): Promise<T> {
  const { params, skipAuth, headers, ...restOptions } = options;

  let url = `${getApiBaseUrl()}/${endpoint.replace(/^\/+/, "")}`;
  if (params) {
    const searchParams = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) {
        searchParams.append(k, String(v));
      }
    }
    const queryString = searchParams.toString();
    if (queryString) {
      url += (url.includes("?") ? "&" : "?") + queryString;
    }
  }

  const reqHeaders: Record<string, string> = {
    Accept: "application/json",
    ...(headers as Record<string, string>),
  };

  if (!skipAuth) {
    const token = getAuthToken();
    if (token) {
      reqHeaders["authorization"] = token;
      reqHeaders["Authorization"] = token;
    }
  }

  if (restOptions.body && !(restOptions.body instanceof FormData)) {
    if (typeof restOptions.body === "object") {
      reqHeaders["Content-Type"] = "application/json";
      restOptions.body = JSON.stringify(restOptions.body);
    }
  }

  let response: Response;
  try {
    response = await fetch(url, {
      ...restOptions,
      headers: reqHeaders,
    });
  } catch (error: unknown) {
    throw new ApiError(0, toErrorMessage(error, "网络连接失败，请检查网络或后端服务状态"));
  }

  // 处理 204 No Content
  if (response.status === 204) {
    return true as unknown as T;
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    json = null;
  }

  if (!response.ok) {
    const message = getApiMessage(json, `请求失败 (${response.status})`);
    // 若未授权或登录失效
    if (response.status === 401 || (response.status === 403 && message.includes("未登录"))) {
      clearAuthToken();
      if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login") && !window.location.pathname.startsWith("/demo")) {
        window.dispatchEvent(new CustomEvent("v2:unauthorized"));
      }
    }
    throw new ApiError(response.status, message, getApiErrors(json));
  }

  // V2Board 规范：成功响应通常包含 data 字段
  if (json && typeof json === "object" && "data" in json) {
    return (json as Record<string, unknown>).data as T;
  }

  return json as T;
}

// AeraNexa 自有用户系统：使用同源 HttpOnly Cookie，不把会话令牌暴露给浏览器脚本。
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
    throw new ApiError(response.status, message, getApiErrors(json));
  }

  if (json && typeof json === "object" && "data" in json) {
    return (json as Record<string, unknown>).data as T;
  }
  return json as T;
}
