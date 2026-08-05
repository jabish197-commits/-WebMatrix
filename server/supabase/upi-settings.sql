-- Run once in Supabase SQL Editor to enable Super Admin UPI configuration.
alter table public.site_settings
  add column if not exists merchant_upi_id text default '';
