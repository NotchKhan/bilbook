// Dependency boundary lets tests exercise partial failure/retry without pretending to be Storage.
export type CleanupMedia = { id: string; path: string; attempts: number };
export type CleanupAdapter = {
  prepare(): Promise<void>;
  pending(limit: number): Promise<CleanupMedia[]>;
  removeFile(path: string): Promise<void>;
  removeRow(id: string): Promise<void>;
  retry(id: string, attempts: number, next: string): Promise<void>;
};
export async function cleanMedia(adapter: CleanupAdapter, now = Date.now()) {
  await adapter.prepare();
  const rows = await adapter.pending(100);
  let removed = 0,
    failed = 0;
  for (const row of rows) {
    try {
      await adapter.removeFile(row.path);
      await adapter.removeRow(row.id);
      removed++;
    } catch {
      failed++;
      const attempts = row.attempts + 1;
      await adapter.retry(
        row.id,
        attempts,
        new Date(
          now + Math.min(86400, 60 * 2 ** Math.min(attempts, 10)) * 1000,
        ).toISOString(),
      );
    }
  }
  return { removed, failed, more: rows.length === 100 };
}
export function signedTtl(expiresAt: string | null, now = Date.now()) {
  return expiresAt
    ? Math.max(
        0,
        Math.min(60, Math.floor((Date.parse(expiresAt) - now) / 1000) - 2),
      )
    : 60;
}
export function linkWithinStoryLifetime(
  url: string,
  expiresAt: string,
  now = Date.now(),
) {
  try {
    const token = new URL(url).searchParams.get("token");
    if (!token) return false;
    const claims = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
    ) as { exp?: number };
    // Inspect the actual token returned by trusted Storage, including signing/network delay.
    return (
      typeof claims.exp === "number" &&
      claims.exp * 1000 <= Date.parse(expiresAt) &&
      claims.exp * 1000 > now
    );
  } catch {
    return false;
  }
}
