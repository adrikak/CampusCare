-- =====================================================================
-- CampusCare database schema for Supabase (PostgreSQL)
-- Run ONCE on a NEW Supabase project: Dashboard -> SQL Editor -> New query -> paste -> Run.
-- It is not designed to be run twice. If you see "already exists", it has
-- already been run on this project: stop and ask before changing anything.
--
-- Design:
--   * Every status change goes through perform_action(), which checks the
--     lifecycle rules and the caller's role INSIDE the database.
--   * Tables are read-only for app users (row-level security); there are no
--     insert/update/delete policies, so the browser cannot bypass the rules.
--   * Visit double-booking is prevented by an exclusion constraint.
-- =====================================================================

create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------
create type public.app_role as enum ('student', 'faculty', 'admin', 'maintenance');
create type public.complaint_status as enum ('Submitted', 'Under Review', 'Assigned', 'In Progress', 'Resolved', 'Closed');
create type public.priority_level as enum ('Not set', 'Low', 'Medium', 'High', 'Urgent');
create type public.event_kind as enum (
  'submitted', 'reviewStarted', 'assigned', 'reassigned', 'workStarted', 'resolutionSubmitted',
  'confirmed', 'adminClosed', 'reopened', 'rejected', 'visitScheduled', 'visitCancelled'
);

-- ---------------------------------------------------------------------
-- Profiles (one per login)
-- ---------------------------------------------------------------------
create table public.profiles (
  id        uuid primary key references auth.users (id) on delete cascade,
  email     text not null,
  full_name text not null,
  role      public.app_role not null default 'student',
  team      text check (team in ('Electrical', 'Plumbing', 'IT Support', 'Housekeeping', 'General Maintenance')),
  check ((role = 'maintenance') = (team is not null))
);

-- Every new login gets a student profile. Roles are changed only by SQL run
-- in the dashboard (seed.sql does this for the demo logins); the app cannot.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data ->> 'full_name', initcap(replace(split_part(new.email, '@', 1), '.', ' '))));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Complaints and their timeline
-- ---------------------------------------------------------------------
create sequence public.complaint_seq start 110;

