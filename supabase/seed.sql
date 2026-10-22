-- =====================================================================
-- CampusCare demo data. Run AFTER schema.sql and AFTER creating the 10
-- demo logins (see SETUP.md). All names are fictional. Timestamps are
-- relative to when you run this.
--
-- What this script changes:
--   * the profiles of the 10 @campuscare.demo logins (names, roles, teams)
--   * exactly nine sample complaints: CC-<this year>-0101 ... -0109.
--     If they already exist (and were reported by a demo login) they are
--     deleted together with their own timeline events and visit bookings,
--     then loaded again with fresh dates.
-- What it never touches:
--   * complaints created in the app (CC-<year>-0110 onwards), their
--     timelines and visit bookings; any other login or profile; uploaded files.
--
-- All data changes happen inside ONE statement (step 3), so PostgreSQL
-- applies them all or none: if anything fails, nothing is deleted or changed.
-- Re-running is safe; it resets the nine samples (including anything done to
-- them in the app). Re-run it the day before a demo so the two sample visits
-- are "tomorrow" again.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Step 1. Logins created BEFORE schema.sql was run have no profile yet; add
-- one (new default 'student' profiles only; existing profiles are untouched).
-- ---------------------------------------------------------------------
insert into public.profiles (id, email, full_name)
select u.id, u.email, initcap(replace(split_part(u.email, '@', 1), '.', ' '))
from auth.users u
where u.email like '%@campuscare.demo'
  and not exists (select 1 from public.profiles p where p.id = u.id);

