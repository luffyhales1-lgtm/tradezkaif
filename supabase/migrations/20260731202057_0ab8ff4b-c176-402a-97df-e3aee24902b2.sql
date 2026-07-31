REVOKE INSERT, UPDATE ON public.profiles FROM authenticated;
DROP POLICY "Users create own profile" ON public.profiles;
DROP POLICY "Users update own safe profile" ON public.profiles;

CREATE OR REPLACE FUNCTION public.handle_new_user_profile()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (NEW.id, lower(coalesce(NEW.email, '')), coalesce(NEW.raw_user_meta_data->>'full_name', split_part(coalesce(NEW.email, ''), '@', 1)))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.handle_new_user_profile() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER on_auth_user_created_profile AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_profile();

CREATE OR REPLACE FUNCTION private.is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
$$;
REVOKE ALL ON FUNCTION private.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_admin() TO authenticated;

DROP POLICY "Users read own roles" ON public.user_roles;
CREATE POLICY "Users read own roles" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid() OR private.is_admin());
DROP POLICY "Users read own subscription" ON public.subscriptions;
CREATE POLICY "Users read own subscription" ON public.subscriptions FOR SELECT TO authenticated USING (user_id = auth.uid() OR private.is_admin());
DROP POLICY "Users read own permissions" ON public.user_page_permissions;
CREATE POLICY "Users read own permissions" ON public.user_page_permissions FOR SELECT TO authenticated USING (user_id = auth.uid() OR private.is_admin());
DROP POLICY "Users read own request" ON public.access_requests;
CREATE POLICY "Users read own request" ON public.access_requests FOR SELECT TO authenticated USING (user_id = auth.uid() OR private.is_admin());

REVOKE ALL ON FUNCTION private.has_role(uuid, public.app_role) FROM authenticated;
DROP FUNCTION private.has_role(uuid, public.app_role);