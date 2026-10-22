import { NextResponse } from "next/server";
import sharp from "sharp";
import { z } from "zod";
import { authSchema, parseCommand } from "@/lib/validation";
import {
  authLimit,
  checkDb,
  configured,
  cronAuthorized,
  failure,
  HttpError,
  json,
  limitedBody,
  readJson,
  requireUser,
  sameOrigin,
  serviceClient,
  userClient,
} from "@/lib/server";
import { cleanMedia, signedTtl, linkWithinStoryLifetime } from "@/lib/cleanup";
import type { FeedItem } from "@/lib/types";
import { imagePolicy } from "@/lib/image-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const pathOf = (r: Request) => new URL(r.url).pathname.replace("/api/", "");
const cursorSchema = z.object({
  at: z.iso.datetime({ offset: true }),
  id: z.uuid(),
});
function getCursor(url: URL) {
  const raw = url.searchParams.get("cursor");
  if (!raw) return null;
  try {
    return cursorSchema.parse(
      JSON.parse(Buffer.from(raw, "base64url").toString("utf8")),
    );
  } catch {
    throw new HttpError(400, "Неверная страница");
  }
}
function nextCursor(rows: { id: string; created_at: string }[]) {
  const last = rows.at(-1);
  return rows.length === 20 && last
    ? Buffer.from(
        JSON.stringify({ at: last.created_at, id: last.id }),
      ).toString("base64url")
    : null;
}

