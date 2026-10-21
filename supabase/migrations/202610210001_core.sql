-- BilSpace v1. Run in a NEW Supabase project. All writes go through checked RPCs.
create schema if not exists private;
revoke all on schema private from public;

create table public.schools (
 id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 2 and 120), created_at timestamptz not null default now()
);
create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 school_id uuid not null references public.schools(id), name text not null check(length(name) between 2 and 80),
 role text not null default 'student' check(role in ('student','teacher','moderator','admin')),
 is_editor boolean not null default false, is_responder boolean not null default false, blocked boolean not null default false,
 class_name text check(length(class_name)<=16), dormitory boolean not null default false, avatar_id uuid,
 created_at timestamptz not null default now(),
 check(not is_editor or role in ('teacher','moderator','admin')),
 check(not is_responder or role in ('teacher','admin'))
);
create table public.invitations (
 id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools,
 token_hash text not null unique, label text not null default '' check(length(label)<=100),
 expires_at timestamptz not null, max_uses integer not null check(max_uses between 1 and 100), uses integer not null default 0 check(uses>=0),
 revoked boolean not null default false, created_at timestamptz not null default now()
);
create table public.media (
 id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools,
 owner_id uuid references public.profiles on delete set null,
 purpose text not null check(purpose in ('story','news','request','avatar')),
 path text not null unique, state text not null default 'pending' check(state in ('pending','ready','attached','deleting')),
 attempts integer not null default 0, next_retry_at timestamptz not null default now(),
 created_at timestamptz not null default now()
);
alter table public.profiles add constraint profiles_avatar_fk foreign key(avatar_id) references public.media on delete set null;
create table public.stories (
 id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools,
 author_id uuid not null references public.profiles on delete cascade, media_id uuid not null unique references public.media,
 caption text not null default '' check(length(caption)<=180), created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '24 hours', check(expires_at=created_at+interval '24 hours')
);
create index stories_feed on public.stories(school_id,expires_at,created_at desc);
-- Independent ledger: deleting a story does NOT restore the daily publishing allowance.
create table public.story_publications (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade, created_at timestamptz not null default now());
create index on public.story_publications(user_id,created_at);
create table public.news (
 id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools,
 author_id uuid references public.profiles on delete set null,
 category text not null check(category in ('news','achievement','event','dormitory')),
 title text not null check(length(title) between 3 and 140), body text not null check(length(body) between 3 and 10000),
 media_id uuid unique references public.media on delete set null, created_at timestamptz not null default now()
);
create index on public.news(school_id,created_at desc,id);
create table public.requests (
 id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools,
 confidential boolean not null default false,
 title text not null check(length(title) between 3 and 140), body text not null check(length(body) between 3 and 6000),
 category text not null check(category in ('dormitory','canteen','facilities','idea','personal')),
 approved boolean not null default false,
 status text not null default 'received' check(status in ('received','progress','resolved','rejected')),
 response text not null default '' check(length(response)<=4000), media_id uuid unique references public.media on delete set null,
 created_at timestamptz not null default now(), check(not confidential or not approved)
);
-- Author identity deliberately absent from the school-visible relation.
create table public.request_authors (
 request_id uuid primary key references public.requests on delete cascade,
 author_id uuid references public.profiles on delete set null
);
create index on public.request_authors(author_id);
create index on public.requests(school_id,confidential,approved,created_at desc,id);
create table public.request_history (
 id uuid primary key default gen_random_uuid(), request_id uuid not null references public.requests on delete cascade,
 status text not null check(status in ('received','progress','resolved','rejected')),
 response text not null default '' check(length(response)<=4000), created_at timestamptz not null default now()
);
create table public.likes (news_id uuid not null references public.news on delete cascade, user_id uuid not null references public.profiles on delete cascade, primary key(news_id,user_id));
create table public.supports (request_id uuid not null references public.requests on delete cascade, user_id uuid not null references public.profiles on delete cascade, primary key(request_id,user_id));
create table public.reports (
 id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools,
 reporter_id uuid references public.profiles on delete set null, story_id uuid references public.stories on delete set null,
 reason text not null check(length(reason) between 3 and 1000), resolved boolean not null default false, created_at timestamptz not null default now(), unique(reporter_id,story_id)
);
-- Never contains request bodies, responses, invitation tokens, emails or names.
create table public.audit_log (id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools, actor_id uuid references public.profiles on delete set null, action text not null, target_id uuid, created_at timestamptz not null default now());
create table public.rate_limits (key text primary key, hits integer not null, expires_at timestamptz not null);

