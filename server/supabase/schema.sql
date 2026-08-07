create extension if not exists pgcrypto;

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(), name text not null, email text not null unique,
  password_hash text not null, role text not null default 'customer' check (role in ('super_admin','admin','customer')),
  permissions text[] not null default '{}', status text not null default 'active' check (status in ('active','suspended')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.site_settings (
  id uuid primary key default gen_random_uuid(), singleton text not null unique default 'main', platform_name text default 'WebMatrix',
  logo_url text default '', banner_url text default '', primary_color text default '#6d5dfc', accent_color text default '#18c8b4',
  text_color text default '#172033', home_heading text default 'Build, manage, and grow with WebMatrix',
  home_text text default 'One configurable platform for your team and customers.', about_text text default 'WebMatrix is a flexible multi-purpose web platform.',
  contact_email text default 'hello@webmatrix.local', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.site_settings add column if not exists storefront_font text default 'DM Sans';
alter table public.site_settings add column if not exists storefront_text_color text default '#152018';
alter table public.site_settings add column if not exists storefront_background_color text default '#f7f5ef';
alter table public.site_settings add column if not exists header_background_color text default '#fffdf8';
alter table public.site_settings add column if not exists hero_start_color text default '#f4efe4';
alter table public.site_settings add column if not exists hero_end_color text default '#e6eee3';
alter table public.site_settings add column if not exists circle_color text default '#e7a93f';
alter table public.site_settings add column if not exists button_color text default '#18251b';
alter table public.site_settings add column if not exists button_text_color text default '#ffffff';
alter table public.site_settings add column if not exists collection_background_color text default '#f7f5ef';
alter table public.site_settings add column if not exists card_background_color text default '#ffffff';
alter table public.site_settings add column if not exists card_border_color text default '#e8e5dc';
alter table public.site_settings add column if not exists card_border_style text default 'solid';
alter table public.site_settings add column if not exists card_border_width integer default 1;
alter table public.site_settings add column if not exists card_radius integer default 18;
alter table public.site_settings add column if not exists cards_per_row integer default 3;
alter table public.site_settings add column if not exists collection_product_limit integer default 12;
alter table public.site_settings add column if not exists background_image_url text default '';
alter table public.site_settings add column if not exists merchant_upi_id text default '';
alter table public.site_settings add column if not exists delivery_fee numeric(12,2) not null default 79;
alter table public.site_settings add column if not exists free_delivery_threshold numeric(12,2) not null default 999;
alter table public.site_settings add column if not exists offer_text text not null default 'LIMITED-TIME OFFER • Shop new arrivals today';
alter table public.site_settings add column if not exists offer_background_color text not null default '#e7a93f';
alter table public.site_settings add column if not exists offer_text_color text not null default '#152018';
alter table public.site_settings add column if not exists offer_animation_enabled boolean not null default true;
alter table public.site_settings add column if not exists offer_animation_style text not null default 'scroll-left';
alter table public.site_settings add column if not exists offer_animation_speed integer not null default 20;
create table if not exists public.roles (id uuid primary key default gen_random_uuid(), name text unique not null, permissions text[] default '{}', created_at timestamptz default now());
create table if not exists public.permissions (id uuid primary key default gen_random_uuid(), key text unique not null, description text, created_at timestamptz default now());
create table if not exists public.pages (id uuid primary key default gen_random_uuid(), slug text unique not null, title text, heading text, content text, seo_title text, seo_description text, is_published boolean default true, created_at timestamptz default now(), updated_at timestamptz default now());
create table if not exists public.banners (id uuid primary key default gen_random_uuid(), title text, image_url text not null, link_url text, position integer default 0, is_active boolean default true, created_at timestamptz default now());
create table if not exists public.contact_messages (id uuid primary key default gen_random_uuid(), name text, email text, subject text, message text, status text default 'new', created_at timestamptz default now());
create table if not exists public.notifications (id uuid primary key default gen_random_uuid(), user_id uuid references public.users(id) on delete cascade, title text, message text, read_at timestamptz, created_at timestamptz default now());
create table if not exists public.refresh_tokens (id uuid primary key default gen_random_uuid(), user_id uuid references public.users(id) on delete cascade, token_hash text not null, expires_at timestamptz not null, created_at timestamptz default now());
create table if not exists public.password_reset_tokens (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id) on delete cascade, token_hash text not null unique, expires_at timestamptz not null, used_at timestamptz, created_at timestamptz not null default now());
create table if not exists public.audit_logs (id uuid primary key default gen_random_uuid(), actor_id uuid references public.users(id) on delete set null, action text, resource text, resource_id text, metadata jsonb default '{}', ip text, created_at timestamptz default now());

insert into public.site_settings(singleton) values ('main') on conflict (singleton) do nothing;
alter table public.users enable row level security; alter table public.site_settings enable row level security; alter table public.roles enable row level security;
alter table public.permissions enable row level security; alter table public.pages enable row level security; alter table public.banners enable row level security;
alter table public.contact_messages enable row level security; alter table public.notifications enable row level security; alter table public.refresh_tokens enable row level security; alter table public.audit_logs enable row level security;
alter table public.password_reset_tokens enable row level security;
revoke all on all tables in schema public from anon, authenticated;
grant all on all tables in schema public to service_role;

-- Shopping catalog and order system
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(), name text not null unique, slug text not null unique,
  description text default '', image_url text default '', is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(), category_id uuid references public.categories(id) on delete set null,
  name text not null, description text default '', price numeric(12,2) not null check(price >= 0),
  stock integer not null default 0 check(stock >= 0), image_url text default '',
  delivery_fee numeric(12,2) not null default 79 check(delivery_fee >= 0),
  is_featured boolean not null default false, is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.products add column if not exists delivery_fee numeric(12,2) not null default 79 check(delivery_fee >= 0);
create table if not exists public.addresses (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id) on delete cascade,
  full_name text not null, phone text not null, line1 text not null, line2 text default '', city text not null,
  state text not null, postal_code text not null, country text not null default 'India', is_default boolean default false,
  created_at timestamptz not null default now()
);
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(), order_number text not null unique,
  user_id uuid not null references public.users(id) on delete restrict,
  status text not null default 'placed' check(status in ('placed','confirmed','packed','shipped','delivered','cancelled')),
  payment_method text not null default 'cod' check(payment_method in ('cod','online')),
  payment_status text not null default 'pending' check(payment_status in ('pending','paid','failed','refunded')),
  gateway_order_id text unique, gateway_payment_id text unique, gateway_provider text,
  gateway_reference text, gateway_amount numeric(12,2), gateway_status text,
  payment_proof_url text,
  subtotal numeric(12,2) not null, shipping numeric(12,2) not null default 0, total numeric(12,2) not null,
  shipping_address jsonb not null, notes text default '', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null, product_name text not null,
  price numeric(12,2) not null, quantity integer not null check(quantity > 0), line_total numeric(12,2) not null
);
create index if not exists products_category_idx on public.products(category_id);
create index if not exists products_active_idx on public.products(is_active,created_at desc);
create index if not exists orders_user_idx on public.orders(user_id,created_at desc);
create unique index if not exists orders_gateway_reference_unique on public.orders(gateway_reference) where gateway_reference is not null;
alter table public.categories enable row level security; alter table public.products enable row level security;
alter table public.addresses enable row level security; alter table public.orders enable row level security; alter table public.order_items enable row level security;
revoke all on public.categories,public.products,public.addresses,public.orders,public.order_items from anon,authenticated;
grant all on public.categories,public.products,public.addresses,public.orders,public.order_items to service_role;

