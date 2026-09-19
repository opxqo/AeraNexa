import "server-only";

type BackendTarget = "airport" | "v2board-compat";

const baseUrls: Record<BackendTarget, string | undefined> = {
  airport: process.env.BACKEND_API_URL,
  "v2board-compat": process.env.V2BOARD_API_URL,
};

export class BackendRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "BackendRequestError";
  }
}

export async function backendRequest<T>(
  target: BackendTarget,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const baseUrl = baseUrls[target];
  if (!baseUrl) {
    throw new BackendRequestError(`Missing backend URL for ${target}`, 503);
  }

  const response = await fetch(new URL(path.replace(/^\//, ""), `${baseUrl.replace(/\/$/, "")}/`), {
    ...init,
    cache: init.cache ?? "no-store",
    headers: {
      Accept: "application/json",
      ...init.headers,
    },
  });

  if (!response.ok) {
    throw new BackendRequestError(`Backend request failed with ${response.status}`, response.status);
  }

  return response.json() as Promise<T>;
}