create function private.active_profile() returns public.profiles language sql stable security definer set search_path='' as $$
 select p from public.profiles p join auth.users u on u.id=p.id where p.id=auth.uid() and not p.blocked and u.email_confirmed_at is not null
$$;
create function public.my_school() returns uuid language sql stable security definer set search_path='' as $$select (private.active_profile()).school_id$$;
create function public.school_staff() returns boolean language sql stable security definer set search_path='' as $$select coalesce((private.active_profile()).role in ('moderator','admin'),false)$$;
create function public.school_admin() returns boolean language sql stable security definer set search_path='' as $$select coalesce((private.active_profile()).role='admin',false)$$;
create function public.confidential_responder() returns boolean language sql stable security definer set search_path='' as $$select coalesce((private.active_profile()).is_responder and (private.active_profile()).role in ('teacher','admin'),false)$$;
create function public.request_owner(rid uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.request_authors a where a.request_id=rid and a.author_id=auth.uid()) and public.my_school() is not null$$;
create function public.can_read_request(rid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.requests r where r.id=rid and r.school_id=public.my_school() and
 (public.request_owner(r.id) or (r.confidential and public.confidential_responder()) or (not r.confidential and (r.approved or public.school_staff()))))
$$;
create function public.can_read_media(mid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.media m where m.id=mid and m.school_id=public.my_school() and m.state in ('ready','attached') and (
 (m.owner_id=auth.uid() and m.state='ready') or
 exists(select 1 from public.stories s where s.media_id=m.id and s.expires_at>now()) or
 exists(select 1 from public.news n where n.media_id=m.id) or
 exists(select 1 from public.requests r where r.media_id=m.id and public.can_read_request(r.id)) or
 exists(select 1 from public.profiles p where p.avatar_id=m.id and not p.blocked)))
$$;