export async function GET(request: Request) {
  try {
    const path = pathOf(request),
      url = new URL(request.url);
    if (path === "cron/cleanup") return await cleanup(request);
    if (path === "session") {
      if (!configured()) return json({ configured: false, profile: null });
      try {
        const { db, user, profile } = await requireUser();
        const { data, error } = await db
          .from("schools")
          .select("name")
          .eq("id", profile.school_id)
          .single();
        checkDb(error);
        return json({
          configured: true,
          profile,
          school: data?.name,
          email: user.email,
        });
      } catch (e) {
        if (e instanceof HttpError && (e.status === 401 || e.status === 403))
          return json({
            configured: true,
            profile: null,
            error: e.status === 403 ? e.message : undefined,
          });
        throw e;
      }
    }
    const { db, profile } = await requireUser();
    if (path.startsWith("media/")) {
      const id = z.uuid().parse(path.split("/")[1]);
      // RLS proves access, including confidential request permissions, BEFORE service access.
      const { data: m, error } = await db
        .from("media")
        .select("*")
        .eq("id", id)
        .single();
      if (error || !m) throw new HttpError(404, "Фото недоступно");
      let expires: string | null = null;
      if (m.purpose === "story" && m.state === "attached") {
        const { data: s } = await db
          .from("stories")
          .select("expires_at")
          .eq("media_id", m.id)
          .single();
        if (!s) throw new HttpError(404, "История истекла");
        expires = s.expires_at;
      }
      const ttl = signedTtl(expires);
      if (ttl <= 0) throw new HttpError(410, "История истекла");
      const { data, error: se } = await serviceClient()
        .storage.from("school-media")
        .createSignedUrl(m.path, ttl);
      checkDb(se);
      if (!data) throw new HttpError(404, "Фото недоступно");
      if (expires && !linkWithinStoryLifetime(data.signedUrl, expires))
        throw new HttpError(410, "История истекла");
      return NextResponse.redirect(data.signedUrl, {
        status: 307,
        headers: { "Cache-Control": "private, no-store, max-age=0" },
      });
    }
    if (path.startsWith("request/")) {
      const id = z.uuid().parse(path.split("/")[1]);
      const { data: detail, error } = await db
        .from("requests")
        .select("*")
        .eq("id", id)
        .single();
      if (error || !detail) throw new HttpError(404, "Обращение недоступно");
      const { data: history, error: he } = await db
        .from("request_history")
        .select("*")
        .eq("request_id", id)
        .order("created_at", { ascending: false })
        .limit(50);
      checkDb(he);
      return json({ detail, history });
    }
    if (path.startsWith("story/")) {
      const id = z.uuid().parse(path.split("/")[1]);
      const { data, error } = await db
        .from("stories")
        .select("media_id,caption")
        .eq("id", id)
        .single();
      if (error || !data)
        throw new HttpError(404, "История удалена или срок её показа истёк.");
      return json(data);
    }
    if (path === "feed") {
      const kind = z
        .enum(["news", "stories", "requests"])
        .parse(url.searchParams.get("kind"));
      const view = z
        .enum(["public", "mine", "review", "confidential"])
        .parse(url.searchParams.get("view") || "public");
      const cursor = getCursor(url);
      let q = db
        .from(kind)
        .select(
          kind === "requests" && view === "mine"
            ? "*,request_authors!inner(author_id)"
            : "*",
        );
      if (kind === "requests") {
        if (view === "public")
          q = q.eq("confidential", false).eq("approved", true);
        if (view === "mine") q = q.eq("request_authors.author_id", profile.id);
        if (view === "review") {
          if (!["moderator", "admin"].includes(profile.role))
            throw new HttpError(403, "Нет доступа");
          q = q.eq("confidential", false);
        }
        if (view === "confidential") {
          if (
            !profile.is_responder ||
            !["teacher", "admin"].includes(profile.role)
          )
            throw new HttpError(403, "Нет доступа");
          q = q.eq("confidential", true);
        }
      }
      const category = url.searchParams.get("category");
      if (category && kind === "news")
        q = q.eq(
          "category",
          z.enum(["news", "achievement", "event", "dormitory"]).parse(category),
        );
      if (cursor)
        q = q.or(
          `created_at.lt.${cursor.at},and(created_at.eq.${cursor.at},id.lt.${cursor.id})`,
        );
      const { data, error } = await q
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(20);
      checkDb(error);
      const items = (data || []) as unknown as FeedItem[];
      if (items.length) {
        // Reactions and author metadata are independent; keep all queries under RLS.
        await Promise.all([
          (async () => {
        if (kind !== "stories") {
          const target = kind === "news" ? "likes" : "supports",
            column = kind === "news" ? "news_id" : "request_id";
          const [countsResult, ownResult] = await Promise.all([
            db.rpc("reaction_counts", { kind, ids: items.map((i) => i.id) }),
            db
            .from(target)
            .select(column)
            .in(
              column,
              items.map((i) => i.id),
            ),
          ]);
          const { data: counts, error: ce } = countsResult;
          const { data: own, error: oe } = ownResult;
          checkDb(ce);
          checkDb(oe);
          const reacted = new Set(
            (own || []).map(
              (v) => (v as unknown as Record<string, string>)[column],
            ),
          );
          for (const item of items) {
            item.total =
              (counts || []).find(
                (v: { id: string; total: number }) => v.id === item.id,
              )?.total || 0;
            item.reacted = reacted.has(item.id);
          }
        }
          })(),
          (async () => {
        if (kind === "requests") {
          const { data: authors, error: ae } = await db
            .from("request_authors")
            .select("*")
            .in(
              "request_id",
              items.map((i) => i.id),
            );
          checkDb(ae);
          for (const item of items) {
            const a = authors?.find((a) => a.request_id === item.id);
            item.mine = a?.author_id === profile.id;
            if (a) item.author_id = a.author_id;
          }
        }
        const authorIds = [
          ...new Set(
            items
              .map((i) => i.author_id)
              .filter((v): v is string => Boolean(v)),
          ),
        ];
        if (authorIds.length) {
          const { data: authors, error: ae } = await db
            .from("profiles")
            .select("id,name,avatar_id")
            .in("id", authorIds);
          checkDb(ae);
          for (const item of items) {
            const a = authors?.find((a) => a.id === item.author_id);
            item.author_name = a?.name;
            item.author_avatar = a?.avatar_id;
          }
        }
          })(),
        ]);
      }
      return json({ items, cursor: nextCursor(items) });
    }
    if (path === "admin") {
      const kind = z
        .enum(["profiles", "invitations", "reports", "audit_log"])
        .parse(url.searchParams.get("kind"));
      if (
        kind === "reports"
          ? !["moderator", "admin"].includes(profile.role)
          : profile.role !== "admin"
      )
        throw new HttpError(403, "Нет доступа");
      const cursor = getCursor(url);
      let q = db
        .from(kind)
        .select(
          kind === "invitations"
            ? "id,label,expires_at,max_uses,uses,revoked,created_at"
            : "*",
        );
      if (cursor)
        q = q.or(
          `created_at.lt.${cursor.at},and(created_at.eq.${cursor.at},id.lt.${cursor.id})`,
        );
      const { data, error } = await q
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(20);
      checkDb(error);
      return json({
        items: data || [],
        cursor: nextCursor(
          (data || []) as unknown as { id: string; created_at: string }[],
        ),
      });
    }
    throw new HttpError(404, "Страница не найдена");
  } catch (e) {
    return failure(e);
  }
}

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const path = pathOf(request);
    if (path === "auth") return await auth(request);
    if (path === "upload") return await upload(request);
    const { db, profile } = await requireUser();
    if (path === "command") {
      const { action, payload } = parseCommand(await readJson(request));
      const { data, error } = await db.rpc("command", { action, payload });
      if (error) {
        // Only READY media is discarded: a timed-out but committed publication stays intact.
        if ("media_id" in payload && payload.media_id)
          await discard(payload.media_id, profile.id);
        checkDb(error);
      }
      return json(data || {});
    }
    if (path === "discard") {
      const { id } = z.object({ id: z.uuid() }).parse(await readJson(request));
      await discard(id, profile.id);
      return json({ ok: true });
    }
    if (path === "account/delete") {
      const { password } = z
        .object({ password: z.string().min(1).max(128) })
        .parse(await readJson(request));
      const { user } = await requireUser();
      await authLimit(request, user.email);
      const { error: pe } = await db.auth.signInWithPassword({
        email: user.email!,
        password,
      });
      if (pe) throw new HttpError(403, "Пароль не подтверждён");
      const svc = serviceClient();
      if (profile.role === "admin") {
        const { count, error } = await svc
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .eq("school_id", profile.school_id)
          .eq("role", "admin")
          .eq("blocked", false);
        checkDb(error);
        if (!count || count <= 1)
          throw new HttpError(
            409,
            "Сначала назначьте другого администратора школы.",
          );
      }
      const { error: prep } = await svc.rpc("prepare_account_delete", {
        uid: profile.id,
      });
      checkDb(prep);
      const { error } = await svc.auth.admin.deleteUser(profile.id);
      if (error)
        await svc
          .from("profiles")
          .update({ blocked: false })
          .eq("id", profile.id);
      checkDb(error);
      await db.auth.signOut();
      return json({ ok: true });
    }
    throw new HttpError(404, "Действие не найдено");
  } catch (e) {
    return failure(e);
  }
}

