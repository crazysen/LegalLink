-- CMS: public website copy + attorney gallery metadata.
-- Run in Supabase SQL Editor (or apply via Supabase migrations).
-- Mobile/web read these tables with the anon key — see services/userApi.js (fetchPublicLandingData, fetchBookableAttorneys).
-- Requires: public.profiles with role user_role including 'Admin'.

begin;

create or replace function public.is_admin(_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = _uid
      and p.role::text = 'Admin'
  );
$$;

create table if not exists public.cms_site_content (
  content_key text primary key,
  content_value text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.cms_attorney_directory (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  display_name text not null,
  profile_image_url text,
  expertise_fields text[] not null default '{}',
  practice_areas text[] not null default '{}',
  biography text,
  is_published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.cms_site_content enable row level security;
alter table public.cms_attorney_directory enable row level security;

drop policy if exists cms_site_content_public_read on public.cms_site_content;
create policy cms_site_content_public_read
on public.cms_site_content for select
using (true);

drop policy if exists cms_site_content_admin_all on public.cms_site_content;
create policy cms_site_content_admin_all
on public.cms_site_content for all
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

drop policy if exists cms_attorney_directory_public_read on public.cms_attorney_directory;
create policy cms_attorney_directory_public_read
on public.cms_attorney_directory for select
using (is_published = true or public.is_admin(auth.uid()));

drop policy if exists cms_attorney_directory_admin_all on public.cms_attorney_directory;
create policy cms_attorney_directory_admin_all
on public.cms_attorney_directory for all
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

insert into public.cms_site_content (content_key, content_value)
values
  ('hero_title', 'Legal & Notarial Services Now in Your Pocket'),
  ('hero_subtitle', 'Experience the convenience of managing all your legal matters on the go. Expert advice and certified notarial services are now just a tap away.'),
  ('services_title', 'Our Services'),
  ('services_subtitle', 'Comprehensive legal solutions tailored for your business and personal needs.'),
  ('attorneys_title', 'Meet Our Attorneys'),
  ('attorneys_subtitle', 'Browse verified legal experts and choose the attorney that best matches your concern.')
on conflict (content_key) do update
set content_value = excluded.content_value,
    updated_at = now();

commit;