-- Fail-closed RLS. No ordinary role has INSERT/UPDATE/DELETE grants or write policies.
do $$declare t text; begin
 foreach t in array array['schools','profiles','invitations','media','stories','story_publications','news','requests','request_authors','request_history','likes','supports','reports','audit_log','rate_limits'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon, authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 end loop;
end$$;
create policy schools_read on public.schools for select to authenticated using(id=public.my_school());
create policy profiles_read on public.profiles for select to authenticated using(school_id=public.my_school());
create policy invitations_read on public.invitations for select to authenticated using(school_id=public.my_school() and public.school_admin());
create policy media_read on public.media for select to authenticated using(public.can_read_media(id));
create policy stories_read on public.stories for select to authenticated using(school_id=public.my_school() and expires_at>now());
create policy news_read on public.news for select to authenticated using(school_id=public.my_school());
create policy requests_read on public.requests for select to authenticated using(public.can_read_request(id));
create policy request_authors_read on public.request_authors for select to authenticated using(public.can_read_request(request_id) and (author_id=auth.uid() or (exists(select 1 from public.requests r where r.id=request_id and not r.confidential) and public.school_staff()) or public.confidential_responder()));
create policy history_read on public.request_history for select to authenticated using(public.can_read_request(request_id));
-- Readers get only their own reaction row; totals via RPC, without supporter identities.
create policy likes_read on public.likes for select to authenticated using(user_id=auth.uid() and exists(select 1 from public.news n where n.id=news_id));
create policy supports_read on public.supports for select to authenticated using(user_id=auth.uid() and public.can_read_request(request_id));
create policy reports_read on public.reports for select to authenticated using(school_id=public.my_school() and public.school_staff());
create policy audit_read on public.audit_log for select to authenticated using(school_id=public.my_school() and public.school_admin());

create function private.take_rate(k text, maximum integer, seconds integer) returns void language plpgsql security definer set search_path='' as $$
declare n integer; begin
 insert into public.rate_limits(key,hits,expires_at) values(k,1,now()+make_interval(secs=>seconds))
 on conflict(key) do update set hits=case when rate_limits.expires_at<=now() then 1 else rate_limits.hits+1 end,
 expires_at=case when rate_limits.expires_at<=now() then excluded.expires_at else rate_limits.expires_at end
 returning hits into n;
 if n>maximum then raise exception 'Слишком часто. Повторите позже.' using errcode='P0001'; end if;
end$$;
-- Only the server calls this before auth requests. IP is HMACed by the server.
create function public.auth_rate(k text) returns void language plpgsql security definer set search_path='' as $$begin
 if length(k)>200 then raise exception 'Invalid key'; end if;
 perform private.take_rate('auth:'||k,12,900);
end$$;
revoke all on function public.auth_rate(text) from public,anon,authenticated;
grant execute on function public.auth_rate(text) to service_role;

create function private.before_signup() returns trigger language plpgsql security definer set search_path='' as $$
declare inv public.invitations; token text; begin
 token:=new.raw_user_meta_data->>'invitation_token';
 select * into inv from public.invitations where token_hash=encode(sha256(convert_to(coalesce(token,''),'UTF8')),'hex') for update;
 if inv.id is null or inv.revoked or inv.expires_at<=now() or inv.uses>=inv.max_uses then raise exception 'Приглашение недействительно'; end if;
 if length(coalesce(new.raw_user_meta_data->>'name','')) not between 2 and 80 then raise exception 'Укажите имя'; end if;
 update public.invitations set uses=uses+1 where id=inv.id;
 new.raw_user_meta_data:=jsonb_build_object('name',new.raw_user_meta_data->>'name','school_id',inv.school_id);
 return new;
end$$;
create trigger bilspace_invite before insert on auth.users for each row execute function private.before_signup();
create function private.after_signup() returns trigger language plpgsql security definer set search_path='' as $$begin
 insert into public.profiles(id,school_id,name) values(new.id,(new.raw_user_meta_data->>'school_id')::uuid,new.raw_user_meta_data->>'name'); return new;
end$$;
create trigger bilspace_profile after insert on auth.users for each row execute function private.after_signup();

create function private.discard_media() returns trigger language plpgsql security definer set search_path='' as $$begin
 if old.media_id is not null then update public.media set state='deleting',next_retry_at=now() where id=old.media_id; end if; return old;
end$$;
create trigger story_discard after delete on public.stories for each row execute function private.discard_media();
create trigger news_discard after delete on public.news for each row execute function private.discard_media();
create trigger request_discard after delete on public.requests for each row execute function private.discard_media();

create function private.attach_media(mid uuid, expected text, p public.profiles) returns void language plpgsql security definer set search_path='' as $$begin
 if mid is null then return; end if;
 update public.media set state='attached' where id=mid and owner_id=p.id and school_id=p.school_id and purpose=expected and state='ready';
 if not found then raise exception 'Файл недоступен или уже использован'; end if;
end$$;

-- Single transactional command boundary. Never trust role, school_id or author_id from JSON.
create function public.command(action text, payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.profiles; m public.media; r public.requests; n public.news; s public.stories;
 target public.profiles; rid uuid; mid uuid; token text; role_value text; result jsonb:='{}'; begin
 select * into p from private.active_profile();
 if p.id is null then raise exception 'Доступ не подтверждён или аккаунт заблокирован' using errcode='42501'; end if;
 if length(action)>32 then raise exception 'Неизвестное действие'; end if;
 perform private.take_rate(p.id||':'||action,30,60);
 if octet_length(payload::text)>30000 then raise exception 'Слишком большой запрос'; end if;
 case action
 when 'upload_attempt' then
   perform private.take_rate(p.id||':upload_attempts',20,3600);
 when 'profile' then
   if length(coalesce(payload->>'name','')) not between 2 and 80 then raise exception 'Имя: 2–80 символов'; end if;
   mid:=nullif(payload->>'media_id','')::uuid;
   if mid is not null then
     perform private.attach_media(mid,'avatar',p);
     update public.media set state='deleting' where id=p.avatar_id;
   end if;
   update public.profiles set name=payload->>'name',class_name=nullif(payload->>'class_name',''),dormitory=coalesce((payload->>'dormitory')::boolean,false),avatar_id=coalesce(mid,avatar_id) where id=p.id;
 when 'reserve_media' then
   if payload->>'purpose' not in ('story','news','request','avatar') then raise exception 'Неверный тип файла'; end if;
   if payload->>'purpose'='news' and not (p.is_editor and p.role in ('teacher','moderator','admin')) then raise exception 'Нет прав редактора' using errcode='42501'; end if;
   perform private.take_rate(p.id||':uploads',20,3600);
   if (select count(*) from public.media where owner_id=p.id and state in ('pending','ready'))>=5 then raise exception 'Завершите предыдущие загрузки или повторите позже'; end if;
   mid:=gen_random_uuid();
   insert into public.media(id,school_id,owner_id,purpose,path) values(mid,p.school_id,p.id,payload->>'purpose',p.school_id||'/'||p.id||'/'||mid||'.webp') returning * into m;
   result:=to_jsonb(m);
 when 'story' then
   perform 1 from public.profiles where id=p.id for update;
   if (select count(*) from public.story_publications where user_id=p.id and created_at>now()-interval '24 hours')>=5 then raise exception 'Не более 5 историй за 24 часа'; end if;
   mid:=(payload->>'media_id')::uuid;
   if mid is null then raise exception 'Добавьте фотографию'; end if;
   perform private.attach_media(mid,'story',p);
   insert into public.stories(school_id,author_id,media_id,caption) values(p.school_id,p.id,mid,coalesce(payload->>'caption','')) returning id into rid;
   insert into public.story_publications(user_id) values(p.id); result:=jsonb_build_object('id',rid);
 when 'delete_story' then
   select * into s from public.stories where id=(payload->>'id')::uuid and school_id=p.school_id for update;
   if s.id is null or (s.author_id<>p.id and p.role not in ('moderator','admin')) then raise exception 'Нет доступа' using errcode='42501'; end if;
   delete from public.stories where id=s.id;
   if s.author_id<>p.id then insert into public.audit_log(school_id,actor_id,action,target_id) values(p.school_id,p.id,action,s.id); end if;
 when 'news' then
   if not (p.is_editor and p.role in ('teacher','moderator','admin')) then raise exception 'Нет прав редактора' using errcode='42501'; end if;
   mid:=nullif(payload->>'media_id','')::uuid; perform private.attach_media(mid,'news',p);
   insert into public.news(school_id,author_id,title,body,category,media_id) values(p.school_id,p.id,payload->>'title',payload->>'body',payload->>'category',mid) returning id into rid;
   insert into public.audit_log(school_id,actor_id,action,target_id) values(p.school_id,p.id,action,rid); result:=jsonb_build_object('id',rid);
 when 'delete_news' then
   select * into n from public.news where id=(payload->>'id')::uuid and school_id=p.school_id for update;
   if n.id is null or not (p.role in ('moderator','admin') or (coalesce(n.author_id=p.id,false) and p.is_editor)) then raise exception 'Нет доступа' using errcode='42501'; end if;
   delete from public.news where id=n.id;
   insert into public.audit_log(school_id,actor_id,action,target_id) values(p.school_id,p.id,action,n.id);
 when 'request' then
   perform private.take_rate(p.id||':requests',5,3600);
   mid:=nullif(payload->>'media_id','')::uuid; perform private.attach_media(mid,'request',p);
   insert into public.requests(school_id,title,body,category,confidential,media_id) values(p.school_id,payload->>'title',payload->>'body',payload->>'category',coalesce((payload->>'confidential')::boolean,false),mid) returning id into rid;
   insert into public.request_authors(request_id,author_id) values(rid,p.id);
   insert into public.request_history(request_id,status) values(rid,'received'); result:=jsonb_build_object('id',rid);
 when 'like' then
   rid:=(payload->>'id')::uuid;
   if not exists(select 1 from public.news where id=rid and school_id=p.school_id) then raise exception 'Новость недоступна' using errcode='42501'; end if;
   if coalesce((payload->>'enabled')::boolean,true) then insert into public.likes(news_id,user_id) values(rid,p.id) on conflict do nothing; else delete from public.likes where news_id=rid and user_id=p.id; end if;
 when 'support' then
   rid:=(payload->>'id')::uuid;
   if not exists(select 1 from public.requests where id=rid and school_id=p.school_id and approved and not confidential) then raise exception 'Обращение недоступно' using errcode='42501'; end if;
   if coalesce((payload->>'enabled')::boolean,true) then insert into public.supports(request_id,user_id) values(rid,p.id) on conflict do nothing; else delete from public.supports where request_id=rid and user_id=p.id; end if;
 when 'report' then
   rid:=(payload->>'id')::uuid;
   if not exists(select 1 from public.stories where id=rid and school_id=p.school_id and expires_at>now()) then raise exception 'История недоступна' using errcode='42501'; end if;
   perform private.take_rate(p.id||':reports',10,3600);
   insert into public.reports(school_id,reporter_id,story_id,reason) values(p.school_id,p.id,rid,payload->>'reason') on conflict(reporter_id,story_id) do nothing;
 when 'moderate_request' then
   select * into r from public.requests where id=(payload->>'id')::uuid and school_id=p.school_id for update;
   if r.id is null or (r.confidential and not public.confidential_responder()) or (not r.confidential and not public.school_staff()) then raise exception 'Нет доступа' using errcode='42501'; end if;
   if r.confidential and coalesce((payload->>'approved')::boolean,false) then raise exception 'Конфиденциальное обращение нельзя публиковать'; end if;
   if payload->>'status' not in ('received','progress','resolved','rejected') then raise exception 'Неверный статус'; end if;
   update public.requests set approved=case when r.confidential then false else coalesce((payload->>'approved')::boolean,false) end,status=payload->>'status',response=coalesce(payload->>'response','') where id=r.id;
   insert into public.request_history(request_id,status,response) values(r.id,payload->>'status',coalesce(payload->>'response',''));
   insert into public.audit_log(school_id,actor_id,action,target_id) values(p.school_id,p.id,action,r.id);
 when 'invite' then
   if p.role<>'admin' then raise exception 'Нет доступа' using errcode='42501'; end if;
   token:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
   if (payload->>'days')::integer not between 1 and 30 then raise exception 'Срок: 1–30 дней'; end if;
   insert into public.invitations(school_id,token_hash,label,expires_at,max_uses) values(p.school_id,encode(sha256(convert_to(token,'UTF8')),'hex'),coalesce(payload->>'label',''),now()+make_interval(days=>(payload->>'days')::integer),(payload->>'max_uses')::integer) returning id into rid;
   result:=jsonb_build_object('token',token,'id',rid);
   insert into public.audit_log(school_id,actor_id,action,target_id) values(p.school_id,p.id,action,rid);
 when 'revoke_invite' then
   if p.role<>'admin' then raise exception 'Нет доступа' using errcode='42501'; end if;
   update public.invitations set revoked=true where id=(payload->>'id')::uuid and school_id=p.school_id returning id into rid;
   insert into public.audit_log(school_id,actor_id,action,target_id) values(p.school_id,p.id,action,rid);
 when 'user' then
   perform 1 from public.schools where id=p.school_id for update;
   select * into p from private.active_profile();
   if p.id is null or p.role<>'admin' then raise exception 'Нет доступа' using errcode='42501'; end if;
   select * into target from public.profiles where id=(payload->>'id')::uuid and school_id=p.school_id for update;
   if target.id is null or target.id=p.id then raise exception 'Собственные права изменяются другим администратором'; end if;
   role_value:=payload->>'role';
   if role_value is null or role_value not in ('student','teacher','moderator','admin') then raise exception 'Неверная роль'; end if;
   update public.profiles set role=role_value,blocked=coalesce((payload->>'blocked')::boolean,false),is_editor=coalesce((payload->>'is_editor')::boolean,false),is_responder=coalesce((payload->>'is_responder')::boolean,false) where id=target.id;
   insert into public.audit_log(school_id,actor_id,action,target_id) values(p.school_id,p.id,action,target.id);
 when 'resolve_report' then
   if not public.school_staff() then raise exception 'Нет доступа' using errcode='42501'; end if;
   update public.reports set resolved=true where id=(payload->>'id')::uuid and school_id=p.school_id returning id into rid;
   insert into public.audit_log(school_id,actor_id,action,target_id) values(p.school_id,p.id,action,rid);
 else raise exception 'Неизвестное действие';
 end case;
 return result;
end$$;

create function public.reaction_counts(kind text, ids uuid[]) returns table(id uuid,total bigint) language sql stable security definer set search_path='' as $$
 select n.id,(select count(*) from public.likes l where l.news_id=n.id) from public.news n where kind='news' and n.id=any(ids[1:20]) and n.school_id=public.my_school()
 union all
 select r.id,(select count(*) from public.supports s where s.request_id=r.id) from public.requests r where kind='requests' and r.id=any(ids[1:20]) and r.school_id=public.my_school() and r.approved and not r.confidential
$$;

-- Service-only lifecycle entry. Rows survive failed Storage operations and can be retried.
create function public.prepare_cleanup() returns void language plpgsql security definer set search_path='' as $$begin
 delete from public.stories where expires_at<=now();
 update public.media set state='deleting' where state in ('pending','ready') and created_at<now()-interval '1 hour';
 delete from public.rate_limits where expires_at<now()-interval '1 day';
 delete from public.story_publications where created_at<now()-interval '48 hours';
end$$;
create function public.prepare_account_delete(uid uuid) returns void language plpgsql security definer set search_path='' as $$
declare p public.profiles; begin
 select * into p from public.profiles where id=uid;
 if p.id is null then return; end if;
 perform 1 from public.schools where id=p.school_id for update;
 select * into p from public.profiles where id=uid for update;
 if p.role='admin' and not p.blocked and (select count(*) from public.profiles where school_id=p.school_id and role='admin' and not blocked)<=1 then raise exception 'Сначала назначьте другого администратора школы'; end if;
 update public.profiles set blocked=true where id=uid;
 -- Delete authored photos/content while retaining anonymous request records and text news.
 delete from public.stories where author_id=uid;
 update public.profiles set avatar_id=null where id=uid;
 update public.media set state='deleting' where owner_id=uid;
 update public.news set media_id=null where media_id in(select id from public.media where owner_id=uid);
 update public.requests set media_id=null where media_id in(select id from public.media where owner_id=uid);
end$$;

-- Authenticated clients cannot mint arbitrary-duration links, list or mutate private files.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('school-media','school-media',false,3145728,array['image/webp']) on conflict(id) do nothing;
create policy bilspace_storage_deny on storage.objects as restrictive for all to anon,authenticated using(bucket_id<>'school-media') with check(bucket_id<>'school-media');

-- Revoke PostgreSQL's default function EXECUTE privilege, including all definer helpers.
revoke all on all functions in schema private from public,anon,authenticated;
revoke all on all functions in schema public from public,anon,authenticated;
grant execute on function public.my_school(), public.school_staff(), public.school_admin(), public.confidential_responder(), public.request_owner(uuid), public.can_read_request(uuid), public.can_read_media(uuid), public.command(text,jsonb), public.reaction_counts(text,uuid[]) to authenticated;
grant execute on function public.auth_rate(text), public.prepare_cleanup(), public.prepare_account_delete(uuid) to service_role;
grant all on all tables in schema public to service_role;
