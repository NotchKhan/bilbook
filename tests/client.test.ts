import { afterEach, expect, it, vi } from "vitest";
import { api } from "../src/lib/client";
afterEach(() => vi.unstubAllGlobals());
const response = (value: unknown) => new Response(JSON.stringify(value));
it("shares concurrent reads but fetches fresh data after settlement", async () => {
  let finish!: (value: Response) => void;
  const fetcher = vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; }));
  vi.stubGlobal("fetch", fetcher);
  const first = api("session"), second = api("session");
  expect(fetcher).toHaveBeenCalledTimes(1);
  finish(response({ profile: null }));
  expect(await first).toEqual(await second);
  const fresh = api("session");
  expect(fetcher).toHaveBeenCalledTimes(2);
  finish(response({ profile: { id: "new" } }));
  expect(await fresh).toEqual({ profile: { id: "new" } });
});
it("does not reuse reads across authentication changes", async () => {
  let oldFinish!: (value: Response) => void;
  const fetcher = vi.fn()
    .mockImplementationOnce(() => new Promise<Response>((resolve) => { oldFinish = resolve; }))
    .mockResolvedValueOnce(response({ ok: true }))
    .mockResolvedValueOnce(response({ profile: null }));
  vi.stubGlobal("fetch", fetcher);
  const old = api("session");
  await api("auth", { action: "signout" });
  expect(await api("session")).toEqual({ profile: null });
  oldFinish(response({ profile: { id: "old" } }));
  await old;
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it("allows retry after failed reads and keeps requests private", async () => {
  const fetcher = vi.fn().mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(response({ items: [] }));
  vi.stubGlobal("fetch", fetcher);
  await expect(api("feed?kind=news")).rejects.toThrow("Нет соединения");
  await expect(api("feed?kind=news")).resolves.toEqual({ items: [] });
  expect(fetcher).toHaveBeenLastCalledWith("/api/feed?kind=news", expect.objectContaining({ cache: "no-store", credentials: "same-origin" }));
});
