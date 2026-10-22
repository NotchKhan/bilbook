-- BilBook: Google onboarding, school directory, biography and consent-based friendship.
-- Apply AFTER 202610210001_core.sql, once, in a transaction.
begin;
alter table public.profiles add column bio text not null default '' check(length(bio)<=300);
alter table public.profiles add column requested_role text not null default 'student' check(requested_role in ('student','teacher'));
update public.profiles set requested_role='teacher' where role='teacher';
drop policy profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using(id=auth.uid() or (school_id=public.my_school() and (not blocked or public.school_admin())));
create index profiles_directory on public.profiles(school_id,class_name,name,id) where not blocked;

create table public.friendships (
 id uuid primary key default gen_random_uuid(),
 school_id uuid not null references public.schools(id),
 requester_id uuid not null references public.profiles(id) on delete cascade,
 addressee_id uuid not null references public.profiles(id) on delete cascade,
 status text not null default 'pending' check(status in ('pending','accepted')),
 created_at timestamptz not null default now(), check(requester_id<>addressee_id)
);
create unique index friendship_pair on public.friendships(least(requester_id,addressee_id),greatest(requester_id,addressee_id));
create index friendship_recipient on public.friendships(addressee_id,status);
create index friendship_sender on public.friendships(requester_id,status);
alter table public.friendships enable row level security;
revoke all on public.friendships from public,anon,authenticated;
grant select on public.friendships to authenticated;
grant all on public.friendships to service_role;
create policy friendships_read on public.friendships for select to authenticated using (
 school_id=public.my_school() and auth.uid() in (requester_id,addressee_id)
 and exists(select 1 from public.profiles p where p.id=requester_id and not p.blocked)
 and exists(select 1 from public.profiles p where p.id=addressee_id and not p.blocked)
);

create or replace function private.before_signup() returns trigger language plpgsql security definer set search_path='' as $$
declare inv public.invitations; token text; requested text; cls text; begin
 -- Provider is server-owned app metadata, never user metadata. Google users have no
 -- school membership until a confirmed session consumes an invitation in enroll().
 if new.raw_app_meta_data->>'provider'='google' then
   new.raw_user_meta_data:=jsonb_build_object('name',left(coalesce(new.raw_user_meta_data->>'full_name',new.raw_user_meta_data->>'name',''),80));
   return new;
 end if;
 token:=new.raw_user_meta_data->>'invitation_token';
 select * into inv from public.invitations where token_hash=encode(sha256(convert_to(coalesce(token,''),'UTF8')),'hex') for update;
 if inv.id is null or inv.revoked or inv.expires_at<=now() or inv.uses>=inv.max_uses then raise exception 'Приглашение недействительно'; end if;
 if length(coalesce(new.raw_user_meta_data->>'name','')) not between 2 and 80 then raise exception 'Укажите имя и фамилию'; end if;
 requested:=coalesce(new.raw_user_meta_data->>'requested_role','student');
 cls:=nullif(new.raw_user_meta_data->>'class_name','');
 if requested not in ('student','teacher') or (cls is not null and cls !~ '^(7|8|9|10|11)[ABC]$') then raise exception 'Проверьте класс и тип аккаунта'; end if;
 if new.raw_user_meta_data ? 'requested_role' and requested='student' and cls is null then raise exception 'Выберите класс'; end if;
 update public.invitations set uses=uses+1 where id=inv.id;
 new.raw_user_meta_data:=jsonb_build_object('name',new.raw_user_meta_data->>'name','school_id',inv.school_id,'requested_role',requested,'class_name',cls);
 return new;
end$$;
create or replace function private.after_signup() returns trigger language plpgsql security definer set search_path='' as $$begin
 if new.raw_app_meta_data->>'provider'='google' then return new; end if;
 insert into public.profiles(id,school_id,name,class_name,requested_role) values(new.id,(new.raw_user_meta_data->>'school_id')::uuid,new.raw_user_meta_data->>'name',new.raw_user_meta_data->>'class_name',coalesce(new.raw_user_meta_data->>'requested_role','student'));
 return new;
end$$;

create function public.enroll(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); inv public.invitations; requested text:=payload->>'requested_role'; cls text:=nullif(payload->>'class_name',''); full_name text:=trim(payload->>'name'); begin
 if uid is null then raise exception 'Войдите в аккаунт' using errcode='42501'; end if;
 perform 1 from auth.users where id=uid and email_confirmed_at is not null for update;
 if not found then raise exception 'Подтвердите почту' using errcode='42501'; end if;
 if exists(select 1 from public.profiles where id=uid) then raise exception 'Профиль уже создан'; end if;
 perform private.take_rate(uid||':enroll',8,3600);
 if full_name is null or length(full_name) not between 3 and 80 or position(' ' in full_name)=0 then raise exception 'Укажите имя и фамилию'; end if;
 if requested is null or requested not in ('student','teacher') then raise exception 'Выберите тип аккаунта'; end if;
 if (requested='student' and cls is null) or (cls is not null and cls !~ '^(7|8|9|10|11)[ABC]$') then raise exception 'Выберите класс'; end if;
 select * into inv from public.invitations where token_hash=encode(sha256(convert_to(coalesce(payload->>'invitation_token',''),'UTF8')),'hex') for update;
 if inv.id is null or inv.revoked or inv.expires_at<=now() or inv.uses>=inv.max_uses then raise exception 'Приглашение недействительно'; end if;
 update public.invitations set uses=uses+1 where id=inv.id;
 insert into public.profiles(id,school_id,name,class_name,requested_role) values(uid,inv.school_id,full_name,cls,requested);
 return '{}'::jsonb;
