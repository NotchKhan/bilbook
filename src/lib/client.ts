// Share only requests currently in flight. No private data persists after settlement.
const pendingReads = new Map<string, Promise<unknown>>();
export function api<T = Record<string, unknown>>(
  path: string,
  body?: unknown,
): Promise<T> {
  if (body !== undefined) {
    pendingReads.clear(); // Never join a read started before login/logout or a mutation.
    return request<T>(path, body).finally(() => pendingReads.clear());
  }
  const existing = pendingReads.get(path);
  if (existing) return existing as Promise<T>;
  const pending = request<T>(path).finally(() => {
    if (pendingReads.get(path) === pending) pendingReads.delete(path);
  });
  pendingReads.set(path, pending);
  return pending;
}
async function request<T = Record<string, unknown>>(
  path: string,
  body?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch("/api/" + path, {
      method: body === undefined ? "GET" : "POST",
      headers:
        body instanceof FormData
          ? {}
          : body === undefined
            ? {}
            : { "Content-Type": "application/json" },
      body:
        body === undefined
          ? undefined
          : body instanceof FormData
            ? body
            : JSON.stringify(body),
      cache: "no-store",
      credentials: "same-origin",
    });
  } catch {
    throw new Error(
      "Нет соединения с сервером. Проверьте интернет и повторите.",
    );
  }
  const value = await response
    .json()
    .catch(() => ({
      error: "Сервер вернул неожиданный ответ. Повторите позже.",
    }));
  if (!response.ok)
    throw new Error(value.error || "Не удалось выполнить действие");
  return value;
}
export async function command(action: string, payload: unknown) {
  return api("command", { action, payload });
}