async function auth(request: Request) {
  const values = authSchema.parse(await readJson(request));
  const db = await userClient();
  if (values.action === "signout") {
    const { error } = await db.auth.signOut();
    if (error)
      throw new HttpError(502, "Не удалось завершить сессию. Повторите выход.");
    const response = json({ ok: true });
    response.headers.set("Clear-Site-Data", '"cache", "storage"');
    return response;
  }
  await authLimit(request, "email" in values ? values.email : "");
  if (values.action === "signin") {
    const { error } = await db.auth.signInWithPassword({
      email: values.email,
      password: values.password,
    });
    if (error)
      throw new HttpError(
        400,
        "Не удалось войти. Проверьте email, пароль и подтверждение почты.",
      );
  } else if (values.action === "signup") {
    const { error } = await db.auth.signUp({
      email: values.email,
      password: values.password,
      options: {
        data: { name: values.name, invitation_token: values.invitation_token },
        emailRedirectTo: process.env.APP_URL + "/auth/callback",
      },
    });
    if (error)
      throw new HttpError(
        400,
        "Регистрация не завершена. Проверьте приглашение и данные или обратитесь к администратору.",
      );
    return json({
      message:
        "Если регистрация доступна для этого email, вы получите письмо. Подтвердите почту, затем войдите.",
    });
  } else if (values.action === "reset") {
    const { error } = await db.auth.resetPasswordForEmail(values.email, {
      redirectTo: process.env.APP_URL + "/auth/callback?reset=1",
    });
    if (error)
      throw new HttpError(
        502,
        "Сервис писем временно недоступен. Повторите позже.",
      );
    return json({
      message:
        "Если аккаунт существует, ссылка для восстановления придёт на почту.",
    });
  } else if (values.action === "password") {
    await requireUser();
    const { error } = await db.auth.updateUser({ password: values.password });
    if (error)
      throw new HttpError(
        400,
        "Не удалось обновить пароль. Запросите новую ссылку.",
      );
  }
  return json({ ok: true });
}

