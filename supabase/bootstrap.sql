-- MANUAL SQL EDITOR ONLY, as project owner. Run once after migrations.
-- Change the school name before executing. Save the returned token privately.
with school as (
 insert into public.schools(name) values('Название вашего БИЛ / КТЛ') returning id
), secret as (
 select replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','') as token
), created as (
 insert into public.invitations(school_id,token_hash,label,expires_at,max_uses)
 select school.id,encode(sha256(convert_to(secret.token,'UTF8')),'hex'),'Первый администратор',now()+interval '1 day',1 from school,secret
 returning school_id
)
select created.school_id,secret.token as invitation_token from created,secret;

-- THEN register using the token, confirm email and find your exact UUID in Auth Users.
-- Run the block below separately, replacing the placeholder. Never put this in an HTTP route.
-- do $$
-- declare target uuid := 'REPLACE_WITH_CONFIRMED_USER_UUID'; p public.profiles;
-- begin
--   select * into p from public.profiles where id=target;
--   if p.id is null or not exists(select 1 from auth.users where id=target and email_confirmed_at is not null) then raise exception 'Confirmed user required'; end if;
--   perform 1 from public.schools where id=p.school_id for update;
--   if exists(select 1 from public.profiles where school_id=p.school_id and role='admin') then raise exception 'Admin already exists: use the admin panel'; end if;
--   update public.profiles set role='admin',is_editor=true where id=target;
--   insert into public.audit_log(school_id,actor_id,action,target_id) values(p.school_id,target,'bootstrap_admin',target);
-- end $$;
