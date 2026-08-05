-- Run once in Supabase SQL Editor before enabling Razorpay payments.
alter table public.orders add column if not exists gateway_order_id text;
alter table public.orders add column if not exists gateway_payment_id text;
alter table public.orders add column if not exists gateway_provider text;
alter table public.orders add column if not exists gateway_reference text;
alter table public.orders add column if not exists gateway_amount numeric(12,2);
alter table public.orders add column if not exists gateway_status text;
alter table public.orders add column if not exists payment_proof_url text;
create unique index if not exists orders_gateway_order_id_unique
  on public.orders(gateway_order_id) where gateway_order_id is not null;
create unique index if not exists orders_gateway_payment_id_unique
  on public.orders(gateway_payment_id) where gateway_payment_id is not null;
create unique index if not exists orders_gateway_reference_unique
  on public.orders(gateway_reference) where gateway_reference is not null;
