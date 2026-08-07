alter table public.site_settings
  add column if not exists offer_text text not null default 'LIMITED-TIME OFFER • Shop new arrivals today',
  add column if not exists offer_background_color text not null default '#e7a93f',
  add column if not exists offer_text_color text not null default '#152018';

update public.site_settings
set
  offer_text = coalesce(nullif(offer_text, ''), 'LIMITED-TIME OFFER • Shop new arrivals today'),
  offer_background_color = coalesce(nullif(offer_background_color, ''), '#e7a93f'),
  offer_text_color = coalesce(nullif(offer_text_color, ''), '#152018')
where singleton = 'main';
