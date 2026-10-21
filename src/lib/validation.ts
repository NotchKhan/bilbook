import { z } from "zod";
const id = z.uuid();
const media_id = id.nullish();
const title = z.string().trim().min(3, "Заголовок: минимум 3 символа").max(140);
const body = z.string().trim().min(3, "Добавьте описание").max(10000);
export const commands = {
  profile: z.object({
    name: z.string().trim().min(2).max(80),
    class_name: z.string().trim().max(16).optional(),
    dormitory: z.boolean(),
    media_id,
  }),
  story: z.object({
    media_id: id,
    caption: z.string().trim().max(180).default(""),
  }),
  delete_story: z.object({ id }),
  news: z.object({
    title,
    body,
    category: z.enum(["news", "achievement", "event", "dormitory"]),
    media_id,
  }),
  delete_news: z.object({ id }),
  request: z.object({
    title,
    body: body.max(6000),
    category: z.enum([
      "dormitory",
      "canteen",
      "facilities",
      "idea",
      "personal",
    ]),
    confidential: z.boolean(),
    media_id,
  }),
  like: z.object({ id, enabled: z.boolean() }),
  support: z.object({ id, enabled: z.boolean() }),
  report: z.object({ id, reason: z.string().trim().min(3).max(1000) }),
  moderate_request: z.object({
    id,
    approved: z.boolean(),
    status: z.enum(["received", "progress", "resolved", "rejected"]),
    response: z.string().trim().max(4000),
  }),
  invite: z.object({
    label: z.string().trim().max(100),
    days: z.number().int().min(1).max(30),
    max_uses: z.number().int().min(1).max(100),
  }),
  revoke_invite: z.object({ id }),
  user: z.object({
    id,
    role: z.enum(["student", "teacher", "moderator", "admin"]),
    blocked: z.boolean(),
    is_editor: z.boolean(),
    is_responder: z.boolean(),
  }),
  resolve_report: z.object({ id }),
} as const;
export type Command = keyof typeof commands;
export const authSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("signin"),
    email: z.email().max(254),
    password: z.string().min(1).max(128),
  }),
  z.object({
    action: z.literal("signup"),
    email: z.email().max(254),
    password: z.string().min(10, "Пароль: минимум 10 символов").max(128),
    name: z.string().trim().min(2).max(80),
    invitation_token: z.string().trim().min(32).max(128),
  }),
  z.object({ action: z.literal("reset"), email: z.email().max(254) }),
  z.object({
    action: z.literal("password"),
    password: z.string().min(10).max(128),
  }),
  z.object({ action: z.literal("signout") }),
]);
export function parseCommand(value: unknown) {
  const outer = z
    .object({
      action: z.enum(Object.keys(commands) as [Command, ...Command[]]),
      payload: z.unknown(),
    })
    .parse(value);
  return {
    action: outer.action,
    payload: commands[outer.action].parse(outer.payload),
  };
}