create or replace function public.checkout_order(p_user_id uuid,p_items jsonb,p_address jsonb,p_payment_method text default 'cod',p_notes text default '')
returns uuid language plpgsql security definer set search_path=public as $$
declare v_order_id uuid; v_subtotal numeric(12,2):=0; v_shipping numeric(12,2):=0; v_free_delivery_threshold numeric(12,2):=999; v_item jsonb; v_product products%rowtype; v_qty integer; v_number text;
begin
  if jsonb_array_length(p_items)=0 then raise exception 'Cart is empty'; end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty:=(v_item->>'quantity')::integer;
    select * into v_product from products where id=(v_item->>'productId')::uuid and is_active=true for update;
    if not found then raise exception 'Product unavailable'; end if;
    if v_qty<1 or v_product.stock<v_qty then raise exception 'Insufficient stock for %',v_product.name; end if;
    v_subtotal:=v_subtotal+(v_product.price*v_qty);
    v_shipping:=v_shipping+v_product.delivery_fee;
  end loop;
  select free_delivery_threshold into v_free_delivery_threshold from site_settings where singleton='main';
  if v_free_delivery_threshold>0 and v_subtotal>=v_free_delivery_threshold then v_shipping:=0; end if;
  v_number:='WM-'||to_char(now(),'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
  insert into orders(order_number,user_id,payment_method,subtotal,shipping,total,shipping_address,notes)
  values(v_number,p_user_id,p_payment_method,v_subtotal,v_shipping,v_subtotal+v_shipping,p_address,p_notes) returning id into v_order_id;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty:=(v_item->>'quantity')::integer; select * into v_product from products where id=(v_item->>'productId')::uuid for update;
    insert into order_items(order_id,product_id,product_name,price,quantity,line_total) values(v_order_id,v_product.id,v_product.name,v_product.price,v_qty,v_product.price*v_qty);
    update products set stock=stock-v_qty,updated_at=now() where id=v_product.id;
  end loop;
  return v_order_id;
end $$;
revoke all on function public.checkout_order(uuid,jsonb,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.checkout_order(uuid,jsonb,jsonb,text,text) to service_role;
