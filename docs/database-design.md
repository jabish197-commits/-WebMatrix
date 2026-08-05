# Supabase PostgreSQL database design

Primary tables: `users`, `roles`, `permissions`, `site_settings`, `pages`, `banners`, `contact_messages`, `notifications`, `refresh_tokens`, and `audit_logs`. Apply `server/supabase/schema.sql` from the Supabase SQL Editor. User roles are `super_admin`, `admin`, and `customer`; granular permissions are PostgreSQL text arrays. Express is the only data-access layer and uses the server-only service-role key.
