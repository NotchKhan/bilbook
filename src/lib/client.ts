export async function api<T = Record<string, unknown>>(
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
