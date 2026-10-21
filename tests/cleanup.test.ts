import { describe, it, expect } from "vitest";
import {
  cleanMedia,
  signedTtl,
  linkWithinStoryLifetime,
  type CleanupAdapter,
} from "../src/lib/cleanup";
describe("file lifecycle", () => {
  it("never deletes a row when its file removal fails; retries partial failures", async () => {
    const events: string[] = [];
    let fail = true;
    const pending = [
      { id: "a", path: "a.webp", attempts: 0 },
      { id: "b", path: "b.webp", attempts: 0 },
    ];
    const adapter: CleanupAdapter = {
      async prepare() {
        events.push("prepare");
      },
      async pending() {
        return [...pending];
      },
      async removeFile(path) {
        events.push("file:" + path);
        if (path === "a.webp" && fail) throw Error("network");
      },
      async removeRow(id) {
        events.push("row:" + id);
        pending.splice(
          pending.findIndex((r) => r.id === id),
          1,
        );
      },
      async retry(id, attempts, next) {
        events.push("retry:" + id);
        expect(attempts).toBe(1);
        expect(Date.parse(next)).toBeGreaterThan(1000);
      },
    };
    expect(await cleanMedia(adapter, 1000)).toEqual({
      removed: 1,
      failed: 1,
      more: false,
    });
    expect(events).not.toContain("row:a");
    expect(events.indexOf("file:b.webp")).toBeLessThan(events.indexOf("row:b"));
    fail = false;
    expect(await cleanMedia(adapter, 1000)).toEqual({
      removed: 1,
      failed: 0,
      more: false,
    });
    expect(await cleanMedia(adapter, 1000)).toEqual({
      removed: 0,
      failed: 0,
      more: false,
    });
  });
  it("retries safely after file deletion succeeds but database deletion fails", async () => {
    let rowExists = true,
      fileExists = true,
      dbFails = true;
    let deletes = 0;
    const adapter: CleanupAdapter = {
      async prepare() {},
      async pending() {
        return rowExists ? [{ id: "a", path: "a.webp", attempts: 1 }] : [];
      },
      async removeFile() {
        fileExists = false;
        deletes++;
      },
      async removeRow() {
        if (dbFails) throw Error("db");
        rowExists = false;
      },
      async retry() {},
    };
    await cleanMedia(adapter);
    expect(fileExists).toBe(false);
    expect(rowExists).toBe(true);
    dbFails = false;
    await cleanMedia(adapter);
    expect(rowExists).toBe(false);
    expect(deletes).toBe(2);
  });
  it("never signs beyond expiry, refuses expired and near-expiry stories", () => {
    const now = Date.now();
    expect(signedTtl(new Date(now + 21000).toISOString(), now)).toBe(19);
    expect(signedTtl(new Date(now - 1).toISOString(), now)).toBe(0);
    expect(signedTtl(new Date(now + 1500).toISOString(), now)).toBe(0);
    expect(signedTtl(new Date(now + 3600000).toISOString(), now)).toBe(60);
  });
  it("rejects actual signed tokens that exceed story expiry after a signing delay", () => {
    const now = Date.now(),
      expires = new Date(now + 20000).toISOString();
    const link = (exp: number) =>
      "https://test.supabase.co/storage/v1/object/sign/x?token=x." +
      Buffer.from(JSON.stringify({ exp })).toString("base64url") +
      ".signature";
    expect(
      linkWithinStoryLifetime(link(Math.floor(now / 1000) + 10), expires, now),
    ).toBe(true);
    expect(
      linkWithinStoryLifetime(link(Math.floor(now / 1000) + 30), expires, now),
    ).toBe(false);
    expect(
      linkWithinStoryLifetime("https://test.supabase.co/invalid", expires, now),
    ).toBe(false);
  });
});