async function upload(request: Request) {
  const { db, profile } = await requireUser();
  const { error: rateError } = await db.rpc("command", {
    action: "upload_attempt",
    payload: {},
  });
  checkDb(rateError);
  const bytes = await limitedBody(request, 9 * 1024 * 1024);
  const form = await new Request(request.url, {
    method: "POST",
    headers: { "Content-Type": request.headers.get("content-type") || "" },
    body: bytes,
  }).formData();
  const purpose = z
    .enum(["story", "news", "request", "avatar"])
    .parse(form.get("purpose"));
  const file = form.get("file");
  if (!(file instanceof File) || file.size > 8 * 1024 * 1024 || file.size === 0)
    throw new HttpError(400, "Фото: JPEG, PNG или WebP, до 8 МБ.");
  const source = Buffer.from(await file.arrayBuffer());
  let output: Buffer;
  try {
    const image = sharp(source, {
      limitInputPixels: 40000000,
      animated: false,
      failOn: "warning",
    });
    const meta = await image.metadata();
    if (
      !["jpeg", "png", "webp"].includes(meta.format || "") ||
      (meta.pages || 1) > 1
    )
      throw new Error("format");
    output = await image
      .rotate()
      .resize({
        width: imagePolicy(purpose).edge,
        height: imagePolicy(purpose).edge,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: imagePolicy(purpose).quality })
      .toBuffer();
  } catch {
    throw new HttpError(
      400,
      "Не удалось прочитать фото. Выберите обычный JPEG, PNG или WebP.",
    );
  }
  if (output.length > 3 * 1024 * 1024)
    throw new HttpError(
      400,
      "После сжатия фото слишком большое. Выберите другое.",
    );
  const { data: m, error } = await db.rpc("command", {
    action: "reserve_media",
    payload: { purpose },
  });
  checkDb(error);
  const svc = serviceClient();
  try {
    const { error: ue } = await svc.storage
      .from("school-media")
      .upload(m.path, output, {
        contentType: "image/webp",
        cacheControl: "0",
        upsert: false,
      });
    checkDb(ue);
    const { data: row, error: me } = await svc
      .from("media")
      .update({ state: "ready" })
      .eq("id", m.id)
      .eq("state", "pending")
      .select("id")
      .single();
    checkDb(me);
    if (!row)
      throw new HttpError(409, "Загрузка устарела. Попробуйте ещё раз.");
    return json({ id: m.id });
  } catch (e) {
    await svc
      .from("media")
      .update({ state: "deleting" })
      .eq("id", m.id)
      .eq("owner_id", profile.id)
      .in("state", ["pending", "ready"]);
    const { error: de } = await svc.storage
      .from("school-media")
      .remove([m.path]);
    if (!de)
      await svc.from("media").delete().eq("id", m.id).eq("state", "deleting");
    throw e;
  }
}
async function discard(id: string, owner: string) {
  const svc = serviceClient();
  const { data, error } = await svc
    .from("media")
    .update({ state: "deleting" })
    .eq("id", id)
    .eq("owner_id", owner)
    .eq("state", "ready")
    .select("*");
  checkDb(error);
  for (const m of data || []) {
    const { error: de } = await svc.storage
      .from("school-media")
      .remove([m.path]);
    if (!de)
      await svc.from("media").delete().eq("id", m.id).eq("state", "deleting");
  }
}
async function cleanup(request: Request) {
  if (
    !cronAuthorized(
      request.headers.get("authorization"),
      process.env.CRON_SECRET,
    )
  )
    throw new HttpError(401, "Нет доступа");
  const svc = serviceClient();
  const start = Date.now();
  let removed = 0,
    failed = 0,
    more = false;
  do {
    const result = await cleanMedia({
      async prepare() {
        const { error } = await svc.rpc("prepare_cleanup");
        checkDb(error);
      },
      async pending(limit) {
        const { data, error } = await svc
          .from("media")
          .select("id,path,attempts")
          .eq("state", "deleting")
          .lte("next_retry_at", new Date().toISOString())
          .order("next_retry_at")
          .limit(limit);
        checkDb(error);
        return data || [];
      },
      async removeFile(path) {
        const { error } = await svc.storage.from("school-media").remove([path]);
        checkDb(error);
      },
      async removeRow(id) {
        const { error } = await svc
          .from("media")
          .delete()
          .eq("id", id)
          .eq("state", "deleting");
        checkDb(error);
      },
      async retry(id, attempts, next_retry_at) {
        const { error } = await svc
          .from("media")
          .update({ attempts, next_retry_at })
          .eq("id", id)
          .eq("state", "deleting");
        checkDb(error);
      },
    });
    removed += result.removed;
    failed += result.failed;
    more = result.more;
  } while (more && Date.now() - start < 40000);
  return json({ removed, failed, more }, failed ? 207 : 200);
}
