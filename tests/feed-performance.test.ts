import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("../src/lib/server", async (original) => ({
  ...await original<typeof import("../src/lib/server")>(),
  requireUser: vi.fn(),
}));
import { requireUser } from "../src/lib/server";
import { GET } from "../src/app/api/[...path]/route";

it("starts counts, own reactions and author lookup together and preserves the merged feed", async () => {
  const started: string[] = [];
  const release: (() => void)[] = [];
  function pending(name: string, data: unknown) {
    started.push(name);
    return new Promise((resolve) => release.push(() => resolve({ data, error: null })));
  }
  const db = {
    rpc: () => pending("counts", [{ id: "post", total: 8 }]),
    from: (table: string) => {
      const q = { select: vi.fn(), order: vi.fn(), limit: vi.fn(), in: vi.fn() };
      q.select.mockReturnValue(q);
      q.order.mockReturnValue(q);
      q.limit.mockResolvedValue({ data: [{ id: "post", author_id: "author", media_id: null }], error: null });
      q.in.mockImplementation(() => pending(table, table === "likes"
        ? [{ news_id: "post" }]
        : [{ id: "author", name: "Редактор", avatar_id: null }]));
      return q;
    },
  };
  vi.mocked(requireUser).mockResolvedValue({ db, profile: { id: "viewer" } } as unknown as Awaited<ReturnType<typeof requireUser>>);
  const response = GET(new Request("https://school.example/api/feed?kind=news"));
  await vi.waitFor(() => expect(started.sort()).toEqual(["counts", "likes", "profiles"]));
  release.forEach((finish) => finish());
  const result = await response;
  expect(result.headers.get("Cache-Control")).toContain("no-store");
  expect((await result.json()).items[0]).toMatchObject({ total: 8, reacted: true, author_name: "Редактор" });
});
