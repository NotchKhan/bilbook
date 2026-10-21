import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
  describe,
  it,
  expect,
} from "vitest";
let db: PGlite;
const schoolA = "10000000-0000-4000-8000-000000000001",
  schoolB = "10000000-0000-4000-8000-000000000002";
const student = "20000000-0000-4000-8000-000000000001",
  peer = "20000000-0000-4000-8000-000000000002",
  moderator = "20000000-0000-4000-8000-000000000003",
  adult = "20000000-0000-4000-8000-000000000004",
  other = "20000000-0000-4000-8000-000000000005",
  admin = "20000000-0000-4000-8000-000000000006",
  unconfirmed = "20000000-0000-4000-8000-000000000007";
const publicId = "30000000-0000-4000-8000-000000000001",
  privateId = "30000000-0000-4000-8000-000000000002",
  otherId = "30000000-0000-4000-8000-000000000003";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
async function rows<T = Record<string, unknown>>(
  sql: string,
  values: unknown[] = [],
) {
  return (await db.query<T>(sql, values)).rows;
}
async function as(uid: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [uid]);
  await db.exec("set local role authenticated");
}
async function root() {
  await db.exec("reset role");
}
async function command(action: string, payload: unknown = {}) {
  return (
    await rows<{ result: Record<string, unknown> }>(
      "select public.command($1,$2::jsonb) as result",
      [action, JSON.stringify(payload)],
    )
  )[0].result;
}
async function rejected(fn: () => Promise<unknown>, message?: RegExp) {
  await db.exec("savepoint expected_error");
  await expect(fn()).rejects.toThrow(message);
  await db.exec("rollback to savepoint expected_error");
}
async function ready(purpose = "story", owner = student, school = schoolA) {
  await root();
  const [m] = await rows<{ id: string }>(
    "insert into public.media(school_id,owner_id,purpose,path,state) values($1,$2,$3,gen_random_uuid()::text,'ready') returning id",
    [school, owner, purpose],
  );
  return m.id;
}
beforeAll(async () => {
  db = new PGlite();
  await db.waitReady;
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
 create schema auth; create schema storage;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
 alter table storage.objects enable row level security;
 grant usage on schema storage to anon,authenticated; grant select,insert,update,delete on storage.objects to anon,authenticated;`);
  await db.exec(
    readFileSync("supabase/migrations/202610210001_core.sql", "utf8"),
  );
  await db.query("insert into public.schools(id,name) values($1,$2),($3,$4)", [
    schoolA,
    "Тестовая школа А",
    schoolB,
    "Тестовая школа Б",
  ]);
  // Fixture users go through the REAL invitation trigger, then privileged fixture setup.
  for (const [uid, sid] of [
    [student, schoolA],
    [peer, schoolA],
    [moderator, schoolA],
    [adult, schoolA],
    [other, schoolB],
    [admin, schoolA],
    [unconfirmed, schoolA],
  ]) {
    const token = "fixture-" + uid;
    await db.query(
      "insert into public.invitations(school_id,token_hash,expires_at,max_uses) values($1,$2,now()+interval '1 day',1)",
      [sid, hash(token)],
    );
    await db.query(
      "insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values($1,'test@example.invalid',now(),$2::jsonb)",
      [
        uid,
        JSON.stringify({
          name: "Тестовый участник",
          invitation_token: token,
          role: "admin",
        }),
      ],
    );
  }
  await db.query("update public.profiles set role='moderator' where id=$1", [
    moderator,
  ]);
  await db.query(
    "update public.profiles set role='teacher',is_responder=true,is_editor=true where id=$1",
    [adult],
  );
  await db.query(
    "update public.profiles set role='admin',is_editor=true where id=$1",
    [admin],
  );
  await db.query("update auth.users set email_confirmed_at=null where id=$1", [
    unconfirmed,
  ]);
  await db.query(
    "insert into public.requests(id,school_id,title,body,category,confidential,approved) values($1,$4,'Публичная проблема','Нет горячей воды','dormitory',false,true),($2,$4,'Личная ситуация','Конфиденциальный текст','personal',true,false),($3,$5,'Другая школа','Другой текст','idea',false,true)",
    [publicId, privateId, otherId, schoolA, schoolB],
  );
  await db.query(
    "insert into public.request_authors(request_id,author_id) values($1,$4),($2,$4),($3,$5)",
    [publicId, privateId, otherId, student, other],
  );
});
beforeEach(async () => {
  await db.exec("begin");
});
afterEach(async () => {
  await db.exec("rollback");
});
afterAll(async () => {
  await db.close();
});

describe("actual migration / PostgreSQL RLS and RPC", () => {
  it("forces student role at signup; consumes invitation and removes token from metadata", async () => {
    expect(
      (
        await rows(
          "select role,is_editor,is_responder from public.profiles where id=$1",
          [student],
        )
      )[0],
    ).toEqual({ role: "student", is_editor: false, is_responder: false });
    expect(
      (
        await rows<{ raw_user_meta_data: Record<string, unknown> }>(
          "select raw_user_meta_data from auth.users where id=$1",
          [student],
        )
      )[0].raw_user_meta_data,
    ).not.toHaveProperty("invitation_token");
    await rejected(
      () =>
        db.query(
          "insert into auth.users(id,raw_user_meta_data) values(gen_random_uuid(),$1)",
          [
            JSON.stringify({
              name: "Новый участник",
              invitation_token: "fixture-" + student,
            }),
          ],
        ),
      /Приглашение/,
    );
    await rejected(
      () =>
        db.exec(
          'insert into auth.users(id,raw_user_meta_data) values(gen_random_uuid(),\'{"name":"Без приглашения"}\')',
        ),
      /Приглашение/,
    );
  });
  it("rejects expired and revoked invitations without creating a profile", async () => {
    for (const revoked of [false, true]) {
      const token = "invalid-invite-" + revoked;
      await db.query(
        "insert into public.invitations(school_id,token_hash,expires_at,max_uses,revoked) values($1,$2,now()+case when $3 then interval '1 day' else interval '-1 second' end,1,$3)",
        [schoolA, hash(token), revoked],
      );
      await rejected(
        () =>
          db.query(
            "insert into auth.users(id,raw_user_meta_data) values(gen_random_uuid(),$1)",
            [
              JSON.stringify({
                name: "Новый участник",
                invitation_token: token,
              }),
            ],
          ),
        /Приглашение/,
      );
    }
  });
  it("prevents student privilege escalation via SQL, admin RPC, profile JSON and auth metadata", async () => {
    await as(student);
    await rejected(
      () =>
        db.query("update public.profiles set role='admin' where id=$1", [
          student,
        ]),
      /permission denied/,
    );
    await rejected(
      () =>
        command("user", {
          id: student,
          role: "admin",
          is_editor: true,
          is_responder: true,
        }),
      /Нет доступа/,
    );
    await command("profile", {
      name: "Имя ученика",
      dormitory: true,
      role: "admin",
      is_responder: true,
      school_id: schoolB,
    });
    const [p] = await rows(
      "select role,is_responder,school_id from public.profiles where id=$1",
      [student],
    );
    expect(p).toEqual({
      role: "student",
      is_responder: false,
      school_id: schoolA,
    });
    await root();
    await db.query(
      'update auth.users set raw_user_meta_data=\'{"role":"admin"}\' where id=$1',
      [student],
    );
    await as(student);
    await rejected(
      () => command("invite", { days: 1, max_uses: 1 }),
      /Нет доступа/,
    );
  });
  it("isolates schools in reads, writes, reactions and attachments", async () => {
    await as(student);
    expect(
      (await rows("select id from public.schools")).map((r) => r.id),
    ).toEqual([schoolA]);
    expect(
      (await rows("select id from public.requests")).map((r) => r.id),
    ).not.toContain(otherId);
    expect(
      (await rows("select id from public.profiles")).map((r) => r.id),
    ).not.toContain(other);
    await rejected(
      () => command("support", { id: otherId, enabled: true }),
      /недоступно/,
    );
    const media = await ready("story", other, schoolB);
    await as(student);
    expect(
      await rows("select * from public.media where id=$1", [media]),
    ).toHaveLength(0);
    await rejected(
      () => command("story", { media_id: media }),
      /Файл недоступен/,
    );
    const result = await command("request", {
      title: "Новая проблема",
      body: "Описание проблемы",
      category: "idea",
      confidential: false,
      school_id: schoolB,
      author_id: other,
      approved: true,
    });
    await root();
    expect(
      (
        await rows(
          "select school_id,approved from public.requests where id=$1",
          [result.id],
        )
      )[0],
    ).toEqual({ school_id: schoolA, approved: false });
  });
  it("hides confidential requests and their author from peer, moderator, unassigned admin", async () => {
    for (const uid of [peer, moderator, admin]) {
      await as(uid);
      expect(
        await rows("select * from public.requests where id=$1", [privateId]),
      ).toHaveLength(0);
      expect(
        await rows("select * from public.request_authors where request_id=$1", [
          privateId,
        ]),
      ).toHaveLength(0);
      await rejected(
        () =>
          command("moderate_request", {
            id: privateId,
            status: "resolved",
            approved: false,
            response: "Ответ",
          }),
        /Нет доступа/,
      );
    }
  });
  it("allows the author and assigned adult, never publishes confidential material", async () => {
    for (const uid of [student, adult]) {
      await as(uid);
      expect(
        await rows("select id from public.requests where id=$1", [privateId]),
      ).toHaveLength(1);
    }
    await rejected(
      () =>
        command("moderate_request", {
          id: privateId,
          status: "progress",
          approved: true,
          response: "Ответ",
        }),
      /нельзя публиковать/,
    );
    await command("moderate_request", {
      id: privateId,
      status: "progress",
      approved: false,
      response: "Личный ответ",
    });
    await as(peer);
    expect(
      await rows("select * from public.request_history where request_id=$1", [
        privateId,
      ]),
    ).toHaveLength(0);
    await as(student);
    expect(
      await rows("select * from public.request_history where request_id=$1", [
        privateId,
      ]),
    ).toHaveLength(1);
  });
  it("keeps public author hidden from peers; deduplicates supports", async () => {
    await as(peer);
    expect(
      await rows("select * from public.request_authors where request_id=$1", [
        publicId,
      ]),
    ).toHaveLength(0);
    await command("support", { id: publicId, enabled: true });
    await command("support", { id: publicId, enabled: true });
    expect(
      (
        await rows<{ total: number }>(
          "select * from public.reaction_counts($1,$2)",
          ["requests", [publicId]],
        )
      )[0].total,
    ).toBe(1);
    await as(student);
    expect(
      await rows("select * from public.supports where request_id=$1", [
        publicId,
      ]),
    ).toHaveLength(0);
    await as(moderator);
    expect(
      await rows("select * from public.request_authors where request_id=$1", [
        publicId,
      ]),
    ).toHaveLength(1);
  });
  it("denies unconfirmed and blocked users regardless of JWT lifetime", async () => {
    await as(unconfirmed);
    expect(await rows("select * from public.news")).toHaveLength(0);
    await rejected(
      () =>
        command("request", { title: "Test", body: "Test", category: "idea" }),
      /Доступ не подтверждён/,
    );
    await root();
    await db.query("update public.profiles set blocked=true where id=$1", [
      student,
    ]);
    await as(student);
    expect(await rows("select * from public.requests")).toHaveLength(0);
    await rejected(() => command("invite", {}), /заблокирован/);
  });
  it("enforces editor appointment and records moderation without confidential text", async () => {
    await as(moderator);
    await rejected(
      () =>
        command("news", {
          title: "Новость",
          body: "Текст новости",
          category: "news",
        }),
      /Нет прав редактора/,
    );
    await as(adult);
    await command("news", {
      title: "Новость",
      body: "Текст новости",
      category: "news",
    });
    await command("moderate_request", {
      id: privateId,
      status: "resolved",
      approved: false,
      response: "Секретный ответ",
    });
    await root();
    expect(
      JSON.stringify(await rows("select * from public.audit_log")),
    ).not.toContain("Секретный ответ");
  });
  it("expires stories at publication +24h before cleanup and denies related media", async () => {
    const mid = await ready();
    await db.query(
      "insert into public.stories(school_id,author_id,media_id,created_at,expires_at) values($1,$2,$3,now()-interval '25 hours',now()-interval '1 hour')",
      [schoolA, student, mid],
    );
    await db.query("update public.media set state='attached' where id=$1", [
      mid,
    ]);
    await as(student);
    expect(await rows("select * from public.stories")).toHaveLength(0);
    expect(
      await rows("select * from public.media where id=$1", [mid]),
    ).toHaveLength(0);
    await root();
    const sid = (await rows("select id from public.stories"))[0].id;
    await as(student);
    await rejected(
      () => command("report", { id: sid, reason: "История истекла" }),
      /недоступна/,
    );
  });
  it("counts deleted stories toward the rolling daily maximum", async () => {
    for (let i = 0; i < 5; i++) {
      const mid = await ready();
      await as(student);
      const s = await command("story", { media_id: mid, caption: "" });
      await command("delete_story", { id: s.id });
    }
    const mid = await ready();
    await as(student);
    await rejected(() => command("story", { media_id: mid }), /Не более 5/);
    await root();
    expect(await rows("select * from public.story_publications")).toHaveLength(
      5,
    );
  });
  it("cleanup targets expired stories/stale staged files and preserves users, news and requests", async () => {
    const mid = await ready();
    await db.query(
      "insert into public.stories(school_id,author_id,media_id,created_at,expires_at) values($1,$2,$3,now()-interval '25 hours',now()-interval '1 hour')",
      [schoolA, student, mid],
    );
    await db.query("update public.media set state='attached' where id=$1", [
      mid,
    ]);
    const pending = await ready("request");
    await db.query(
      "update public.media set created_at=now()-interval '2 hours' where id=$1",
      [pending],
    );
    await db.query(
      "insert into public.news(school_id,title,body,category) values($1,'Тестовая новость','Постоянный текст','news')",
      [schoolA],
    );
    await db.exec(
      "select public.prepare_cleanup(); select public.prepare_cleanup();",
    );
    expect(await rows("select * from public.stories")).toHaveLength(0);
    expect(
      (
        await rows("select state from public.media where id=any($1)", [
          [mid, pending],
        ])
      ).every((r) => r.state === "deleting"),
    ).toBe(true);
    expect(await rows("select * from auth.users")).toHaveLength(7);
    expect(await rows("select * from public.requests")).toHaveLength(3);
    expect(await rows("select * from public.news")).toHaveLength(1);
  });
  it("protects confidential attachments with the same permissions as the text", async () => {
    const mid = await ready("request");
    await db.query("update public.media set state='attached' where id=$1", [
      mid,
    ]);
    await db.query("update public.requests set media_id=$1 where id=$2", [
      mid,
      privateId,
    ]);
    for (const uid of [peer, moderator, admin, other]) {
      await as(uid);
      expect(
        await rows("select * from public.media where id=$1", [mid]),
      ).toHaveLength(0);
    }
    for (const uid of [student, adult]) {
      await as(uid);
      expect(
        await rows("select * from public.media where id=$1", [mid]),
      ).toHaveLength(1);
    }
  });
  it("prevents editors deleting news whose author was removed", async () => {
    const [n] = await rows<{ id: string }>(
      "insert into public.news(school_id,title,body,category) values($1,'Тестовая новость','Постоянный текст','news') returning id",
      [schoolA],
    );
    await as(adult);
    await rejected(() => command("delete_news", { id: n.id }), /Нет доступа/);
    await as(admin);
    await command("delete_news", { id: n.id });
  });
  it("restricts account deletion to service-role and preserves the last administrator", async () => {
    await as(student);
    await rejected(
      () => db.query("select public.prepare_account_delete($1)", [student]),
      /permission denied/,
    );
    await root();
    await rejected(
      () => db.query("select public.prepare_account_delete($1)", [admin]),
      /другого администратора/,
    );
  });
  it("queues account photos and preserves anonymous request history on Auth deletion", async () => {
    const mid = await ready("request");
    await db.query("update public.media set state='attached' where id=$1", [
      mid,
    ]);
    await db.query("update public.requests set media_id=$1 where id=$2", [
      mid,
      privateId,
    ]);
    await db.query("select public.prepare_account_delete($1)", [student]);
    expect(
      (
        await rows("select blocked from public.profiles where id=$1", [student])
      )[0].blocked,
    ).toBe(true);
    await db.query("delete from auth.users where id=$1", [student]);
    expect(
      (
        await rows("select owner_id,state from public.media where id=$1", [mid])
      )[0],
    ).toEqual({ owner_id: null, state: "deleting" });
    expect(
      (
        await rows(
          "select author_id from public.request_authors where request_id=$1",
          [privateId],
        )
      )[0].author_id,
    ).toBeNull();
    expect(
      await rows("select * from public.requests where id=$1", [privateId]),
    ).toHaveLength(1);
  });
  it("denies direct access to Storage even when an authenticated user guesses a path", async () => {
    await db.exec(
      "insert into storage.objects(bucket_id,name) values('school-media','guess.webp')",
    );
    await as(student);
    expect(await rows("select * from storage.objects")).toHaveLength(0);
    await rejected(
      () =>
        db.exec(
          "insert into storage.objects(bucket_id,name) values('school-media','hack.webp')",
        ),
      /row-level security/,
    );
  });
});