end$$;
revoke all on function public.enroll(jsonb) from public,anon;
grant execute on function public.enroll(jsonb) to authenticated;

-- Preserve all original command checks; only add explicitly supported operations.
alter function public.command(text,jsonb) rename to command_v1;
alter function public.command_v1(text,jsonb) set schema private;
revoke all on function private.command_v1(text,jsonb) from public,anon,authenticated;
create function public.command(action text,payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.profiles; target public.profiles; f public.friendships; result jsonb; op text:=payload->>'operation'; cls text; begin
 if action not in ('profile','friend') then return private.command_v1(action,payload); end if;
 select * into p from private.active_profile();
 if p.id is null then raise exception 'Нет доступа' using errcode='42501'; end if;
 if action='profile' then
   cls:=nullif(payload->>'class_name','');
   if cls is not null and cls !~ '^(7|8|9|10|11)[ABC]$' then raise exception 'Выберите класс 7–11 и A, B или C'; end if;
   if length(coalesce(payload->>'bio',''))>300 then raise exception 'Описание: максимум 300 символов'; end if;
   result:=private.command_v1(action,payload);
   if payload ? 'bio' then update public.profiles set bio=coalesce(payload->>'bio','') where id=p.id; end if;
   return result;
 end if;
 perform private.take_rate(p.id||':friend',30,60);
 if op is null or op not in ('request','accept','remove') then raise exception 'Неизвестное действие'; end if;
 -- Serialize changes per school so simultaneous reciprocal requests create one row.
 perform 1 from public.schools where id=p.school_id for update;
 select * into target from public.profiles where id=(payload->>'id')::uuid and school_id=p.school_id and not blocked and exists(select 1 from auth.users au where au.id=profiles.id and au.email_confirmed_at is not null);
 if target.id is null or target.id=p.id then raise exception 'Участник недоступен' using errcode='42501'; end if;
 select * into f from public.friendships where least(requester_id,addressee_id)=least(p.id,target.id) and greatest(requester_id,addressee_id)=greatest(p.id,target.id) for update;
 if op='request' then
   if f.id is null then
     perform private.take_rate(p.id||':friend_daily',20,86400);
     if (select count(*) from public.friendships where requester_id=p.id and status='pending')>=50 then raise exception 'Завершите предыдущие заявки'; end if;
     insert into public.friendships(school_id,requester_id,addressee_id) values(p.school_id,p.id,target.id); end if;
 elsif op='accept' then
   if f.id is null or f.addressee_id<>p.id or f.status<>'pending' then raise exception 'Заявка недоступна' using errcode='42501'; end if;
   update public.friendships set status='accepted' where id=f.id;
 elsif op='remove' then
   delete from public.friendships where id=f.id;
 end if;
 return '{}'::jsonb;
end$$;
revoke all on function public.command(text,jsonb) from public,anon;
grant execute on function public.command(text,jsonb) to authenticated;

create function public.people(search_text text default '', class_filter text default '', kind text default 'all', page_offset integer default 0)
returns table(id uuid,name text,class_name text,bio text,role text,requested_role text,avatar_id uuid,relationship text)
language plpgsql stable security definer set search_path='' as $$
declare p public.profiles; begin
 select * into p from private.active_profile();
 if p.id is null then raise exception 'Нет доступа' using errcode='42501'; end if;
 if kind not in ('all','teachers','friends','incoming','outgoing') or page_offset not between 0 and 10000 or length(search_text)>80 or (class_filter<>'' and class_filter !~ '^(7|8|9|10|11)[ABC]$') then raise exception 'Неверный фильтр'; end if;
 return query select u.id,u.name,u.class_name,u.bio,u.role,u.requested_role,u.avatar_id,
   case when f.status='accepted' then 'friends' when f.requester_id=p.id then 'outgoing' when f.addressee_id=p.id then 'incoming' else 'none' end
 from public.profiles u left join public.friendships f on f.school_id=p.school_id and least(f.requester_id,f.addressee_id)=least(p.id,u.id) and greatest(f.requester_id,f.addressee_id)=greatest(p.id,u.id)
 where u.school_id=p.school_id and not u.blocked and u.id<>p.id
 and exists(select 1 from auth.users au where au.id=u.id and au.email_confirmed_at is not null)
 and (search_text='' or position(lower(search_text) in lower(u.name))>0)
 and (class_filter='' or u.class_name=class_filter)
 and (kind='all' or (kind='teachers' and u.role='teacher') or (kind='friends' and f.status='accepted') or (kind='incoming' and f.status='pending' and f.addressee_id=p.id) or (kind='outgoing' and f.status='pending' and f.requester_id=p.id))
 order by u.name,u.id limit 21 offset page_offset;
end$$;
revoke all on function public.people(text,text,text,integer) from public,anon;
grant execute on function public.people(text,text,text,integer) to authenticated;
revoke all on function private.before_signup(),private.after_signup() from public,anon,authenticated;
commit;
