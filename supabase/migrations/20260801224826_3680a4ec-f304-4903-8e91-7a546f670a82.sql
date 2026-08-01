insert into public.user_roles (user_id, role)
select id, 'admin'::app_role from public.profiles where lower(email) = 'luffyhales1@gmail.com'
on conflict (user_id, role) do nothing;

update public.profiles set access_status = 'active' where lower(email) = 'luffyhales1@gmail.com';