create table public.complaints (
  id               text primary key,
  title            text not null,
  category         text not null check (category in ('Electrical', 'Plumbing', 'IT & Network', 'Furniture', 'Cleanliness', 'Safety', 'HVAC', 'Other')),
  building         text not null check (building in ('A1', 'A2', 'B', 'C', 'D')),
  floor            text not null check (floor in ('Ground Floor', '1st Floor', '2nd Floor', '3rd Floor')),
  room             text not null check (length(trim(room)) between 1 and 20),
  description      text not null check (length(trim(description)) between 10 and 2000),
  requester_id     uuid not null references public.profiles (id),
  requester_name   text not null,
  requester_role   text not null,
  priority         public.priority_level not null default 'Not set',
  status           public.complaint_status not null default 'Submitted',
  closed_as        text check (closed_as in ('fixed', 'admin_verified', 'not_actionable')),
  team             text,
  assignee_id      uuid references public.profiles (id),
  assignee_name    text,
  -- current visit (first day's block; repeats for visit_days days)
  visit_start      timestamptz,
  visit_end        timestamptz,
  visit_days       smallint,
  -- requester evidence (paths inside the private 'evidence' storage bucket)
  attachment_path  text check (length(attachment_path) <= 300),
  attachment_thumb text check (length(attachment_thumb) <= 300),
  attachment_name  text check (length(attachment_name) <= 200),
  attachment_size  integer check (attachment_size between 0 and 10485760),
  submitted_at     timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check ((status = 'Closed') = (closed_as is not null))
);

create index on public.complaints (requester_id);
create index on public.complaints (assignee_id);
create index on public.complaints (status);

create table public.complaint_events (
  id             bigserial primary key,
  complaint_id   text not null references public.complaints (id) on delete cascade,
  kind           public.event_kind not null,
  title          text not null,
  status         public.complaint_status not null,  -- status immediately AFTER this event
  at             timestamptz not null default clock_timestamp(),
  actor_id       uuid references public.profiles (id),
  actor_name     text not null,
  actor_role     text not null,
  note           text check (length(note) <= 1000),
  reason         text check (length(reason) <= 1000),
  evidence_path  text check (length(evidence_path) <= 300),
  evidence_thumb text check (length(evidence_thumb) <= 300),
  evidence_name  text check (length(evidence_name) <= 200),
  evidence_size  integer check (evidence_size between 0 and 10485760)
);

create index on public.complaint_events (complaint_id, at);

-- One row per day-block of a booked visit. Overlapping active blocks for the
-- same staff member are impossible.
create table public.visit_blocks (
  id           bigserial primary key,
  complaint_id text not null references public.complaints (id) on delete cascade,
  staff_id     uuid not null references public.profiles (id),
  slot         tstzrange not null,
  active       boolean not null default true,
  constraint no_double_booking exclude using gist (staff_id with =, slot with &&) where (active)
);

-- ---------------------------------------------------------------------
-- Lifecycle rules (same table as the UI)
-- ---------------------------------------------------------------------
create table public.action_rules (
  action      public.event_kind primary key,
  from_status public.complaint_status[] not null,
  roles       public.app_role[] not null,
  to_status   public.complaint_status  -- null = status does not change
);

insert into public.action_rules values
  ('reviewStarted',       '{Submitted}',                  '{admin}',             'Under Review'),
  ('assigned',            '{"Under Review"}',             '{admin}',             'Assigned'),
  ('reassigned',          '{Assigned,"In Progress"}',     '{admin}',             null),
  ('workStarted',         '{Assigned}',                   '{maintenance}',       'In Progress'),
  ('resolutionSubmitted', '{"In Progress"}',              '{maintenance}',       'Resolved'),
  ('confirmed',           '{Resolved}',                   '{student,faculty}',   'Closed'),
  ('adminClosed',         '{Resolved}',                   '{admin}',             'Closed'),
  ('reopened',            '{Resolved}',                   '{student,faculty,admin}', 'In Progress'),
  ('rejected',            '{Submitted,"Under Review"}',   '{admin}',             'Closed'),
  ('visitScheduled',      '{Assigned,"In Progress"}',     '{admin}',             null),
  ('visitCancelled',      '{Assigned,"In Progress"}',     '{admin}',             null);

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function public.current_role_is(r public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = r);
$$;

create or replace function public.can_see_complaint(p_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.complaints c
    where c.id = p_id
      and (c.requester_id = auth.uid() or c.assignee_id = auth.uid() or public.current_role_is('admin'))
  );
$$;

create or replace function public.fmt_slot(p_start timestamptz, p_end timestamptz, p_days int)
returns text language sql immutable set search_path = public as $$
  select to_char(p_start at time zone 'Asia/Kolkata', 'Dy, FMDD Mon')
      || case when coalesce(p_days, 1) > 1
              then ' – ' || to_char((p_start + make_interval(days => p_days - 1)) at time zone 'Asia/Kolkata', 'Dy, FMDD Mon')
              else '' end
      || ', ' || to_char(p_start at time zone 'Asia/Kolkata', 'HH24:MI') || '–' || to_char(p_end at time zone 'Asia/Kolkata', 'HH24:MI')
      || case when coalesce(p_days, 1) > 1 then ' each day (' || p_days || ' days)' else '' end;
$$;

-- Appends an event and keeps complaints.updated_at in step.
create or replace function public._add_event(
  p_complaint text, p_kind public.event_kind, p_title text, p_status public.complaint_status,
  p_actor public.profiles, p_note text default null, p_reason text default null,
  p_ev_path text default null, p_ev_thumb text default null, p_ev_name text default null, p_ev_size int default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.complaint_events
    (complaint_id, kind, title, status, actor_id, actor_name, actor_role, note, reason,
     evidence_path, evidence_thumb, evidence_name, evidence_size)
  values
    (p_complaint, p_kind, p_title, p_status, p_actor.id, p_actor.full_name,
     case p_actor.role when 'admin' then 'Administrator' when 'maintenance' then 'Maintenance'
                       when 'faculty' then 'Faculty' else 'Student' end,
     p_note, p_reason, p_ev_path, p_ev_thumb, p_ev_name, p_ev_size);
  update public.complaints set updated_at = clock_timestamp() where id = p_complaint;
end $$;

-- Placeholder working hours (Asia/Kolkata): 09:00–17:00, 1–4 hour visits, 1–5 consecutive days, up to 14 days ahead.
create or replace function public._book_visit(p_complaint text, p_staff uuid, p_start timestamptz, p_hours int, p_days int)
returns void language plpgsql security definer set search_path = public as $$
declare
  local_start timestamp := p_start at time zone 'Asia/Kolkata';
begin
  if p_start is null then raise exception 'Choose a visit time.'; end if;
  if p_hours is null or p_hours not between 1 and 4 then raise exception 'Visit length must be 1 to 4 hours.'; end if;
  if p_days is null then raise exception 'A visit can span 1 to 5 days.'; end if;
  if p_days not between 1 and 5 then raise exception 'A visit can span 1 to 5 days.'; end if;
  if p_start <= now() then raise exception 'Choose a visit time in the future.'; end if;
  if p_start > now() + interval '15 days' then raise exception 'Visits can be booked up to 14 days ahead.'; end if;
  if extract(minute from local_start) <> 0 or extract(second from local_start) <> 0
     or extract(hour from local_start) < 9 or extract(hour from local_start) + p_hours > 17 then
    raise exception 'Visits must be whole hours between 09:00 and 17:00.';
  end if;
  begin
    insert into public.visit_blocks (complaint_id, staff_id, slot)
    select p_complaint, p_staff,
           tstzrange(p_start + make_interval(days => d), p_start + make_interval(days => d, hours => p_hours), '[)')
    from generate_series(0, p_days - 1) as d;
  exception when exclusion_violation then
    raise exception 'This staff member already has a visit that overlaps that time.';
  end;
  update public.complaints
     set visit_start = p_start, visit_end = p_start + make_interval(hours => p_hours), visit_days = p_days
   where id = p_complaint;
end $$;

create or replace function public._clear_visit(p_complaint text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.visit_blocks set active = false where complaint_id = p_complaint and active;
  update public.complaints set visit_start = null, visit_end = null, visit_days = null where id = p_complaint;
end $$;

-- An uploaded file must sit in the caller's own upload folder.
create or replace function public._check_upload_path(p_path text)
returns void language plpgsql stable set search_path = public as $$
begin
  if p_path is not null and (
       auth.uid() is null
       or left(p_path, length('uploads/' || auth.uid()::text || '/')) <> 'uploads/' || auth.uid()::text || '/'
       or p_path like '%..%'
       or length(p_path) > 300) then
    raise exception 'Evidence file does not belong to you.';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- RPC: submit a complaint (students and faculty)
-- p: {category, building, floor, room, description,
--     attachment_path?, attachment_thumb?, attachment_name?, attachment_size?}
-- ---------------------------------------------------------------------
create or replace function public.submit_complaint(p jsonb)
returns public.complaints language plpgsql security definer set search_path = public as $$
declare
  me public.profiles;
  c  public.complaints;
  v_desc text := trim(coalesce(p ->> 'description', ''));
  v_id text;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.id is null then raise exception 'Please sign in.' using errcode = '42501'; end if;
  if me.role not in ('student', 'faculty') then raise exception 'Only students and faculty can submit complaints.' using errcode = '42501'; end if;
  perform public._check_upload_path(p ->> 'attachment_path');
  perform public._check_upload_path(p ->> 'attachment_thumb');

  v_id := 'CC-' || to_char(now() at time zone 'Asia/Kolkata', 'YYYY') || '-' || lpad(nextval('public.complaint_seq')::text, 4, '0');
  insert into public.complaints
    (id, title, category, building, floor, room, description, requester_id, requester_name, requester_role,
     attachment_path, attachment_thumb, attachment_name, attachment_size)
  values
    (v_id,
     case when length(v_desc) > 56 then left(v_desc, 56) || '…' else v_desc end,
     p ->> 'category', p ->> 'building', p ->> 'floor', trim(p ->> 'room'), v_desc,
     me.id, me.full_name, initcap(me.role::text),
     p ->> 'attachment_path', p ->> 'attachment_thumb', p ->> 'attachment_name', (p ->> 'attachment_size')::int)
  returning * into c;

  perform public._add_event(c.id, 'submitted', 'Complaint submitted', 'Submitted', me,
    case when c.attachment_path is not null then 'Submitted with evidence attached.' end);
  select * into c from public.complaints where id = c.id;
  return c;
end $$;

-- ---------------------------------------------------------------------
-- RPC: every other lifecycle action
-- p (by action):
--   reviewStarted       {priority}
--   assigned            {assignee, visit_start?, visit_hours?, visit_days?}
--   reassigned          {assignee}
--   workStarted         {}
--   resolutionSubmitted {note, evidence_path?, evidence_thumb?, evidence_name?, evidence_size?}
--   confirmed           {note?}
--   adminClosed         {reason}
--   reopened            {reason}
--   rejected            {reason}
--   visitScheduled      {visit_start, visit_hours, visit_days}
--   visitCancelled      {reason}
-- ---------------------------------------------------------------------
create or replace function public.perform_action(p_id text, p_action public.event_kind, p jsonb default '{}'::jsonb)
returns public.complaints language plpgsql security definer set search_path = public as $$
declare
  me       public.profiles;
  staff    public.profiles;
  c        public.complaints;
  r        public.action_rules;
  v_status public.complaint_status;
  v_note   text := nullif(trim(coalesce(p ->> 'note', '')), '');
  v_reason text := nullif(trim(coalesce(p ->> 'reason', '')), '');
  v_old    text;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.id is null then raise exception 'Please sign in.' using errcode = '42501'; end if;

  select * into c from public.complaints where id = p_id for update;
  -- Same message whether the complaint does not exist or belongs to someone
  -- else, so nobody can probe other people's complaints by guessing IDs.
  if c.id is null or not (me.role = 'admin' or c.requester_id = me.id or c.assignee_id = me.id) then
    raise exception 'Complaint % not found.', p_id using errcode = 'P0002';
  end if;

  select * into r from public.action_rules where action = p_action;
  if r.action is null or not (c.status = any (r.from_status)) or not (me.role = any (r.roles)) then
    raise exception 'That action is not allowed while the complaint is %.', c.status using errcode = '42501';
  end if;
  if me.role = 'maintenance' and c.assignee_id is distinct from me.id then
    raise exception 'Only the assigned staff member can update this complaint.' using errcode = '42501';
  end if;
  if me.role in ('student', 'faculty') and c.requester_id <> me.id then
    raise exception 'Only the person who reported this complaint can do that.' using errcode = '42501';
  end if;
  if p_action in ('adminClosed', 'reopened', 'rejected', 'visitCancelled') and coalesce(length(v_reason), 0) < 10 then
    raise exception 'Please give a reason of at least 10 characters.';
  end if;

  v_status := coalesce(r.to_status, c.status);

  case p_action
  when 'reviewStarted' then
    if coalesce(p ->> 'priority', '') not in ('Low', 'Medium', 'High', 'Urgent') then raise exception 'Please select a priority.'; end if;
    update public.complaints set priority = (p ->> 'priority')::public.priority_level, status = v_status where id = p_id;
    perform public._add_event(p_id, p_action, 'Review started', v_status, me, 'Priority set to ' || (p ->> 'priority') || '.');

  when 'assigned', 'reassigned' then
    select * into staff from public.profiles where id = (p ->> 'assignee')::uuid and role = 'maintenance';
    if staff.id is null then raise exception 'Choose a maintenance staff member.'; end if;
    if p_action = 'reassigned' and staff.id = c.assignee_id then raise exception 'Choose a different staff member to reassign.'; end if;
    v_old := c.assignee_name;
    if p_action = 'reassigned' and c.visit_start is not null then
      v_note := public.fmt_slot(c.visit_start, c.visit_end, c.visit_days);
      perform public._clear_visit(p_id);
    end if;
    update public.complaints set assignee_id = staff.id, assignee_name = staff.full_name, team = staff.team, status = v_status where id = p_id;
    if p_action = 'assigned' then
      perform public._add_event(p_id, p_action, 'Assigned to ' || staff.full_name, v_status, me, 'Team: ' || staff.team || '.');
    else
      perform public._add_event(p_id, p_action, 'Reassigned to ' || staff.full_name, v_status, me,
        'From ' || v_old || ' to ' || staff.full_name || ' (' || staff.team || ').');
      if v_note is not null then
        perform public._add_event(p_id, 'visitCancelled', 'Visit cancelled: ' || v_note, v_status, me,
          'Cancelled because the complaint moved to ' || staff.full_name || '.');
      end if;
    end if;
    if p_action = 'assigned' and nullif(p ->> 'visit_start', '') is not null then
      perform public._book_visit(p_id, staff.id, (p ->> 'visit_start')::timestamptz,
        coalesce((p ->> 'visit_hours')::int, 1), coalesce((p ->> 'visit_days')::int, 1));
      select * into c from public.complaints where id = p_id;
      perform public._add_event(p_id, 'visitScheduled', 'Visit scheduled: ' || public.fmt_slot(c.visit_start, c.visit_end, c.visit_days),
        v_status, me, staff.full_name || ' at Building ' || c.building || ' · ' || c.floor || ' · Room ' || c.room || '.');
    end if;

  when 'visitScheduled' then
    v_old := case when c.visit_start is not null then public.fmt_slot(c.visit_start, c.visit_end, c.visit_days) end;
    perform public._clear_visit(p_id);
    perform public._book_visit(p_id, c.assignee_id, nullif(p ->> 'visit_start', '')::timestamptz,
      coalesce((p ->> 'visit_hours')::int, 1), coalesce((p ->> 'visit_days')::int, 1));
    select * into c from public.complaints where id = p_id;
    perform public._add_event(p_id, p_action,
      case when v_old is null then 'Visit scheduled: ' else 'Visit rescheduled: ' end || public.fmt_slot(c.visit_start, c.visit_end, c.visit_days),
      v_status, me,
      case when v_old is null then c.assignee_name || ' at Building ' || c.building || ' · ' || c.floor || ' · Room ' || c.room || '.'
           else 'Previously ' || v_old || '.' end);

  when 'visitCancelled' then
    if c.visit_start is null then raise exception 'There is no visit to cancel.'; end if;
    v_old := public.fmt_slot(c.visit_start, c.visit_end, c.visit_days);
    perform public._clear_visit(p_id);
    perform public._add_event(p_id, p_action, 'Visit cancelled: ' || v_old, v_status, me, null, v_reason);

  when 'workStarted' then
    update public.complaints set status = v_status where id = p_id;
    perform public._add_event(p_id, p_action, 'Work started', v_status, me, 'Work started on site.');

  when 'resolutionSubmitted' then
    if coalesce(length(v_note), 0) < 10 then raise exception 'Please describe the work in at least 10 characters.'; end if;
    perform public._check_upload_path(p ->> 'evidence_path');
    perform public._check_upload_path(p ->> 'evidence_thumb');
    perform public._clear_visit(p_id);
    update public.complaints set status = v_status where id = p_id;
    perform public._add_event(p_id, p_action, 'Resolution submitted', v_status, me, v_note, null,
      p ->> 'evidence_path', p ->> 'evidence_thumb', p ->> 'evidence_name', (p ->> 'evidence_size')::int);

  when 'confirmed' then
    update public.complaints set status = v_status, closed_as = 'fixed' where id = p_id;
    perform public._add_event(p_id, p_action, 'Requester confirmed fixed', v_status, me, v_note);

  when 'adminClosed' then
    update public.complaints set status = v_status, closed_as = 'admin_verified' where id = p_id;
    perform public._add_event(p_id, p_action, 'Verified and closed by admin', v_status, me, null, v_reason);

  when 'reopened' then
    update public.complaints set status = v_status where id = p_id;
    perform public._add_event(p_id, p_action, 'Reopened', v_status, me, null, v_reason);

  when 'rejected' then
    perform public._clear_visit(p_id);
    update public.complaints set status = v_status, closed_as = 'not_actionable' where id = p_id;
    perform public._add_event(p_id, p_action, 'Rejected — not actionable', v_status, me, null, v_reason);
  end case;

  select * into c from public.complaints where id = p_id;
  return c;
end $$;

-- ---------------------------------------------------------------------
-- Row-level security: read-only access, scoped by role
-- ---------------------------------------------------------------------
alter table public.profiles         enable row level security;
alter table public.complaints       enable row level security;
alter table public.complaint_events enable row level security;
alter table public.visit_blocks     enable row level security;
alter table public.action_rules     enable row level security;

create policy "own profile, staff and admins are visible" on public.profiles
  for select to authenticated
  using (id = auth.uid() or role in ('admin', 'maintenance') or public.current_role_is('admin'));

create policy "requester, assignee and admins see a complaint" on public.complaints
  for select to authenticated
  using (requester_id = auth.uid() or assignee_id = auth.uid() or public.current_role_is('admin'));

create policy "timeline follows its complaint" on public.complaint_events
  for select to authenticated
  using (public.can_see_complaint(complaint_id));

create policy "admins see all visits, staff see their own" on public.visit_blocks
  for select to authenticated
  using (public.current_role_is('admin') or staff_id = auth.uid());

create policy "rules are public to signed-in users" on public.action_rules
  for select to authenticated using (true);

revoke all on public.profiles, public.complaints, public.complaint_events, public.visit_blocks, public.action_rules from anon;
revoke insert, update, delete on public.profiles, public.complaints, public.complaint_events, public.visit_blocks, public.action_rules from authenticated;
grant select on public.profiles, public.complaints, public.complaint_events, public.visit_blocks, public.action_rules to authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- Only the two RPCs (and read helpers) are callable by the app.
revoke execute on function
  public.handle_new_user(),
  public.current_role_is(public.app_role),
  public.can_see_complaint(text),
  public.fmt_slot(timestamptz, timestamptz, int),
  public._add_event(text, public.event_kind, text, public.complaint_status, public.profiles, text, text, text, text, text, int),
  public._book_visit(text, uuid, timestamptz, int, int),
  public._clear_visit(text),
  public._check_upload_path(text),
  public.submit_complaint(jsonb),
  public.perform_action(text, public.event_kind, jsonb)
from public, anon, authenticated;
grant execute on function public.submit_complaint(jsonb) to authenticated;
grant execute on function public.perform_action(text, public.event_kind, jsonb) to authenticated;
grant execute on function public.can_see_complaint(text), public.current_role_is(public.app_role), public.fmt_slot(timestamptz, timestamptz, int) to authenticated;

-- ---------------------------------------------------------------------
-- Storage: private bucket for evidence photos/PDFs
-- Files are uploaded to uploads/<your user id>/<random>.jpg|.png|.webp|.pdf
--
-- Size rules (must match the app's form checks):
--   * Photos (JPG/PNG): the user may pick up to 10 MB; the app shrinks them to
--     a JPEG of at most 1600 px before upload (normally well under 1 MB).
--     If shrinking fails, the original is uploaded only if it is 5 MB or less.
--   * PDFs are not shrunk: 5 MB maximum, checked in the form and here.
--   * Storage refuses anything over 5 MB or of any other type.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('evidence', 'evidence', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "upload into own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'evidence'
              and (storage.foldername(name))[1] = 'uploads'
              and (storage.foldername(name))[2] = auth.uid()::text);

create policy "read evidence you are allowed to see" on storage.objects
  for select to authenticated
  using (bucket_id = 'evidence' and (
         (storage.foldername(name))[2] = auth.uid()::text
      or exists (select 1 from public.complaints c
                 where (c.attachment_path = objects.name or c.attachment_thumb = objects.name) and public.can_see_complaint(c.id))
      or exists (select 1 from public.complaint_events e
                 where (e.evidence_path = objects.name or e.evidence_thumb = objects.name) and public.can_see_complaint(e.complaint_id))));
