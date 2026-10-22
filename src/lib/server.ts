import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Profile } from "./types";
export const configured = () =>
  Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY &&
    process.env.SUPABASE_SERVICE_ROLE_KEY &&
    process.env.RATE_LIMIT_SECRET &&
    process.env.APP_URL,
  );
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function requireConfig() {
  if (!configured())
    throw new HttpError(
      503,
      "Подключение Supabase ещё не настроено. См. README проекта.",
    );
}
export async function userClient() {
  requireConfig();
  const jar = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => jar.getAll(),
        setAll: (values) => {
          for (const { name, value, options } of values)
            jar.set(name, value, {
              ...options,
              httpOnly: true,
              sameSite: "lax",
              secure: process.env.NODE_ENV === "production",
            });
        },
      },
    },
  );
}
export function serviceClient() {
  requireConfig();
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
export async function requireUser() {
  const db = await userClient();
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (error || !user)
    throw new HttpError(401, "Войдите по школьному приглашению.");
  if (!user.email_confirmed_at)
    throw new HttpError(403, "Подтвердите email по ссылке в письме.");
  const { data: profile, error: pe } = await db
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();
  if (pe && pe.code !== "PGRST116") checkDb(pe);
  if (!profile && (!pe || pe.code === "PGRST116"))
    throw new HttpError(409, "Завершите регистрацию в школе.");
  if (pe || !profile || profile.blocked)
    throw new HttpError(
      403,
      "Доступ ограничен. Обратитесь к администратору школы.",
    );
  return { db, user, profile: profile as Profile };
}
export function json(value: unknown, status = 200) {
  return NextResponse.json(value, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      Vary: "Cookie",
    },
  });
}
export function failure(error: unknown) {
  if (error instanceof z.ZodError)
    return json(
      { error: error.issues[0]?.message || "Проверьте поля формы" },
      400,
    );
  if (error instanceof HttpError)
    return json({ error: error.message }, error.status);
  console.error(
    "BilBook request failed",
    error instanceof Error ? error.name : "unknown",
  );
  return json(
    { error: "Не удалось выполнить действие. Повторите позже." },
    500,
  );
}
export function checkDb(error: { message: string; code?: string } | null) {
  if (!error) return;
  if (error.code === "42501")
    throw new HttpError(403, "Нет доступа к этому действию.");
  if (error.code === "P0001") throw new HttpError(400, error.message);
  if (
    error.code === "23514" ||
    error.code === "22P02" ||
    error.code === "23502"
  )
    throw new HttpError(400, "Проверьте значения полей.");
  throw new HttpError(
    502,
    "База данных недоступна или миграции ещё не применены.",
  );
}
export function sameOrigin(request: Request) {
  const expected = new URL(process.env.APP_URL || request.url).origin;
  if (request.headers.get("origin") !== expected)
    throw new HttpError(403, "Запрос должен быть отправлен с сайта школы.");
}
export async function limitedBody(request: Request, max: number) {
  if (Number(request.headers.get("content-length") || 0) > max)
    throw new HttpError(413, "Файл или запрос слишком большой.");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "Пустой запрос");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw new HttpError(413, "Файл или запрос слишком большой.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
export async function readJson(request: Request) {
  try {
    return JSON.parse(
      (await limitedBody(request, 32768)).toString("utf8"),
    ) as unknown;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, "Неверный формат запроса");
  }
}
export async function authLimit(request: Request, email = "") {
  // Vercel overwrites x-vercel-forwarded-for; local preview shares a single bucket.
  const ip = process.env.VERCEL
    ? request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
      "unknown"
    : "local";
  const hash = (s: string) =>
    createHmac("sha256", process.env.RATE_LIMIT_SECRET!)
      .update(s)
      .digest("hex");
  const svc = serviceClient();
  for (const k of [hash(ip), ...(email ? [hash(email.toLowerCase())] : [])]) {
    const { error } = await svc.rpc("auth_rate", { k });
    if (error)
      throw new HttpError(429, "Слишком много попыток. Подождите 15 минут.");
  }
}
export function cronAuthorized(
  header: string | null,
  secret: string | undefined,
) {
  if (!secret || secret.length < 32 || !header) return false;
  const got = Buffer.from(header),
    wanted = Buffer.from("Bearer " + secret);
  return got.length === wanted.length && timingSafeEqual(got, wanted);
}