-- ---------------------------------------------------------------------
-- Step 2. Temporary helper that inserts one sample complaint with its history.
-- It is created in pg_temp (this connection's private scratch area), NOT in
-- the public schema, so it cannot replace or clash with any real function,
-- and it disappears by itself when the connection ends.
-- p_events: [[kind, hours after submission, note?, reason?], ...]
-- ---------------------------------------------------------------------
create function pg_temp._seed_complaint(
  p_num text, p_title text, p_cat text, p_bld text, p_floor text, p_room text, p_desc text,
  p_requester text, p_priority text, p_assignee text, p_hours_ago numeric, p_events jsonb,
  p_att_name text default null, p_att_size int default null,
  p_visit_start timestamptz default null, p_visit_hours int default null, p_visit_days int default null)
returns void language plpgsql set search_path = public as $$
declare
  req public.profiles; asg public.profiles; adm public.profiles; actor public.profiles;
  cid text := 'CC-' || p_num;
  sub timestamptz := now() - make_interval(secs => p_hours_ago * 3600);
  ev jsonb; k public.event_kind; st public.complaint_status := 'Submitted'; t timestamptz;
  v_title text; v_note text; v_closed text;
begin
  select * into req from public.profiles where email = p_requester;
  select * into asg from public.profiles where email = p_assignee;
  select * into adm from public.profiles where email = 'sunita.patil@campuscare.demo';

  insert into public.complaints (id, title, category, building, floor, room, description,
    requester_id, requester_name, requester_role, priority, team, assignee_id, assignee_name,
    attachment_name, attachment_size, submitted_at)
  values (cid, p_title, p_cat, p_bld, p_floor, p_room, p_desc,
    req.id, req.full_name, initcap(req.role::text), p_priority::public.priority_level, asg.team, asg.id, asg.full_name,
    p_att_name, p_att_size, sub);

  for ev in select value from jsonb_array_elements(p_events) loop
    k := (ev ->> 0)::public.event_kind;
    t := least(sub + make_interval(secs => (ev ->> 1)::numeric * 3600), now() - interval '5 minutes');
    st := coalesce((select to_status from public.action_rules where action = k), case when k = 'submitted' then 'Submitted'::public.complaint_status else st end);
    actor := case when k in ('submitted', 'confirmed') then req
                  when k in ('workStarted', 'resolutionSubmitted') then asg
                  else adm end;
    v_title := case k
      when 'submitted' then 'Complaint submitted'
      when 'reviewStarted' then 'Review started'
      when 'assigned' then 'Assigned to ' || asg.full_name
      when 'workStarted' then 'Work started'
      when 'resolutionSubmitted' then 'Resolution submitted'
      when 'confirmed' then 'Requester confirmed fixed'
      when 'rejected' then 'Rejected — not actionable'
      when 'visitScheduled' then 'Visit scheduled: ' || public.fmt_slot(p_visit_start, p_visit_start + make_interval(hours => p_visit_hours), p_visit_days)
      else k::text end;
    v_note := coalesce(ev ->> 2, case k
      when 'reviewStarted' then 'Priority set to ' || p_priority || '.'
      when 'assigned' then 'Team: ' || asg.team || '.'
      when 'visitScheduled' then asg.full_name || ' at Building ' || p_bld || ' · ' || p_floor || ' · Room ' || p_room || '.'
      end);
    insert into public.complaint_events (complaint_id, kind, title, status, at, actor_id, actor_name, actor_role, note, reason)
    values (cid, k, v_title, st, t, actor.id, actor.full_name,
            case actor.role when 'admin' then 'Administrator' when 'maintenance' then 'Maintenance' else initcap(actor.role::text) end,
            v_note, ev ->> 3);
    if k = 'confirmed' then v_closed := 'fixed'; elsif k = 'rejected' then v_closed := 'not_actionable'; end if;
  end loop;

  update public.complaints set status = st, closed_as = v_closed, updated_at = t where id = cid;

  if p_visit_start is not null then
    begin
      insert into public.visit_blocks (complaint_id, staff_id, slot)
      select cid, asg.id, tstzrange(p_visit_start + make_interval(days => d), p_visit_start + make_interval(days => d, hours => p_visit_hours), '[)')
      from generate_series(0, p_visit_days - 1) d;
    exception when exclusion_violation then
      raise exception '% already has a visit booked in the app at %. Cancel or move that visit, then run seed.sql again. Nothing was changed.',
        asg.full_name, public.fmt_slot(p_visit_start, p_visit_start + make_interval(hours => p_visit_hours), p_visit_days);
    end;
    update public.complaints set visit_start = p_visit_start, visit_end = p_visit_start + make_interval(hours => p_visit_hours), visit_days = p_visit_days
    where id = cid;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Step 3. All data changes, as ONE statement (all or nothing).
-- ---------------------------------------------------------------------
do $$
declare
  yr       text := to_char(now() at time zone 'Asia/Kolkata', 'YYYY');
  tomorrow date := (now() at time zone 'Asia/Kolkata')::date + 1;
  missing  text;
  n        int;
begin
  -- 3a. All 10 demo logins must exist.
  select string_agg(e, ', ') into missing
  from unnest(array[
    'ananya.kulkarni@campuscare.demo', 'rohan.deshpande@campuscare.demo', 'meera.joshi@campuscare.demo',
    'sunita.patil@campuscare.demo', 'ramesh.jadhav@campuscare.demo', 'anil.more@campuscare.demo',
    'suresh.pawar@campuscare.demo', 'kiran.gaikwad@campuscare.demo', 'lata.bhosale@campuscare.demo',
    'vikas.shinde@campuscare.demo']) as e
  where not exists (select 1 from public.profiles p where p.email = e);
  if missing is not null then
    raise exception 'Create these logins first (see SETUP.md step 4): %. Nothing was changed.', missing;
  end if;

  -- 3b. Names, roles and teams of the 10 demo logins (only these rows).
  update public.profiles p set full_name = v.full_name, role = v.role::public.app_role, team = v.team
  from (values
    ('ananya.kulkarni@campuscare.demo', 'Ananya Kulkarni',   'student',     null),
    ('rohan.deshpande@campuscare.demo', 'Rohan Deshpande',   'student',     null),
    ('meera.joshi@campuscare.demo',     'Prof. Meera Joshi', 'faculty',     null),
    ('sunita.patil@campuscare.demo',    'Sunita Patil',      'admin',       null),
    ('ramesh.jadhav@campuscare.demo',   'Ramesh Jadhav',     'maintenance', 'Electrical'),
    ('anil.more@campuscare.demo',       'Anil More',         'maintenance', 'Electrical'),
    ('suresh.pawar@campuscare.demo',    'Suresh Pawar',      'maintenance', 'Plumbing'),
    ('kiran.gaikwad@campuscare.demo',   'Kiran Gaikwad',     'maintenance', 'IT Support'),
    ('lata.bhosale@campuscare.demo',    'Lata Bhosale',      'maintenance', 'Housekeeping'),
    ('vikas.shinde@campuscare.demo',    'Vikas Shinde',      'maintenance', 'General Maintenance')
  ) as v(email, full_name, role, team)
  where p.email = v.email;

  -- 3c. Remove ONLY these nine sample IDs, and only if a demo login reported
  -- them. ON DELETE CASCADE also removes their own timeline events and visit
  -- bookings; nothing else in the database references a complaint.
  delete from public.complaints c
  where c.id in ('CC-' || yr || '-0101', 'CC-' || yr || '-0102', 'CC-' || yr || '-0103',
                 'CC-' || yr || '-0104', 'CC-' || yr || '-0105', 'CC-' || yr || '-0106',
                 'CC-' || yr || '-0107', 'CC-' || yr || '-0108', 'CC-' || yr || '-0109')
    and c.requester_id in (select id from public.profiles where email like '%@campuscare.demo');
  get diagnostics n = row_count;
  raise notice 'Removed % earlier sample complaint(s); loading the nine samples.', n;

  -- 3d. Load the nine samples (same as the prototype).
  perform pg_temp._seed_complaint(yr || '-0101', 'Air conditioner not cooling', 'Electrical', 'A1', '2nd Floor', '204',
    'The air conditioner has stopped cooling and makes a rattling sound. The room gets very warm during afternoon lectures.',
    'ananya.kulkarni@campuscare.demo', 'High', 'ramesh.jadhav@campuscare.demo', 50,
    '[["submitted",0],["reviewStarted",3],["assigned",4],["workStarted",26,"Work started on site."]]');
  perform pg_temp._seed_complaint(yr || '-0102', 'Water leak near the staircase', 'Plumbing', 'B', '2nd Floor', '205',
    'Water is pooling beside the staircase outside Room 205 and creating a slipping hazard.',
    'rohan.deshpande@campuscare.demo', 'Urgent', 'suresh.pawar@campuscare.demo', 20,
    '[["submitted",0],["reviewStarted",1],["assigned",1.5],["visitScheduled",1.6]]',
    null, null, (tomorrow + time '10:00') at time zone 'Asia/Kolkata', 1, 1);
  perform pg_temp._seed_complaint(yr || '-0103', 'Broken desk in classroom', 'Furniture', 'C', 'Ground Floor', '102',
    'The front-left desk has a loose writing surface and cannot be used safely.',
    'ananya.kulkarni@campuscare.demo', 'Medium', 'vikas.shinde@campuscare.demo', 144,
    '[["submitted",0],["reviewStarted",5],["assigned",6],["workStarted",50,"Work started on site."],["resolutionSubmitted",120,"Writing surface re-fixed with new screws and brackets; desk tested and stable."]]');
  perform pg_temp._seed_complaint(yr || '-0104', 'Wi-Fi disconnects frequently', 'IT & Network', 'D', '3rd Floor', '301',
    'The Wi-Fi disconnects every few minutes in Room 301, interrupting online lab work.',
    'ananya.kulkarni@campuscare.demo', 'Medium', 'kiran.gaikwad@campuscare.demo', 288,
    '[["submitted",0],["reviewStarted",4],["assigned",5],["workStarted",28,"Work started on site."],["resolutionSubmitted",70,"Replaced the faulty access point on the 3rd floor and updated its firmware."],["confirmed",96,"Rated 4/5."]]');
  perform pg_temp._seed_complaint(yr || '-0105', 'Overflowing waste bins', 'Cleanliness', 'A2', 'Ground Floor', '12',
    'Waste bins near the seating area outside Room 12 overflow by mid-day and need more frequent collection.',
    'meera.joshi@campuscare.demo', 'Low', null, 22,
    '[["submitted",0],["reviewStarted",18]]');
  perform pg_temp._seed_complaint(yr || '-0106', 'Flickering corridor lights', 'Electrical', 'D', '1st Floor', '108',
    'Lights in the corridor outside Room 108 flicker constantly in the evening.',
    'rohan.deshpande@campuscare.demo', 'Medium', 'ramesh.jadhav@campuscare.demo', 192,
    '[["submitted",0],["reviewStarted",6],["assigned",7],["workStarted",30,"Work started on site."],["resolutionSubmitted",96,"Replaced two faulty tube-light chokes; all corridor lights checked after 6 PM."]]');
  perform pg_temp._seed_complaint(yr || '-0107', 'Stairwell light not working', 'Electrical', 'C', 'Ground Floor', '4',
    'The stairwell light next to Room 4 has been off for several evenings, making the stairs unsafe after dark.',
    'meera.joshi@campuscare.demo', 'High', 'ramesh.jadhav@campuscare.demo', 9,
    '[["submitted",0],["reviewStarted",1],["assigned",2],["visitScheduled",2.1]]',
    null, null, (tomorrow + time '09:00') at time zone 'Asia/Kolkata', 1, 1);
  perform pg_temp._seed_complaint(yr || '-0108', 'Projector shows no signal', 'IT & Network', 'A1', '1st Floor', '110',
    'The ceiling projector shows no signal even with a working HDMI cable.',
    'ananya.kulkarni@campuscare.demo', 'Not set', null, 3,
    '[["submitted",0]]');
  perform pg_temp._seed_complaint(yr || '-0109', 'Request to change lab timetable', 'Other', 'A2', '1st Floor', '115',
    'Our lab session clashes with another subject; please move it to the afternoon.',
    'rohan.deshpande@campuscare.demo', 'Not set', null, 120,
    '[["submitted",0],["rejected",8,null,"Not a facilities issue. Timetable requests are handled by the academic office."]]');
end $$;

-- ---------------------------------------------------------------------
-- Step 4. Remove the temporary helper (it would also vanish on its own).
-- ---------------------------------------------------------------------
drop function pg_temp._seed_complaint(text, text, text, text, text, text, text, text, text, text, numeric, jsonb, text, int, timestamptz, int, int);
