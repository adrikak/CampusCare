/**
 * Data access.
 *
 * Reads (Phase 1): every query runs as the signed-in user. Row-level security in the database
 * decides which rows come back: students and faculty get only their own
 * complaints, maintenance staff only complaints assigned to them, admins all.
 * Filtering in the UI is for display only; it is not what keeps data private.
 *
 * Writes (Phase 2): the app never inserts or updates tables directly (it has no
 * permission to). Every change goes through one of the two database functions,
 * submit_complaint and perform_action, which check the user's role, the
 * complaint's current status and visit clashes before saving anything.
 *
 * Column names match supabase/schema.sql exactly.
 */
import { supabase } from "./supabase";

export type DbRole = "student" | "faculty" | "admin" | "maintenance";

export type ProfileRow = { id: string; email: string; full_name: string; role: DbRole; team: string | null };

export type ComplaintRow = {
  id: string;
  title: string;
  category: string;
  building: string;
  floor: string;
  room: string;
  description: string;
  requester_id: string;
  requester_name: string;
  requester_role: string;
  priority: string;
  status: string;
  closed_as: string | null;
  team: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  visit_start: string | null;
  visit_end: string | null;
  visit_days: number | null;
  attachment_path: string | null;
  attachment_thumb: string | null;
  attachment_name: string | null;
  attachment_size: number | null;
  submitted_at: string;
  updated_at: string;
};

export type EventRow = {
  id: number;
  complaint_id: string;
  kind: string;
  title: string;
  status: string;
  at: string;
  actor_id: string | null;
  actor_name: string;
  actor_role: string;
  note: string | null;
  reason: string | null;
  evidence_path: string | null;
  evidence_thumb: string | null;
  evidence_name: string | null;
  evidence_size: number | null;
};

const PROFILE_COLUMNS = "id,email,full_name,role,team";
const COMPLAINT_COLUMNS =
  "id,title,category,building,floor,room,description,requester_id,requester_name,requester_role,priority,status,closed_as," +
  "team,assignee_id,assignee_name,visit_start,visit_end,visit_days,attachment_path,attachment_thumb,attachment_name," +
  "attachment_size,submitted_at,updated_at";
const EVENT_COLUMNS =
  "id,complaint_id,kind,title,status,at,actor_id,actor_name,actor_role,note,reason,evidence_path,evidence_thumb,evidence_name,evidence_size";

function client() {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase;
}

/** The signed-in user's own profile: role and team come from the database, never from the login screen. */
export async function loadMyProfile(userId: string): Promise<ProfileRow> {
  const { data, error } = await client().from("profiles").select(PROFILE_COLUMNS).eq("id", userId).maybeSingle();
  if (error) throw new Error(`Could not load your profile: ${error.message}`);
  if (!data) throw new Error("This login has no CampusCare profile yet. Run seed.sql (SETUP.md step 5), then sign in again.");
  return data as ProfileRow;
}

/** All complaints and timeline events this user is allowed to see. */
export async function loadComplaintData(): Promise<{ complaints: ComplaintRow[]; events: EventRow[] }> {
  const db = client();
  const [complaints, events] = await Promise.all([
    db.from("complaints").select(COMPLAINT_COLUMNS).order("submitted_at", { ascending: false }),
    db.from("complaint_events").select(EVENT_COLUMNS).order("at", { ascending: true }).order("id", { ascending: true }),
  ]);
  if (complaints.error) throw new Error(`Could not load complaints: ${complaints.error.message}`);
  if (events.error) throw new Error(`Could not load complaint timelines: ${events.error.message}`);
  return { complaints: (complaints.data ?? []) as ComplaintRow[], events: (events.data ?? []) as EventRow[] };
}

export type StaffRow = { id: string; full_name: string; team: string };

/** Maintenance staff (visible to every signed-in user under row-level security). Used for the assign / reassign lists. */
export async function loadStaff(): Promise<StaffRow[]> {
  const { data, error } = await client().from("profiles").select("id,full_name,team").eq("role", "maintenance").order("full_name");
  if (error) throw new Error(`Could not load the staff list: ${error.message}`);
  return (data ?? []) as StaffRow[];
}

/** Database rules that the form normally enforces first; if one is still hit, explain it in plain words. */
const CHECK_MESSAGES: Array<[RegExp, string]> = [
  [/complaints_room_check/, "Room number must be 1 to 20 characters."],
  [/complaints_description_check/, "The description must be 10 to 2000 characters."],
  [/complaint_events_(note|reason)_check/, "That text is too long: the limit is 1000 characters."],
  [/check constraint/i, "One of the values is not allowed. Please check the form and try again."],
];

/** Turns a database error into the plain sentence the database function raised. */
function cleanError(error: { message?: string } | null): string {
  const msg = (error?.message ?? "").trim();
  for (const [pattern, text] of CHECK_MESSAGES) if (pattern.test(msg)) return text;
  return msg || "The change could not be saved. Please try again.";
}

export type NewComplaintInput = {
  category: string;
  building: string;
  floor: string;
  room: string;
  description: string;
  attachment_path?: string;
  attachment_thumb?: string | null;
  attachment_name?: string;
  attachment_size?: number;
};

/** Students and faculty: creates a complaint. Returns the new complaint ID (e.g. CC-2026-0110). */
export async function submitComplaintToDb(input: NewComplaintInput): Promise<string> {
  const { data, error } = await client().rpc("submit_complaint", { p: input });
  if (error) throw new Error(cleanError(error));
  const id = (data as { id?: string } | null)?.id;
  if (!id) throw new Error("The complaint was not saved. Please try again.");
  return id;
}

/** Every other lifecycle step (review, assign, visit, start work, resolve, confirm, reopen, close, reject). */
export async function performAction(id: string, action: string, p: Record<string, unknown>): Promise<void> {
  const { error } = await client().rpc("perform_action", { p_id: id, p_action: action, p });
  if (error) throw new Error(cleanError(error));
}
