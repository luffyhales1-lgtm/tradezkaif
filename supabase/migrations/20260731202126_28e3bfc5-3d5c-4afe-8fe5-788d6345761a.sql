GRANT UPDATE ON public.profiles TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.user_roles TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.subscriptions TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.user_page_permissions TO authenticated;
GRANT UPDATE, DELETE ON public.access_requests TO authenticated;

CREATE POLICY "Admins update profiles" ON public.profiles FOR UPDATE TO authenticated USING (private.is_admin()) WITH CHECK (private.is_admin());
CREATE POLICY "Admins read profiles" ON public.profiles FOR SELECT TO authenticated USING (private.is_admin());
CREATE POLICY "Admins create roles" ON public.user_roles FOR INSERT TO authenticated WITH CHECK (private.is_admin());
CREATE POLICY "Admins update roles" ON public.user_roles FOR UPDATE TO authenticated USING (private.is_admin()) WITH CHECK (private.is_admin());
CREATE POLICY "Admins delete roles" ON public.user_roles FOR DELETE TO authenticated USING (private.is_admin());
CREATE POLICY "Admins create subscriptions" ON public.subscriptions FOR INSERT TO authenticated WITH CHECK (private.is_admin());
CREATE POLICY "Admins update subscriptions" ON public.subscriptions FOR UPDATE TO authenticated USING (private.is_admin()) WITH CHECK (private.is_admin());
CREATE POLICY "Admins delete subscriptions" ON public.subscriptions FOR DELETE TO authenticated USING (private.is_admin());
CREATE POLICY "Admins create permissions" ON public.user_page_permissions FOR INSERT TO authenticated WITH CHECK (private.is_admin());
CREATE POLICY "Admins update permissions" ON public.user_page_permissions FOR UPDATE TO authenticated USING (private.is_admin()) WITH CHECK (private.is_admin());
CREATE POLICY "Admins delete permissions" ON public.user_page_permissions FOR DELETE TO authenticated USING (private.is_admin());
CREATE POLICY "Admins update requests" ON public.access_requests FOR UPDATE TO authenticated USING (private.is_admin()) WITH CHECK (private.is_admin());
CREATE POLICY "Admins delete requests" ON public.access_requests FOR DELETE TO authenticated USING (private.is_admin());