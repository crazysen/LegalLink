-- Extends set_attorney_consultation_summary so the client gets ONE in-app notification
-- the first time the attorney saves a non-empty summary.
-- Run in Supabase SQL Editor after attorney_consultation_summary column exists.

begin;

alter table public.notifications
  add column if not exists data jsonb not null default '{}'::jsonb;

create or replace function public.set_attorney_consultation_summary(
  p_appointment_id uuid,
  p_summary text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_trimmed text;
  v_old text;
  v_client_id uuid;
  v_title text;
  updated_count int;
begin
  if v_uid is null then
    raise exception 'Authentication required.';
  end if;

  v_trimmed := left(trim(coalesce(p_summary, '')), 12000);

  select a.attorney_consultation_summary, a.client_id, coalesce(a.title, 'Consultation')
  into v_old, v_client_id, v_title
  from public.appointments a
  where a.id = p_appointment_id
    and a.attorney_id = v_uid
    and lower(a.status::text) = 'completed';

  if v_client_id is null then
    raise exception 'Unable to save summary (not found, not your appointment, or session not completed).';
  end if;

  update public.appointments a
  set
    attorney_consultation_summary = nullif(v_trimmed, ''),
    updated_at = now()
  where a.id = p_appointment_id
    and a.attorney_id = v_uid
    and lower(a.status::text) = 'completed';

  get diagnostics updated_count = row_count;

  if updated_count = 0 then
    raise exception 'Unable to save summary.';
  end if;

  if nullif(v_trimmed, '') is not null and (v_old is null or trim(v_old) = '') then
    insert into public.notifications (user_id, title, body, type, is_read, created_at, data)
    values (
      v_client_id,
      'Session summary ready',
      'Your attorney posted a session summary for your consultation ('
        || v_title
        || '). Tap to open Consultation Logs.',
      'consultation',
      false,
      now(),
      jsonb_build_object('appointment_id', p_appointment_id)
    );
  end if;
end;
$$;

revoke all on function public.set_attorney_consultation_summary(uuid, text) from public;
grant execute on function public.set_attorney_consultation_summary(uuid, text) to authenticated;

commit;
