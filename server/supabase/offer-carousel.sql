alter table public.banners
  add column if not exists description text default '',
  add column if not exists button_text text default 'Shop now',
  add column if not exists background_color text default '#eef5e9',
  add column if not exists text_color text default '#152018';

update public.banners
set
  description = coalesce(description, ''),
  button_text = coalesce(nullif(button_text, ''), 'Shop now'),
  background_color = coalesce(nullif(background_color, ''), '#eef5e9'),
  text_color = coalesce(nullif(text_color, ''), '#152018');
