-- OPTIONAL. Fictional text only. Run in a disposable DEVELOPMENT Supabase project.
-- Separate from migrations. Does not create Auth accounts, weaken RLS or create an admin.
do $$declare sid uuid; begin
 select id into sid from public.schools where name='Тестовый БИЛ';
 if sid is null then insert into public.schools(name) values('Тестовый БИЛ') returning id into sid; end if;
 insert into public.news(school_id,title,body,category)
 values(sid,'Добро пожаловать в тестовое сообщество','Это вымышленная новость для проверки интерфейса. Реальных персональных данных здесь нет.','news');
end$$;
