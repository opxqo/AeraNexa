import "server-only";

/**
 * 业务错误码。前端可据此做分支处理，无需解析中文文案。
 */
export type ErrorCode =
  | "invalid_request"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "too_many_requests"
  | "unavailable"
  | "internal_error";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  invalid_request: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  too_many_requests: 429,
  unavailable: 503,
  internal_error: 500,
};

/** 可安全返回给客户端的错误；其他异常一律折叠为 500，避免泄露内部细节。 */
export class BusinessError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Record<string, string>;

  constructor(code: ErrorCode, message: string, details?: Record<string, string>) {
    super(message);
    this.name = "BusinessError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }
}

export function badRequest(message: string, details?: Record<string, string>): BusinessError {
  return new BusinessError("invalid_request", message, details);
}

export function unauthenticated(message = "未登录或登录已过期"): BusinessError {
  return new BusinessError("unauthenticated", message);
}

export function forbidden(message = "没有权限执行该操作"): BusinessError {
  return new BusinessError("forbidden", message);
}

export function notFound(message = "资源不存在"): BusinessError {
  return new BusinessError("not_found", message);
}

export function conflict(message: string): BusinessError {
  return new BusinessError("conflict", message);
}

export function tooManyRequests(message: string): BusinessError {
  return new BusinessError("too_many_requests", message);
}

export type ApiErrorPayload = {
  message: string;
  code: ErrorCode;
  details?: Record<string, string>;
};

/** 数据库/网络层面的不可用错误码，统一映射为 503。 */
const UNAVAILABLE_DRIVER_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EPIPE",
  "PROTOCOL_CONNECTION_LOST",
  "ER_ACCESS_DENIED_ERROR",
  "ER_BAD_DB_ERROR",
  "ER_CON_COUNT_ERROR",
  "ER_NO_SUCH_TABLE",
]);

export function isDatabaseUnavailable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "DatabaseConfigError") return true;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && UNAVAILABLE_DRIVER_CODES.has(code);
}

/**
 * 把任意异常折叠为可返回的 HTTP 响应。
 * - BusinessError：原样透出，保留业务语义。
 * - 数据库不可用：503，提示检查配置（保持既有契约）。
 * - 其他：500，仅记录日志，不回显内部信息。
 */
export function toApiError(error: unknown, logLabel: string): { status: number; payload: ApiErrorPayload } {
  if (error instanceof BusinessError) {
    return {
      status: error.status,
      payload: {
        message: error.message,
        code: error.code,
        ...(error.details ? { details: error.details } : {}),
      },
    };
  }

  console.error(`[aeranexa] ${logLabel}`, error);

  if (isDatabaseUnavailable(error)) {
    return {
      status: 503,
      payload: { message: "数据服务暂时不可用，请检查数据库配置后重试", code: "unavailable" },
    };
  }

  return {
    status: 500,
    payload: { message: "服务出现异常，请稍后重试", code: "internal_error" },
  };
}

/** 解析 JSON 请求体；格式错误统一抛 400，避免每个路由重复 try/catch。 */
export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw badRequest("请求格式不正确");
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("请求格式不正确");
  }
  return body as Record<string, unknown>;
}
