-- Destructive cleanup requested for product fields no longer used by WebMatrix.
alter table public.order_items drop column if exists sku;
alter table public.products
  drop column if exists slug,
  drop column if exists sku,
  drop column if exists compare_at_price,
  drop column if exists images;

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
