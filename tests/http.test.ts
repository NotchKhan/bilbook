import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { cronAuthorized, sameOrigin, limitedBody } from "../src/lib/server";
import { parseCommand } from "../src/lib/validation";
import { GET, POST } from "../src/app/api/[...path]/route";
beforeEach(() => {
  for (const key of [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "RATE_LIMIT_SECRET",
    "CRON_SECRET",
  ])
    vi.stubEnv(key, "");
  vi.stubEnv("APP_URL", "https://school.example");
});
afterEach(() => vi.unstubAllEnvs());
describe("HTTP boundary", () => {
  it("rejects missing, forged and short cron credentials", () => {
    const secret = "a".repeat(64);
    expect(cronAuthorized(null, secret)).toBe(false);
    expect(cronAuthorized("Bearer wrong", secret)).toBe(false);
    expect(cronAuthorized("Bearer short", "short")).toBe(false);
    expect(cronAuthorized("Bearer " + secret, secret)).toBe(true);
  });
  it("rejects cross-origin mutations including a forged origin prefix", () => {
    expect(() =>
      sameOrigin(
        new Request("https://school.example/api/command", {
          headers: { origin: "https://school.example.evil.test" },
        }),
      ),
    ).toThrow();
    expect(() =>
      sameOrigin(new Request("https://school.example/api/command")),
    ).toThrow();
    expect(() =>
      sameOrigin(
        new Request("https://school.example/api/command", {
          headers: { origin: "https://school.example" },
        }),
      ),
    ).not.toThrow();
  });
  it("enforces actual streamed body size, even without Content-Length", async () => {
    await expect(
      limitedBody(
        new Request("https://school.example", {
          method: "POST",
          body: "oversized",
        }),
        4,
      ),
    ).rejects.toThrow("слишком большой");
    expect(
      (
        await limitedBody(
          new Request("https://school.example", { method: "POST", body: "ok" }),
          4,
        )
      ).toString(),
    ).toBe("ok");
  });
  it("strips privilege fields from profile input and validates moderation input", () => {
    expect(
      parseCommand({
        action: "profile",
        payload: {
          name: "Ученик",
          dormitory: false,
          role: "admin",
          school_id: "fake",
          is_responder: true,
        },
      }).payload,
    ).not.toHaveProperty("role");
    expect(() =>
      parseCommand({
        action: "moderate_request",
        payload: { id: "fake", status: "magic", approved: true },
      }),
    ).toThrow();
  });
  it("exposes a truthful configuration state; never serves demo materials as backend data", async () => {
    const session = await GET(
      new Request("https://school.example/api/session"),
    );
    expect(await session.json()).toEqual({ configured: false, profile: null });
    const feed = await GET(
      new Request("https://school.example/api/feed?kind=news"),
    );
    expect(feed.status).toBe(503);
    expect(JSON.stringify(await feed.json())).not.toContain("Большие идеи");
  });
  it("requires cron secret before accessing the database; rejects CSRF before auth", async () => {
    expect(
      (await GET(new Request("https://school.example/api/cron/cleanup")))
        .status,
    ).toBe(401);
    const result = await POST(
      new Request("https://school.example/api/auth", {
        method: "POST",
        headers: {
          origin: "https://evil.example",
          "content-type": "application/json",
        },
        body: "{}",
      }),
    );
    expect(result.status).toBe(403);
  });
  it("uses no-store headers for session responses and errors", async () => {
    for (const path of ["session", "feed?kind=requests", "cron/cleanup"]) {
      const response = await GET(
        new Request("https://school.example/api/" + path),
      );
      expect(response.headers.get("cache-control")).toContain("no-store");
    }
  });
});
