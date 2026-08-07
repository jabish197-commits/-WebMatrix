alter table public.site_settings
  add column if not exists offer_text text not null default 'LIMITED-TIME OFFER • Shop new arrivals today',
  add column if not exists offer_background_color text not null default '#e7a93f',
  add column if not exists offer_text_color text not null default '#152018',
  add column if not exists offer_animation_enabled boolean not null default true,
  add column if not exists offer_animation_style text not null default 'scroll-left',
  add column if not exists offer_animation_speed integer not null default 20;

update public.site_settings
set
  offer_text = coalesce(nullif(offer_text, ''), 'LIMITED-TIME OFFER • Shop new arrivals today'),
  offer_background_color = coalesce(nullif(offer_background_color, ''), '#e7a93f'),
  offer_text_color = coalesce(nullif(offer_text_color, ''), '#152018'),
  offer_animation_style = coalesce(nullif(offer_animation_style, ''), 'scroll-left'),
  offer_animation_speed = greatest(5, least(60, coalesce(offer_animation_speed, 20)))
where singleton = 'main';
