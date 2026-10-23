import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { supabase, supabaseConfigError, supabaseProjectHost } from "./lib/supabase";
import {
  loadComplaintData,
  loadMyProfile,
  loadStaff,
  performAction,
  submitComplaintToDb,
  type ComplaintRow,
  type EventRow,
  type ProfileRow,
  type NewComplaintInput,
  type StaffRow,
} from "./lib/data";
import { PDF_MAX_BYTES, PHOTO_PICK_MAX_BYTES, signedUrl, uploadEvidence } from "./lib/files";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type Role = "student" | "admin" | "maintenance";
type View =
  | "login"
  | "dashboard"
  | "report"
  | "confirmation"
  | "complaints"
  | "detail"
  | "assignments"
  | "feedback";
type Status = "Submitted" | "Under Review" | "Assigned" | "In Progress" | "Resolved" | "Closed";
type Priority = "Not set" | "Low" | "Medium" | "High" | "Urgent";
type Requester = { name: string; role: "Student" | "Faculty" };
/**
 * previewUrl: local preview of a file chosen in this browser (object URL).
 * file: the chosen file, uploaded when the form is submitted.
 * path / thumb: where a stored file lives in the private evidence bucket.
 */
type Evidence = { name: string; size: string; previewUrl?: string; file?: File; path?: string; thumb?: string | null };
/** start/end are the first day's block; the same block repeats for `days` consecutive days. */
type Visit = { start: number; end: number; days?: number };

type EventKind =
  | "submitted"
  | "reviewStarted"
  | "assigned"
  | "reassigned"
  | "workStarted"
  | "resolutionSubmitted"
  | "confirmed"
  | "adminClosed"
  | "reopened"
  | "rejected"
  | "visitScheduled"
  | "visitCancelled";
type Action = Exclude<EventKind, "submitted">;

type TimelineEvent = {
  kind: EventKind;
  title: string;
  status: Status; // status immediately AFTER this action
  at: number; // epoch ms
  by: string;
  byRole: string;
  note?: string;
  reason?: string;
  evidence?: Evidence;
};

type Complaint = {
  id: string;
  title: string;
  category: string;
  building: string;
  floor: string;
  room: string;
  location: string;
  description: string;
  requester: Requester;
  /** Database ids (present for complaints loaded from Supabase). */
  requesterId?: string;
  assigneeId?: string;
  priority: Priority;
  team?: string;
  assignee?: string;
  attachment?: Evidence;
  visit?: Visit;
  submittedAt: number;
  status: Status;
  history: TimelineEvent[];
};

/* ------------------------------------------------------------------ */
/* Demo people (fictional)                                             */
/* ------------------------------------------------------------------ */

const STUDENT_USER: Requester = { name: "Ananya Kulkarni", role: "Student" };
const ADMIN_NAME = "Sunita Patil";

const teams = ["Electrical", "Plumbing", "IT Support", "Housekeeping", "General Maintenance"];
const staffDirectory: Array<{ name: string; team: string }> = [
  { name: "Ramesh Jadhav", team: "Electrical" },
  { name: "Anil More", team: "Electrical" },
  { name: "Suresh Pawar", team: "Plumbing" },
  { name: "Kiran Gaikwad", team: "IT Support" },
  { name: "Lata Bhosale", team: "Housekeeping" },
  { name: "Vikas Shinde", team: "General Maintenance" },
];
const categoryTeam: Record<string, string> = {
  Electrical: "Electrical",
  Plumbing: "Plumbing",
  "IT & Network": "IT Support",
  Cleanliness: "Housekeeping",
  Furniture: "General Maintenance",
  Safety: "General Maintenance",
  HVAC: "General Maintenance",
  Other: "General Maintenance",
};

/** Maintenance staff loaded from the database (id, name, team). The assign lists use this, not the names above. */
const StaffContext = createContext<StaffRow[]>([]);

const categories = ["Electrical", "Plumbing", "IT & Network", "Furniture", "Cleanliness", "Safety", "HVAC", "Other"];
const buildings = ["A1", "A2", "B", "C", "D"];
const floors = ["Ground Floor", "1st Floor", "2nd Floor", "3rd Floor"];
const priorities: Priority[] = ["Low", "Medium", "High", "Urgent"];
const workflow: Status[] = ["Submitted", "Under Review", "Assigned", "In Progress", "Resolved", "Closed"];

/** Proposed demo policy, not an existing college rule. */
const NO_RESPONSE_DAYS = 3;
const MIN_REASON = 10;

/* ------------------------------------------------------------------ */
/* Lifecycle rules                                                     */
/* ------------------------------------------------------------------ */

const rules: Record<Action, { from: Status[]; roles: Role[] }> = {
  reviewStarted: { from: ["Submitted"], roles: ["admin"] },
  assigned: { from: ["Under Review"], roles: ["admin"] },
  reassigned: { from: ["Assigned", "In Progress"], roles: ["admin"] },
  workStarted: { from: ["Assigned"], roles: ["maintenance"] },
  resolutionSubmitted: { from: ["In Progress"], roles: ["maintenance"] },
  confirmed: { from: ["Resolved"], roles: ["student"] },
  adminClosed: { from: ["Resolved"], roles: ["admin"] },
  reopened: { from: ["Resolved"], roles: ["student", "admin"] },
  rejected: { from: ["Submitted", "Under Review"], roles: ["admin"] },
  visitScheduled: { from: ["Assigned", "In Progress"], roles: ["admin"] },
  visitCancelled: { from: ["Assigned", "In Progress"], roles: ["admin"] },
};

/** null = status does not change (reassignment). */
const resultStatus: Record<EventKind, Status | null> = {
  submitted: "Submitted",
  reviewStarted: "Under Review",
  assigned: "Assigned",
  reassigned: null,
  workStarted: "In Progress",
  resolutionSubmitted: "Resolved",
  confirmed: "Closed",
  adminClosed: "Closed",
  reopened: "In Progress",
  rejected: "Closed",
  visitScheduled: null,
  visitCancelled: null,
};

function eventTitle(kind: EventKind, staff?: string) {
  switch (kind) {
    case "submitted":
      return "Complaint submitted";
    case "reviewStarted":
      return "Review started";
    case "assigned":
      return `Assigned to ${staff ?? "staff member"}`;
    case "reassigned":
      return `Reassigned to ${staff ?? "staff member"}`;
    case "workStarted":
      return "Work started";
    case "resolutionSubmitted":
      return "Resolution submitted";
    case "confirmed":
      return "Requester confirmed fixed";
    case "adminClosed":
      return "Verified and closed by admin";
    case "reopened":
      return "Reopened";
    case "rejected":
      return "Rejected — not actionable";
    case "visitScheduled":
      return "Visit scheduled";
    case "visitCancelled":
      return "Visit cancelled";
  }
}

function canAct(item: Complaint, action: Action, role: Role, user: string) {
  const rule = rules[action];
  if (!rule.from.includes(item.status) || !rule.roles.includes(role)) return false;
  if (role === "maintenance" && item.assignee !== user) return false;
  if (role === "student" && item.requester.name !== user) return false;
  return true;
}

const isRejected = (item: Complaint) => item.history.some((e) => e.kind === "rejected");

/** The resolution currently awaiting/after verification (ignores ones that were reopened). */
function latestResolution(item: Complaint): TimelineEvent | undefined {
  for (let i = item.history.length - 1; i >= 0; i--) {
    const e = item.history[i];
    if (e.kind === "reopened") return undefined;
    if (e.kind === "resolutionSubmitted") return e;
  }
  return undefined;
}

const reopenCount = (item: Complaint) => item.history.filter((e) => e.kind === "reopened").length;
const lastEvent = (item: Complaint): TimelineEvent =>
  item.history[item.history.length - 1] ?? {
    kind: "submitted",
    title: "Complaint submitted",
    status: item.status,
    at: item.submittedAt,
    by: item.requester.name,
    byRole: item.requester.role,
  };

/* ------------------------------------------------------------------ */
/* Dates                                                               */
/* ------------------------------------------------------------------ */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function fmtDate(ms: number) {
  return new Date(ms).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
function fmtDateTime(ms: number) {
  const d = new Date(ms);
  return `${d.toLocaleDateString("en-IN", { day: "numeric", month: "short" })} · ${d.toLocaleTimeString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}
function timeAgo(ms: number) {
  const diff = Date.now() - ms;
  if (diff < 60 * 1000) return "just now";
  if (diff < HOUR) return `${Math.floor(diff / 60000)} min ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} h ago`;
  const days = Math.floor(diff / DAY);
  return days === 1 ? "yesterday" : `${days} days ago`;
}
/** Placeholder working hours for the prototype — not a confirmed campus timetable. */
const WORK_START_HOUR = 9;
const WORK_END_HOUR = 17;
const VISIT_MINUTES = 60;

const fmtTime = (ms: number) => new Date(ms).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
function fmtSlot(v: Visit) {
  const days = v.days ?? 1;
  const day = new Date(v.start).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
  if (days === 1) return `${day}, ${fmtTime(v.start)}–${fmtTime(v.end)}`;
  const last = new Date(v.start + (days - 1) * DAY).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
  return `${day} – ${last}, ${fmtTime(v.start)}–${fmtTime(v.end)} each day (${days} days)`;
}
/** Every individual day-block a visit occupies. */
function visitBlocks(v: Visit): Array<{ start: number; end: number }> {
  return Array.from({ length: v.days ?? 1 }, (_, i) => {
    const s = new Date(v.start);
    s.setDate(s.getDate() + i);
    return { start: s.getTime(), end: s.getTime() + (v.end - v.start) };
  });
}
function dayAt(base: Date, dayOffset: number, hour: number) {
  const d = new Date(base);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
}
function toInputDate(ms: number) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const overlaps = (a: Visit, b: Visit) =>
  visitBlocks(a).some((x) => visitBlocks(b).some((y) => x.start < y.end && y.start < x.end));
const hasActiveVisit = (i: Complaint) => !!i.visit && (i.status === "Assigned" || i.status === "In Progress");
function busyFor(staff: string, items: Complaint[], excludeId?: string): Visit[] {
  return items.filter((i) => i.assignee === staff && i.id !== excludeId && hasActiveVisit(i)).map((i) => i.visit as Visit);
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}
function todayLabel() {
  return new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
}

/* ------------------------------------------------------------------ */
/* Seed data — every timestamp is relative to "now" and never future   */
/* ------------------------------------------------------------------ */

function formatLocation(place: { building: string; floor: string; room: string }) {
  return `Building ${place.building} · ${place.floor} · Room ${place.room}`;
}

type SeedEvent = [EventKind, number, { note?: string; reason?: string; by?: Requester | "admin"; evidence?: Evidence }?];
type Seed = Omit<Complaint, "status" | "history" | "submittedAt" | "location" | "visit"> & {
  hoursAgo: number;
  events: SeedEvent[];
  /** [days from today, start hour] */
  visitAt?: [number, number];
};

const seeds: Seed[] = [
  {
    id: "CC-2026-0101",
    title: "Air conditioner not cooling",
    category: "Electrical",
    building: "A1",
    floor: "2nd Floor",
    room: "204",
    description: "The air conditioner has stopped cooling and makes a rattling sound. The room gets very warm during afternoon lectures.",
    requester: STUDENT_USER,
    priority: "High",
    team: "Electrical",
    assignee: "Ramesh Jadhav",
    attachment: { name: "ac-unit.jpg", size: "1.8 MB" },
    hoursAgo: 50,
    events: [["submitted", 0], ["reviewStarted", 3], ["assigned", 4], ["workStarted", 26]],
  },
  {
    id: "CC-2026-0102",
    title: "Water leak near the staircase",
    category: "Plumbing",
    building: "B",
    floor: "2nd Floor",
    room: "205",
    description: "Water is pooling beside the staircase outside Room 205 and creating a slipping hazard.",
    requester: { name: "Rohan Deshpande", role: "Student" },
    priority: "Urgent",
    team: "Plumbing",
    assignee: "Suresh Pawar",
    hoursAgo: 20,
    visitAt: [1, 10],
    events: [["submitted", 0], ["reviewStarted", 1], ["assigned", 1.5], ["visitScheduled", 1.6]],
  },
  {
    id: "CC-2026-0103",
    title: "Broken desk in classroom",
    category: "Furniture",
    building: "C",
    floor: "Ground Floor",
    room: "102",
    description: "The front-left desk has a loose writing surface and cannot be used safely.",
    requester: STUDENT_USER,
    priority: "Medium",
    team: "General Maintenance",
    assignee: "Vikas Shinde",
    hoursAgo: 6 * 24,
    events: [
      ["submitted", 0],
      ["reviewStarted", 5],
      ["assigned", 6],
      ["workStarted", 50],
      ["resolutionSubmitted", 120, { note: "Writing surface re-fixed with new screws and brackets; desk tested and stable." }],
    ],
  },
  {
    id: "CC-2026-0104",
    title: "Wi-Fi disconnects frequently",
    category: "IT & Network",
    building: "D",
    floor: "3rd Floor",
    room: "301",
    description: "The Wi-Fi disconnects every few minutes in Room 301, interrupting online lab work.",
    requester: STUDENT_USER,
    priority: "Medium",
    team: "IT Support",
    assignee: "Kiran Gaikwad",
    hoursAgo: 12 * 24,
    events: [
      ["submitted", 0],
      ["reviewStarted", 4],
      ["assigned", 5],
      ["workStarted", 28],
      ["resolutionSubmitted", 70, { note: "Replaced the faulty access point on the 3rd floor and updated its firmware." }],
      ["confirmed", 96, { note: "Rated 4/5." }],
    ],
  },
  {
    id: "CC-2026-0105",
    title: "Overflowing waste bins",
    category: "Cleanliness",
    building: "A2",
    floor: "Ground Floor",
    room: "12",
    description: "Waste bins near the seating area outside Room 12 overflow by mid-day and need more frequent collection.",
    requester: { name: "Prof. Meera Joshi", role: "Faculty" },
    priority: "Low",
    hoursAgo: 22,
    events: [["submitted", 0], ["reviewStarted", 18]],
  },
  {
    id: "CC-2026-0106",
    title: "Flickering corridor lights",
    category: "Electrical",
    building: "D",
    floor: "1st Floor",
    room: "108",
    description: "Lights in the corridor outside Room 108 flicker constantly in the evening.",
    requester: { name: "Rohan Deshpande", role: "Student" },
    priority: "Medium",
    team: "Electrical",
    assignee: "Ramesh Jadhav",
    hoursAgo: 8 * 24,
    events: [
      ["submitted", 0],
      ["reviewStarted", 6],
      ["assigned", 7],
      ["workStarted", 30],
      ["resolutionSubmitted", 96, { note: "Replaced two faulty tube-light chokes; all corridor lights checked after 6 PM." }],
    ],
  },
  {
    id: "CC-2026-0107",
    title: "Stairwell light not working",
    category: "Electrical",
    building: "C",
    floor: "Ground Floor",
    room: "4",
    description: "The stairwell light next to Room 4 has been off for several evenings, making the stairs unsafe after dark.",
    requester: { name: "Prof. Meera Joshi", role: "Faculty" },
    priority: "High",
    team: "Electrical",
    assignee: "Ramesh Jadhav",
    hoursAgo: 9,
    visitAt: [1, 9],
    events: [["submitted", 0], ["reviewStarted", 1], ["assigned", 2], ["visitScheduled", 2.1]],
  },
  {
    id: "CC-2026-0108",
    title: "Projector shows no signal",
    category: "IT & Network",
    building: "A1",
    floor: "1st Floor",
    room: "110",
    description: "The ceiling projector shows no signal even with a working HDMI cable.",
    requester: STUDENT_USER,
    priority: "Not set",
    hoursAgo: 3,
    events: [["submitted", 0]],
  },
  {
    id: "CC-2026-0109",
    title: "Request to change lab timetable",
    category: "Other",
    building: "A2",
    floor: "1st Floor",
    room: "115",
    description: "Our lab session clashes with another subject; please move it to the afternoon.",
    requester: { name: "Rohan Deshpande", role: "Student" },
    priority: "Not set",
    hoursAgo: 5 * 24,
    events: [
      ["submitted", 0],
      ["rejected", 8, { reason: "Not a facilities issue. Timetable requests are handled by the academic office." }],
    ],
  },
];

function buildSeed(seed: Seed): Complaint {
  const now = Date.now();
  const submittedAt = now - seed.hoursAgo * HOUR;
  const history: TimelineEvent[] = [];
  let status: Status = "Submitted";
  const visit: Visit | undefined = seed.visitAt
    ? { start: dayAt(new Date(now), seed.visitAt[0], seed.visitAt[1]), end: dayAt(new Date(now), seed.visitAt[0], seed.visitAt[1]) + VISIT_MINUTES * 60 * 1000 }
    : undefined;
  for (const [kind, offset, extra = {}] of seed.events) {
    const at = Math.min(submittedAt + offset * HOUR, now - 5 * 60 * 1000);
    status = resultStatus[kind] ?? status;
    const byRequester = kind === "submitted" || kind === "confirmed";
    const byStaff = kind === "workStarted" || kind === "resolutionSubmitted";
    const person = byRequester
      ? { name: seed.requester.name, role: seed.requester.role }
      : byStaff
        ? { name: seed.assignee ?? "Maintenance", role: "Maintenance" }
        : { name: ADMIN_NAME, role: "Administrator" };
    history.push({
      kind,
      title: kind === "visitScheduled" && visit ? `Visit scheduled: ${fmtSlot(visit)}` : eventTitle(kind, seed.assignee),
      status,
      at,
      by: person.name,
      byRole: person.role,
      note:
        extra.note ??
        (kind === "reviewStarted"
          ? `Priority set to ${seed.priority}.`
          : kind === "assigned"
            ? `Team: ${seed.team}.`
            : kind === "submitted" && seed.attachment
              ? "Submitted with evidence attached."
              : kind === "visitScheduled"
                ? `${seed.assignee} at ${formatLocation(seed)}.`
                : undefined),
      reason: extra.reason,
      evidence: extra.evidence,
    });
  }
  const { hoursAgo: _h, events: _e, visitAt: _v, ...rest } = seed;
  return { ...rest, location: formatLocation(seed), submittedAt, status, history, visit };
}

/* Phase 1: the built-in sample data above is no longer shown; complaints come
   from Supabase. It is kept for now so this change is easy to undo. */
export const prototypeSampleComplaints: Complaint[] = seeds.map(buildSeed).sort((a, b) => b.submittedAt - a.submittedAt);

/** Converts database rows (column names from supabase/schema.sql) into the shape the UI already uses. */
function toComplaints(rows: ComplaintRow[], events: EventRow[]): Complaint[] {
  const byComplaint = new Map<string, TimelineEvent[]>();
  for (const e of events) {
    const list = byComplaint.get(e.complaint_id) ?? [];
    list.push({
      kind: e.kind as EventKind,
      title: e.title,
      status: e.status as Status,
      at: Date.parse(e.at),
      by: e.actor_name,
      byRole: e.actor_role,
      note: e.note ?? undefined,
      reason: e.reason ?? undefined,
      evidence: e.evidence_name
        ? { name: e.evidence_name, size: e.evidence_size != null ? formatSize(e.evidence_size) : "", path: e.evidence_path ?? undefined, thumb: e.evidence_thumb }
        : undefined,
    });
    byComplaint.set(e.complaint_id, list);
  }
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    category: r.category,
    building: r.building,
    floor: r.floor,
    room: r.room,
    location: formatLocation(r),
    description: r.description,
    requester: { name: r.requester_name, role: r.requester_role === "Faculty" ? "Faculty" : "Student" },
    requesterId: r.requester_id,
    assigneeId: r.assignee_id ?? undefined,
    priority: r.priority as Priority,
    team: r.team ?? undefined,
    assignee: r.assignee_name ?? undefined,
    attachment: r.attachment_name
      ? { name: r.attachment_name, size: r.attachment_size != null ? formatSize(r.attachment_size) : "", path: r.attachment_path ?? undefined, thumb: r.attachment_thumb }
      : undefined,
    visit:
      r.visit_start && r.visit_end
        ? { start: Date.parse(r.visit_start), end: Date.parse(r.visit_end), days: r.visit_days ?? 1 }
        : undefined,
    submittedAt: Date.parse(r.submitted_at),
    status: r.status as Status,
    history: byComplaint.get(r.id) ?? [],
  }));
}

/** Fictional demo logins (created in Supabase). These only fill in the email box; the role always comes from the database. */
const DEMO_ACCOUNTS: Array<{ label: string; name: string; email: string; icon: string }> = [
  { label: "Student", name: "Ananya Kulkarni", email: "ananya.kulkarni@campuscare.demo", icon: "users" },
  { label: "Student", name: "Rohan Deshpande", email: "rohan.deshpande@campuscare.demo", icon: "users" },
  { label: "Faculty", name: "Prof. Meera Joshi", email: "meera.joshi@campuscare.demo", icon: "users" },
  { label: "Administrator", name: "Sunita Patil", email: "sunita.patil@campuscare.demo", icon: "clipboard" },
  ...staffDirectory.map((s) => ({
    label: `Maintenance · ${s.team}`,
    name: s.name,
    email: `${s.name.toLowerCase().replace(/\s+/g, ".")}@campuscare.demo`,
    icon: "wrench",
  })),
];

/* ------------------------------------------------------------------ */
/* Icons & small UI primitives (unchanged design)                      */
/* ------------------------------------------------------------------ */

const iconPaths: Record<string, ReactNode> = {
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2M6.6 6.6C3.7 8.5 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18" />
    </>
  ),
  logo: (
    <>
      <path d="M12 3 4 7v5c0 4.5 3.4 7.9 8 9 4.6-1.1 8-4.5 8-9V7l-8-4Z" />
      <path d="M9 12h6M12 9v6" />
    </>
  ),
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="2" />
      <rect x="14" y="3" width="7" height="7" rx="2" />
      <rect x="3" y="14" width="7" height="7" rx="2" />
      <rect x="14" y="14" width="7" height="7" rx="2" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  clipboard: (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4.5V3h6v1.5M9 10h6M9 14h6M9 18h3" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19c.5-3.3 2.3-5 5.5-5s5 1.7 5.5 5M16 5.5a3 3 0 0 1 0 5.8M17 14c2.1.3 3.3 1.7 3.5 4" />
    </>
  ),
  wrench: <path d="M14.7 6.3a4 4 0 0 0-5-5l2.1 2.1-2.4 2.4-2.1-2.1a4 4 0 0 0 5 5L20 17.4a1.8 1.8 0 0 1-2.6 2.6l-7.7-8.7" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  arrow: <path d="m9 18 6-6-6-6" />,
  back: <path d="m15 18-6-6 6-6" />,
  check: <path d="m5 12 4 4L19 6" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V4M8 8l4-4 4 4" />
      <path d="M4 15v5h16v-5" />
    </>
  ),
  file: (
    <>
      <path d="M6 2h8l4 4v16H6z" />
      <path d="M14 2v5h5" />
    </>
  ),
  location: (
    <>
      <path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  logout: <path d="M10 4H4v16h6M14 8l4 4-4 4M18 12H9" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  star: <path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z" />,
  refresh: <path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" />,
};

function Icon({ name, className = "size-5" }: { name: string; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      {iconPaths[name]}
    </svg>
  );
}

function Button({
  children,
  onClick,
  variant = "primary",
  className = "",
  type = "button",
  disabled = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "inverse";
  className?: string;
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  const styles = {
    primary: "bg-blue-600 text-white shadow-sm hover:bg-blue-700",
    inverse: "bg-white text-blue-700 shadow-sm hover:bg-blue-50",
    secondary: "border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800",
    ghost: "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800",
    danger: "border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-500/20",
  };
  return (
    <button
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition focus:outline-none focus:ring-4 focus:ring-blue-100 dark:focus:ring-blue-500/30 disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`}
      disabled={disabled}
      onClick={onClick}
      type={type}
    >
      {children}
    </button>
  );
}

function StatusBadge({ status, rejected = false }: { status: Status; rejected?: boolean }) {
  const styles: Record<Status, string> = {
    Submitted: "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 ring-slate-300 dark:ring-slate-600",
    "Under Review": "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-amber-200 dark:ring-amber-500/30",
    Assigned: "bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-300 ring-violet-200 dark:ring-violet-500/30",
    "In Progress": "bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 ring-blue-200 dark:ring-blue-500/30",
    Resolved: "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-200 dark:ring-emerald-500/30",
    Closed: "bg-slate-800 text-white ring-slate-800 dark:bg-slate-200 dark:text-slate-900 dark:ring-slate-200",
  };
  const cls = rejected ? "bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-rose-200 dark:ring-rose-500/30" : styles[status];
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${cls}`}>
      {status === "Closed" && !rejected && <Icon name="check" className="size-3" />}
      {rejected ? "Closed — not actionable" : status}
    </span>
  );
}

function ComplaintStatus({ item }: { item: Complaint }) {
  return <StatusBadge rejected={isRejected(item)} status={item.status} />;
}

function PriorityBadge({ priority }: { priority: Priority }) {
  const color = {
    "Not set": "text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-900 border border-dashed border-slate-300 dark:border-slate-700",
    Low: "text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800",
    Medium: "text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10",
    High: "text-orange-700 dark:text-orange-300 bg-orange-50 dark:bg-orange-500/10",
    Urgent: "text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-500/10",
  }[priority];
  return (
    <span className={`whitespace-nowrap rounded-md px-2 py-1 text-xs font-semibold ${color}`}>
      {priority === "Not set" ? "Priority not set" : priority}
    </span>
  );
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold text-slate-700 dark:text-slate-200">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-slate-500 dark:text-slate-400">{hint}</span>}
    </label>
  );
}

/** Follows the phone/laptop light or dark setting: native controls, scrollbars and page background. */
const darkModeCss = `
:root { color-scheme: light dark; }
@media (prefers-color-scheme: dark) { html, body { background-color: #020617; } }
`;

const fieldClass =
  "w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3.5 py-3 text-sm text-slate-800 dark:text-slate-100 outline-none transition placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-blue-500 focus:ring-4 focus:ring-blue-50 dark:focus:ring-blue-500/30";

function Logo({ compact = false, dark = false }: { compact?: boolean; dark?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-blue-600 text-white shadow-sm shadow-blue-200 dark:shadow-none">
        <Icon name="logo" className="size-6" />
      </span>
      {!compact && (
        <span className={`text-xl font-extrabold tracking-tight ${dark ? "text-white" : "text-slate-900 dark:text-slate-50"}`}>
          Campus<span className={dark ? "text-blue-400" : "text-blue-600 dark:text-blue-400"}>Care</span>
        </span>
      )}
    </div>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="mt-1.5 text-xs font-medium text-red-600 dark:text-red-400" role="alert">
      {message}
    </p>
  );
}

function firstName(name: string) {
  return name.replace(/^Prof\.\s*/, "").split(" ")[0];
}

function initials(name: string) {
  return name
    .replace(/^Prof\.\s*/, "")
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/* ------------------------------------------------------------------ */
/* Files                                                               */
/* ------------------------------------------------------------------ */

const ALLOWED_EXTENSIONS = ["jpg", "jpeg", "png", "pdf"];
const ALLOWED_TYPES = ["image/jpeg", "image/png", "application/pdf"];
const FILE_HINT = "Photos (JPG, PNG) are shrunk automatically to 500 KB or less · PDF up to 2 MB";

function validateFile(file: File): string {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXTENSIONS.includes(extension) || (file.type && !ALLOWED_TYPES.includes(file.type))) {
    return `“${file.name}” was not attached because it is not a supported format. Choose a JPG, JPEG, PNG or PDF file, or submit without a file.`;
  }
  if (extension === "pdf" && file.size > PDF_MAX_BYTES) {
    return `“${file.name}” was not attached because PDFs can be at most 2 MB. Choose a smaller PDF, or submit without a file.`;
  }
  if (file.size > PHOTO_PICK_MAX_BYTES) {
    return `“${file.name}” was not attached because it is larger than 10 MB. Choose a smaller photo, or submit without a file.`;
  }
  return "";
}

function formatSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Small square preview, or a file icon for PDFs / files without a session preview. */
function EvidenceThumb({ evidence, size = "size-10", tone = "blue" }: { evidence: Evidence; size?: string; tone?: "blue" | "emerald" }) {
  if (evidence.previewUrl) {
    return <img alt={`Preview of ${evidence.name}`} className={`${size} shrink-0 rounded-lg object-cover ring-1 ring-slate-200 dark:ring-slate-700`} src={evidence.previewUrl} />;
  }
  return (
    <span
      className={`grid ${size} shrink-0 place-items-center rounded-lg bg-white dark:bg-slate-900 ${
        tone === "emerald" ? "text-emerald-600 dark:text-emerald-400" : "text-blue-600 dark:text-blue-400"
      }`}
    >
      <Icon name="file" />
    </span>
  );
}

function previewFor(file: File) {
  return file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
}

/** A stored evidence file: thumbnail through a short-lived signed link, and a link to open the full file. */
function StoredEvidence({ evidence, from, tone = "blue" }: { evidence: Evidence; from: string; tone?: "blue" | "emerald" }) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [problem, setProblem] = useState("");
  const [opening, setOpening] = useState(false);
  useEffect(() => {
    let active = true;
    if (evidence.thumb) {
      signedUrl(evidence.thumb)
        .then((url) => active && setThumbUrl(url))
        .catch(() => active && setThumbUrl(null));
    }
    return () => {
      active = false;
    };
  }, [evidence.thumb]);
  const openFile = async () => {
    if (!evidence.path) return;
    setOpening(true);
    setProblem("");
    try {
      window.open(await signedUrl(evidence.path), "_blank", "noopener");
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "The file could not be opened.");
    } finally {
      setOpening(false);
    }
  };
  return (
    <div className="mt-4 flex items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3">
      {thumbUrl ? (
        <img alt={`Evidence: ${evidence.name}`} className="size-20 shrink-0 rounded-lg object-cover ring-1 ring-slate-200 dark:ring-slate-700" src={thumbUrl} />
      ) : (
        <EvidenceThumb evidence={{ name: evidence.name, size: evidence.size }} size="size-10" tone={tone} />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{evidence.name}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {evidence.size} · {from}
        </p>
        <FieldError message={problem} />
      </div>
      {evidence.path ? (
        <Button disabled={opening} onClick={() => void openFile()} variant="ghost">
          {opening ? "Opening…" : "Open"}
        </Button>
      ) : (
        <span className="text-xs text-slate-500 dark:text-slate-400">File not stored</span>
      )}
    </div>
  );
}

/** Compact evidence picker used by maintenance (same rules as the report form). */
function EvidencePicker({ value, onChange }: { value: Evidence | null; onChange: (file: Evidence | null) => void }) {
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  if (value) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3">
        <EvidenceThumb evidence={value} size="size-12" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{value.name}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">{value.size} · uploaded when you submit</p>
        </div>
        <Button
          onClick={() => {
            if (value.previewUrl) URL.revokeObjectURL(value.previewUrl);
            onChange(null);
          }}
          variant="ghost"
        >
          Remove
        </Button>
      </div>
    );
  }
  return (
    <>
      <label
        className={`flex cursor-pointer items-center gap-3 rounded-xl border border-dashed p-3 text-sm font-semibold text-slate-600 dark:text-slate-300 focus-within:ring-4 focus-within:ring-blue-100 dark:focus-within:ring-blue-500/30 ${
          error ? "border-red-300 dark:border-red-500/50 bg-red-50/50 dark:bg-red-500/10" : "border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 hover:border-blue-300 dark:hover:border-blue-500/40"
        }`}
      >
        <input
          accept=".jpg,.jpeg,.png,.pdf"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            const problem = validateFile(file);
            if (inputRef.current) inputRef.current.value = "";
            if (problem) {
              setError(problem);
              return;
            }
            setError("");
            onChange({ name: file.name, size: formatSize(file.size), previewUrl: previewFor(file), file });
          }}
          ref={inputRef}
          type="file"
        />
        <Icon name="upload" className="size-4 text-blue-600 dark:text-blue-400" /> Upload photo or PDF (optional)
      </label>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{FILE_HINT}</p>
      <FieldError message={error} />
    </>
  );
}

/** Required-reason form used for reject / reopen / admin close. */
function ReasonForm({
  label,
  placeholder,
  confirmLabel,
  variant = "primary",
  onConfirm,
  onCancel,
}: {
  label: string;
  placeholder: string;
  confirmLabel: string;
  variant?: "primary" | "danger";
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  return (
    <div className="space-y-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-4">
      <Field label={label}>
        <textarea
          autoFocus
          className={`${fieldClass} min-h-24 ${error ? "border-red-300 dark:border-red-500/50" : ""}`}
          onChange={(event) => setReason(event.target.value)}
          placeholder={placeholder}
          value={reason}
        />
      </Field>
      <FieldError message={error} />
      <div className="flex gap-2">
        <Button
          className="flex-1"
          onClick={() => {
            if (reason.trim().length < MIN_REASON) {
              setError(`Please give a reason of at least ${MIN_REASON} characters.`);
              return;
            }
            onConfirm(reason.trim());
          }}
          variant={variant}
        >
          {confirmLabel}
        </Button>
        <Button onClick={onCancel} variant="secondary">
          Cancel
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Login                                                               */
/* ------------------------------------------------------------------ */

function Login() {
  const [email, setEmail] = useState(DEMO_ACCOUNTS[0].email);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const quick = [DEMO_ACCOUNTS[0], DEMO_ACCOUNTS[2], DEMO_ACCOUNTS[3], DEMO_ACCOUNTS[4]];

  const signIn = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError("");
    const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (authError) {
      setError(
        /invalid login/i.test(authError.message)
          ? "Email or password is incorrect."
          : `Could not sign in: ${authError.message}`,
      );
    }
    // On success the auth listener in <App> loads the profile and complaints.
  };

  return (
    <main className="grid min-h-screen bg-slate-50 dark:bg-slate-950 lg:grid-cols-[1.05fr_.95fr]">
      <style>{darkModeCss}</style>
      <section className="relative hidden overflow-hidden bg-slate-950 px-12 py-10 text-white lg:flex lg:flex-col">
        <div className="absolute -right-24 -top-24 size-96 rounded-full bg-blue-600/20 blur-3xl" />
        <div className="absolute -bottom-20 left-20 size-80 rounded-full bg-cyan-500/10 blur-3xl" />
        <Logo dark />
        <div className="relative my-auto max-w-xl">
          <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-medium text-blue-200">
            <span className="size-2 rounded-full bg-emerald-400" />
            JSPM RSCOE, Pune · Design Thinking prototype
          </span>
          <h1 className="text-5xl font-extrabold leading-tight tracking-tight">
            Campus support that keeps everyone in the loop.
          </h1>
          <p className="mt-6 max-w-lg text-lg leading-8 text-slate-300">
            Report infrastructure issues with an exact location, follow every step, and close them only once the fix is confirmed.
          </p>
          <div className="mt-10 grid grid-cols-3 gap-3">
            {[
              ["Exact location", "Building, floor and room on every report"],
              ["Every step tracked", "One shared timeline for all roles"],
              ["Verified closure", "Requester or admin confirms the fix"],
            ].map(([value, label]) => (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4" key={value}>
                <p className="text-base font-bold">{value}</p>
                <p className="mt-1 text-xs leading-5 text-slate-400">{label}</p>
              </div>
            ))}
          </div>
        </div>
        <p className="relative text-xs text-slate-500">CampusCare demonstration portal · Demo accounts and data are fictional</p>
      </section>
      <section className="flex items-center justify-center p-5 sm:p-10">
        <div className="w-full max-w-lg">
          <div className="mb-8 lg:hidden">
            <Logo />
          </div>
          <div className="mb-8">
            <p className="text-sm font-semibold text-blue-600 dark:text-blue-400">Welcome</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50">Sign in to CampusCare</h2>
            <p className="mt-2 text-slate-500 dark:text-slate-400">Everyone signs in here with their own account. Students and faculty use the same screens; your account decides your role.</p>
          </div>
          <p className="mb-2 text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Demo accounts</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {quick.map((item) => (
              <button
                className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition ${
                  email === item.email
                    ? "border-blue-500 bg-blue-50 dark:bg-blue-500/10 ring-4 ring-blue-50 dark:ring-blue-500/20"
                    : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-600"
                }`}
                key={item.email}
                onClick={() => setEmail(item.email)}
                type="button"
              >
                <span
                  className={`grid size-10 shrink-0 place-items-center rounded-xl ${
                    email === item.email ? "bg-blue-600 text-white" : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
                  }`}
                >
                  <Icon name={item.icon} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-900 dark:text-slate-50">{item.label}</span>
                  <span className="mt-0.5 block truncate text-xs text-slate-500 dark:text-slate-400">{item.name}</span>
                </span>
              </button>
            ))}
          </div>
          <form className="mt-5 space-y-4" noValidate onSubmit={signIn}>
            <Field label="Email">
              <input
                autoComplete="username"
                className={fieldClass}
                list="campuscare-demo-accounts"
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                value={email}
              />
              <datalist id="campuscare-demo-accounts">
                {DEMO_ACCOUNTS.map((a) => (
                  <option key={a.email} value={a.email}>
                    {a.name} · {a.label}
                  </option>
                ))}
              </datalist>
            </Field>
            <Field label="Password">
              <div className="relative">
                <input
                  autoComplete="current-password"
                  className={`${fieldClass} pr-12`}
                  onChange={(event) => setPassword(event.target.value)}
                  type={showPassword ? "text" : "password"}
                  value={password}
                />
                <button
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-xl text-slate-500 hover:text-slate-800 focus-visible:outline-2 focus-visible:outline-blue-500 dark:text-slate-400 dark:hover:text-slate-100"
                  onClick={(event) => {
                    event.preventDefault();
                    setShowPassword((v) => !v);
                  }}
                  title={showPassword ? "Hide password" : "Show password"}
                  type="button"
                >
                  <Icon className="size-5" name={showPassword ? "eyeOff" : "eye"} />
                </button>
              </div>
            </Field>
            <FieldError message={error} />
            <Button className="w-full" disabled={busy || !email.trim() || !password} type="submit">
              {busy ? "Signing in…" : "Sign in"} {!busy && <Icon name="arrow" className="size-4" />}
            </Button>
          </form>
          <p className="mt-5 text-center text-xs leading-5 text-slate-500 dark:text-slate-400">
            Demo accounts are fictional. Other staff logins can be typed into the email box.
          </p>
          <p className="mt-2 text-center text-xs text-slate-500 dark:text-slate-400">
            Live database: <span className="font-semibold">{supabaseProjectHost}</span>
          </p>
        </div>
      </section>
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* Shell                                                               */
/* ------------------------------------------------------------------ */

function Sidebar({
  role,
  user,
  roleLabel,
  view,
  setView,
  onLogout,
  open,
  setOpen,
}: {
  role: Role;
  user: string;
  roleLabel: string;
  view: View;
  setView: (view: View) => void;
  onLogout: () => void;
  open: boolean;
  setOpen: (value: boolean) => void;
}) {
  const nav =
    role === "student"
      ? [
          ["dashboard", "grid", "Overview"],
          ["report", "plus", "Report issue"],
          ["complaints", "clipboard", "My complaints"],
        ]
      : role === "admin"
        ? [
            ["dashboard", "grid", "Overview"],
            ["complaints", "clipboard", "All complaints"],
          ]
        : [
            ["dashboard", "grid", "Overview"],
            ["assignments", "wrench", "My assignments"],
          ];
  const listView = role === "maintenance" ? "assignments" : "complaints";
  return (
    <>
      {open && (
        <button aria-label="Close navigation" className="fixed inset-0 z-30 bg-slate-950/40 lg:hidden" onClick={() => setOpen(false)} />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 transition-transform lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="px-2 py-1">
          <Logo />
        </div>
        <nav className="mt-9 flex-1 space-y-1.5">
          <p className="mb-3 px-3 text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Workspace</p>
          {nav.map(([target, icon, label]) => {
            const active = view === target || (target === listView && ["detail", "feedback"].includes(view));
            return (
              <button
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold transition ${
                  active ? "bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300" : "text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white"
                }`}
                key={target}
                onClick={() => {
                  setView(target as View);
                  setOpen(false);
                }}
              >
                <Icon name={icon} className="size-5" />
                {label}
              </button>
            );
          })}
        </nav>
        <div className="rounded-2xl bg-slate-50 dark:bg-slate-950 p-3">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-full bg-slate-900 text-xs font-bold text-white dark:bg-slate-700">{initials(user)}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-50">{user}</p>
              <p className="truncate text-xs text-slate-500 dark:text-slate-400">{roleLabel}</p>
            </div>
          </div>
          <button
            className="mt-3 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-xs font-semibold text-slate-500 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white"
            onClick={onLogout}
          >
            <Icon name="logout" className="size-4" /> Sign out
          </button>
        </div>
      </aside>
    </>
  );
}

function AppHeader({ role, setOpen }: { role: Role; setOpen: (value: boolean) => void }) {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 px-4 backdrop-blur sm:px-8">
      <button
        aria-label="Open navigation"
        className="grid size-10 place-items-center rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 lg:hidden"
        onClick={() => setOpen(true)}
      >
        <Icon name="menu" />
      </button>
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 dark:bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-800 dark:text-amber-200 ring-1 ring-inset ring-amber-200 dark:ring-amber-500/30">
        <span className="size-1.5 rounded-full bg-amber-500" />
        Live data<span className="hidden sm:inline"> · changes are saved</span>
      </span>
      <span className="hidden text-sm font-semibold text-slate-700 dark:text-slate-200 sm:block">
        {role === "student" ? "JSPM RSCOE" : role === "admin" ? "Admin portal" : "Maintenance team"}
      </span>
    </header>
  );
}

function PageTitle({ eyebrow, title, copy, action }: { eyebrow?: string; title: string; copy: string; action?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && <p className="mb-1 text-sm font-semibold text-blue-600 dark:text-blue-400">{eyebrow}</p>}
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50 sm:text-3xl">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400 sm:text-base">{copy}</p>
      </div>
      {action}
    </div>
  );
}

function StatCard({ label, value, note, icon, color }: { label: string; value: number; note: string; icon: string; color: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm shadow-slate-200/40 dark:shadow-none">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{label}</p>
          <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50">{value}</p>
        </div>
        <span className={`grid size-11 place-items-center rounded-xl ${color}`}>
          <Icon name={icon} />
        </span>
      </div>
      <p className="mt-3 text-xs font-medium text-slate-500 dark:text-slate-400">{note}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Lists                                                               */
/* ------------------------------------------------------------------ */

function ComplaintRow({ item, onClick, showPriority = false }: { item: Complaint; onClick: () => void; showPriority?: boolean }) {
  return (
    <button
      className="group grid w-full gap-3 border-b border-slate-100 dark:border-slate-800 px-5 py-4 text-left transition last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
      onClick={onClick}
    >
      <div className="flex min-w-0 items-start gap-3.5">
        <span className="mt-0.5 hidden size-10 shrink-0 place-items-center rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 sm:grid">
          <Icon name={item.category === "Plumbing" || item.category === "Electrical" ? "wrench" : "clipboard"} className="size-5" />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-semibold text-slate-900 dark:text-slate-50 group-hover:text-blue-700 dark:group-hover:text-blue-300">{item.title}</p>
            {showPriority && <PriorityBadge priority={item.priority} />}
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {item.id} · {item.location}
          </p>
        </div>
      </div>
      <div className="flex items-center justify-between gap-4 pl-0 sm:justify-end">
        <div className="text-right">
          <ComplaintStatus item={item} />
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">Updated {timeAgo(lastEvent(item).at)}</p>
        </div>
        <Icon name="arrow" className="size-4 text-slate-300 dark:text-slate-600 group-hover:text-blue-600 dark:group-hover:text-blue-400" />
      </div>
    </button>
  );
}

function ComplaintTable({ items, onOpen }: { items: Complaint[]; onOpen: (id: string) => void }) {
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-950 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <th className="px-5 py-3 font-semibold">ID</th>
              <th className="px-3 py-3 font-semibold">Category</th>
              <th className="px-3 py-3 font-semibold">Location</th>
              <th className="px-3 py-3 font-semibold">Submitted</th>
              <th className="px-3 py-3 font-semibold">Status</th>
              <th className="w-10 px-3 py-3" />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                className="group cursor-pointer border-t border-slate-100 dark:border-slate-800 transition hover:bg-slate-50 dark:hover:bg-slate-800 focus-visible:bg-blue-50 dark:focus-visible:bg-blue-500/10 focus-visible:outline-none"
                key={item.id}
                onClick={() => onOpen(item.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") onOpen(item.id);
                }}
                tabIndex={0}
              >
                <td className="px-5 py-4">
                  <p className="font-bold text-blue-700 dark:text-blue-300">{item.id}</p>
                  <p className="mt-0.5 max-w-[220px] truncate text-xs text-slate-500 dark:text-slate-400">{item.title}</p>
                </td>
                <td className="px-3 py-4 font-medium text-slate-700 dark:text-slate-200">{item.category}</td>
                <td className="px-3 py-4 text-slate-600 dark:text-slate-300">{item.location}</td>
                <td className="whitespace-nowrap px-3 py-4 text-slate-600 dark:text-slate-300">{fmtDate(item.submittedAt)}</td>
                <td className="px-3 py-4">
                  <ComplaintStatus item={item} />
                </td>
                <td className="px-3 py-4">
                  <Icon name="arrow" className="size-4 text-slate-300 dark:text-slate-600 group-hover:text-blue-600 dark:group-hover:text-blue-400" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="md:hidden">
        {items.map((item) => (
          <ComplaintRow item={item} key={item.id} onClick={() => onOpen(item.id)} />
        ))}
      </div>
    </>
  );
}

function EmptyState({ title, copy }: { title: string; copy: string }) {
  return (
    <div className="p-12 text-center">
      <p className="font-semibold text-slate-700 dark:text-slate-200">{title}</p>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{copy}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Student                                                             */
/* ------------------------------------------------------------------ */

function StudentDashboard({
  items,
  user,
  navigate,
  onOpen,
}: {
  items: Complaint[];
  user: string;
  navigate: (view: View) => void;
  onOpen: (id: string) => void;
}) {
  const pending = items.filter((i) => ["Submitted", "Under Review", "Assigned"].includes(i.status)).length;
  const inProgress = items.filter((i) => i.status === "In Progress").length;
  const toConfirm = items.filter((i) => i.status === "Resolved").length;
  const first = firstName(user);
  return (
    <>
      <PageTitle
        action={
          <Button className="px-5 py-3 text-base shadow-md shadow-blue-200 dark:shadow-none" onClick={() => navigate("report")}>
            <Icon name="plus" className="size-5" /> Report an Issue
          </Button>
        }
        copy="Here’s what’s happening with your campus requests."
        eyebrow={todayLabel()}
        title={`${greeting()}, ${first}`}
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard color="bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400" icon="clipboard" label="My complaints" note="All reports you have submitted" value={items.length} />
        <StatCard color="bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400" icon="clock" label="Pending" note="Submitted, under review or assigned" value={pending} />
        <StatCard color="bg-violet-50 dark:bg-violet-500/10 text-violet-600 dark:text-violet-400" icon="wrench" label="In progress" note="Being worked on by maintenance" value={inProgress} />
        <StatCard color="bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" icon="check" label="Needs your confirmation" note="Resolved — please confirm or reopen" value={toConfirm} />
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(280px,.75fr)]">
        <section className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm shadow-slate-200/40 dark:shadow-none">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 px-5 py-4">
            <div>
              <h2 className="font-bold text-slate-900 dark:text-slate-50">Recent complaints</h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Select a row to track its progress</p>
            </div>
            <Button onClick={() => navigate("complaints")} variant="ghost">
              View all
            </Button>
          </div>
          {items.length ? (
            <ComplaintTable items={items.slice(0, 5)} onOpen={onOpen} />
          ) : (
            <EmptyState copy="Use “Report an Issue” to submit your first complaint." title="No complaints yet" />
          )}
        </section>
        <aside className="space-y-6">
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
            <p className="font-bold text-slate-900 dark:text-slate-50">Need urgent help?</p>
            <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
              For emergencies or immediate safety threats, contact campus security directly — don’t wait for an online report.
            </p>
          </div>
          <p className="px-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
            CampusCare is a Design Thinking prototype. Complaints are saved in the project database; all people and data are fictional.
          </p>
        </aside>
      </div>
    </>
  );
}

type NewComplaint = { category: string; building: string; floor: string; room: string; description: string; file: File | null; previewUrl?: string };

function ReportForm({ onSubmit }: { onSubmit: (data: NewComplaint) => void }) {
  const [category, setCategory] = useState("");
  const [building, setBuilding] = useState("");
  const [floor, setFloor] = useState("");
  const [room, setRoom] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dragging, setDragging] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | undefined>();
  const inputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<string | undefined>(undefined);
  const submittedRef = useRef(false);

  const setPreview = (url?: string) => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = url;
    setPreviewUrl(url);
  };
  // Free the preview if the form is left without submitting
  useEffect(
    () => () => {
      if (!submittedRef.current && previewRef.current) URL.revokeObjectURL(previewRef.current);
    },
    [],
  );

  const chooseFile = (selected?: File) => {
    if (!selected) return;
    const problem = validateFile(selected);
    if (problem) {
      setFile(null);
      setPreview(undefined);
      setFileError(problem);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setFileError("");
    setFile(selected);
    setPreview(previewFor(selected));
  };

  const clearFile = () => {
    setFile(null);
    setPreview(undefined);
    setFileError("");
    if (inputRef.current) inputRef.current.value = "";
  };

  /** Updates a field and removes its error message as soon as the user changes it (checked again on submit). */
  const edit = (key: string, set: (value: string) => void, value: string) => {
    set(value);
    if (errors[key]) setErrors(({ [key]: _removed, ...rest }) => rest);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!category) next.category = "Please select a category.";
    if (!building) next.building = "Please select a building.";
    if (!floor) next.floor = "Please select a floor.";
    if (!room.trim()) next.room = "Please enter a room number.";
    if (description.trim().length < 10) next.description = "Please describe the issue in at least 10 characters.";
    setErrors(next);
    if (Object.keys(next).length) return;
    // The file is optional: a refused file was never attached, so it does not block submitting.
    if (fileError) setFileError("");
    submittedRef.current = true; // the new complaint now owns the preview
    onSubmit({ category, building, floor, room: room.trim(), description: description.trim(), file, previewUrl });
  };

  const invalid = (key: string) => (errors[key] ? "border-red-300 dark:border-red-500/50 focus:border-red-500 focus:ring-red-50 dark:focus:ring-red-500/30" : "");

  return (
    <>
      <PageTitle copy="Share the details below so the right campus team can respond." eyebrow="New complaint" title="Report a campus issue" />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <form className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm sm:p-7" noValidate onSubmit={submit}>
          <div className="mb-6 flex items-center gap-3 border-b border-slate-100 dark:border-slate-800 pb-5">
            <span className="grid size-9 place-items-center rounded-full bg-blue-600 text-sm font-bold text-white">1</span>
            <div>
              <h2 className="font-bold text-slate-900 dark:text-slate-50">Issue details</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">Category, building, floor, room number and description are required.</p>
            </div>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <Field label="Category">
                <select className={`${fieldClass} ${invalid("category")}`} onChange={(event) => edit("category", setCategory, event.target.value)} value={category}>
                  <option disabled value="">
                    Select a category
                  </option>
                  {categories.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </Field>
              <FieldError message={errors.category} />
            </div>
            <div>
              <Field label="Building">
                <select className={`${fieldClass} ${invalid("building")}`} onChange={(event) => edit("building", setBuilding, event.target.value)} value={building}>
                  <option disabled value="">
                    Select a building
                  </option>
                  {buildings.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </Field>
              <FieldError message={errors.building} />
            </div>
            <div>
              <Field label="Floor">
                <select className={`${fieldClass} ${invalid("floor")}`} onChange={(event) => edit("floor", setFloor, event.target.value)} value={floor}>
                  <option disabled value="">
                    Select a floor
                  </option>
                  {floors.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </Field>
              <FieldError message={errors.floor} />
            </div>
            <div>
              <Field label="Room number">
                <input
                  className={`${fieldClass} ${invalid("room")}`}
                  onChange={(event) => edit("room", setRoom, event.target.value)}
                  placeholder="Enter room number (e.g., 204)"
                  value={room}
                />
              </Field>
              <FieldError message={errors.room} />
            </div>
          </div>
          <div className="mt-5">
            <Field
              hint="Example: “The ceiling fan in Room 204 makes a loud noise and stops every few minutes since Monday.” Please don’t include sensitive personal information."
              label="Describe the issue"
            >
              <textarea
                className={`${fieldClass} min-h-36 resize-y ${invalid("description")}`}
                onChange={(event) => edit("description", setDescription, event.target.value)}
                placeholder="What happened? When did you first notice it? Include anything that could help the team respond."
                value={description}
              />
            </Field>
            <FieldError message={errors.description} />
          </div>
          <div className="mt-5">
            <span className="mb-2 block text-sm font-semibold text-slate-700 dark:text-slate-200">Add supporting evidence (optional)</span>
            {file ? (
              <div className="flex items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3">
                <EvidenceThumb evidence={{ name: file.name, size: formatSize(file.size), previewUrl }} size="size-16" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{file.name}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{formatSize(file.size)} · Ready to upload{file.type.startsWith("image/") ? " (will be shrunk automatically)" : ""}</p>
                </div>
                <Button onClick={clearFile} variant="ghost">
                  Remove
                </Button>
              </div>
            ) : (
              <label
                className={`flex cursor-pointer flex-col items-center rounded-2xl border-2 border-dashed px-5 py-7 text-center transition focus-within:ring-4 focus-within:ring-blue-100 dark:focus-within:ring-blue-500/30 ${
                  fileError
                    ? "border-red-300 dark:border-red-500/50 bg-red-50/50 dark:bg-red-500/10"
                    : dragging
                      ? "border-blue-400 bg-blue-50 dark:bg-blue-500/10"
                      : "border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 hover:border-blue-300 dark:hover:border-blue-500/40 hover:bg-blue-50/40 dark:hover:bg-blue-500/10"
                }`}
                onDragLeave={() => setDragging(false)}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  chooseFile(event.dataTransfer.files?.[0]);
                }}
              >
                <input
                  accept=".jpg,.jpeg,.png,.pdf"
                  className="sr-only"
                  onChange={(event) => chooseFile(event.target.files?.[0])}
                  ref={inputRef}
                  type="file"
                />
                <span className="grid size-11 place-items-center rounded-xl bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-sm">
                  <Icon name="upload" />
                </span>
                <span className="mt-3 text-sm font-semibold text-slate-700 dark:text-slate-200">Choose a file or drag it here</span>
                <span className="mt-1 text-xs text-slate-500 dark:text-slate-400">{FILE_HINT}</span>
              </label>
            )}
            <FieldError message={fileError} />
          </div>
          <div className="mt-7 flex flex-col-reverse gap-3 border-t border-slate-100 dark:border-slate-800 pt-6 sm:flex-row sm:items-center sm:justify-end">
            <Button type="submit">
              Submit complaint <Icon name="arrow" className="size-4" />
            </Button>
          </div>
        </form>
        <aside className="space-y-4">
          <div className="rounded-2xl border border-blue-100 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-500/10 p-5">
            <h3 className="font-bold text-slate-900 dark:text-slate-50">What happens next?</h3>
            <ol className="mt-4 space-y-4">
              {[
                ["Review", "Campus Services checks your report and sets its priority."],
                ["Assignment", "A maintenance staff member from the right team takes it on."],
                ["Resolution", "When the work is done, you confirm the fix or reopen it."],
              ].map(([title, copy], index) => (
                <li className="flex gap-3" key={title}>
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-blue-600 text-xs font-bold text-white">{index + 1}</span>
                  <div>
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</p>
                    <p className="mt-0.5 text-xs leading-5 text-slate-500 dark:text-slate-400">{copy}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <p className="px-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
            Prototype notice: reports and attached files are saved in the CampusCare demo database and are not sent to a real campus team.
          </p>
        </aside>
      </div>
    </>
  );
}

function Confirmation({ item, navigate, onOpen }: { item: Complaint; navigate: (view: View) => void; onOpen: (id: string) => void }) {
  return (
    <div className="mx-auto flex min-h-[calc(100vh-10rem)] max-w-2xl items-center justify-center">
      <div className="w-full rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-7 text-center shadow-xl shadow-slate-200/50 dark:shadow-none sm:p-12">
        <span className="mx-auto grid size-20 place-items-center rounded-full bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-8 ring-emerald-50/50 dark:ring-emerald-500/10">
          <Icon name="check" className="size-10" />
        </span>
        <p className="mt-7 text-sm font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400">Report submitted</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50">Thanks for letting us know</h1>
        <p className="mx-auto mt-3 max-w-md leading-7 text-slate-500 dark:text-slate-400">
          Your complaint is waiting for review by Campus Services. Updates will appear in your dashboard as it moves forward.
        </p>
        <div className="mx-auto mt-7 max-w-sm rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">Complaint ID</p>
          <p className="mb-3 mt-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">{item.id}</p>
          <ComplaintStatus item={item} />
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            {item.category} · {item.location}
          </p>
        </div>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Button onClick={() => onOpen(item.id)}>Track complaint</Button>
          <Button onClick={() => navigate("dashboard")} variant="secondary">
            Return to overview
          </Button>
        </div>
        <p className="mt-6 text-xs text-slate-400 dark:text-slate-500">Saved in the CampusCare demo database. All people and data in this demo are fictional.</p>
      </div>
    </div>
  );
}

function ComplaintsList({
  role,
  items,
  navigate,
  onOpen,
}: {
  role: Role;
  items: Complaint[];
  navigate: (view: View) => void;
  onOpen: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All");
  const filtered = useMemo(
    () =>
      items.filter(
        (item) =>
          (filter === "All" || item.status === filter) &&
          `${item.title} ${item.id} ${item.location} ${item.category} ${item.requester.name}`.toLowerCase().includes(search.toLowerCase()),
      ),
    [items, filter, search],
  );
  return (
    <>
      <PageTitle
        action={
          role === "student" ? (
            <Button onClick={() => navigate("report")}>
              <Icon name="plus" className="size-4" /> New complaint
            </Button>
          ) : undefined
        }
        copy={role === "admin" ? "Review, prioritize and route every campus request." : "Search your reports and follow progress from submission to closure."}
        eyebrow={role === "admin" ? "Service operations" : "Your reports"}
        title={role === "admin" ? "All complaints" : "My complaints"}
      />
      <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 dark:border-slate-800 p-4 sm:flex-row">
          <div className="relative flex-1">
            <Icon name="search" className="absolute left-3.5 top-3 size-4 text-slate-400 dark:text-slate-500" />
            <input
              aria-label="Search complaints"
              className={`${fieldClass} py-2.5 pl-10`}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={role === "admin" ? "Search by ID, issue, category, location or requester" : "Search by ID, issue, category or location"}
              value={search}
            />
          </div>
          <select aria-label="Filter by status" className={`${fieldClass} py-2.5 sm:w-44`} onChange={(event) => setFilter(event.target.value)} value={filter}>
            {["All", ...workflow].map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-950 px-5 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400">
          <span>
            {filtered.length} complaint{filtered.length === 1 ? "" : "s"}
          </span>
          <span>Newest first</span>
        </div>
        {filtered.length ? (
          role === "student" ? (
            <ComplaintTable items={filtered} onOpen={onOpen} />
          ) : (
            filtered.map((item) => <ComplaintRow item={item} key={item.id} onClick={() => onOpen(item.id)} showPriority />)
          )
        ) : (
          <EmptyState copy="Try a different keyword or status." title="No complaints match your search" />
        )}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Detail                                                              */
/* ------------------------------------------------------------------ */

function WorkflowStepper({ item }: { item: Complaint }) {
  if (isRejected(item)) {
    const e = item.history.find((h) => h.kind === "rejected");
    return (
      <div className="rounded-xl border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 p-4">
        <p className="text-sm font-bold text-rose-800 dark:text-rose-200">Closed — not actionable</p>
        <p className="mt-1 text-sm text-rose-700 dark:text-rose-300">
          Rejected by {e?.by} on {e ? fmtDate(e.at) : ""}. Reason: “{e?.reason}”
        </p>
        <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">This complaint did not go to maintenance and is read-only.</p>
      </div>
    );
  }
  const active = workflow.indexOf(item.status);
  const reopened = reopenCount(item);
  return (
    <>
      {reopened > 0 && (
        <span className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-orange-50 dark:bg-orange-500/10 px-2.5 py-1 text-xs font-semibold text-orange-700 dark:text-orange-300 ring-1 ring-inset ring-orange-200 dark:ring-orange-500/30">
          <Icon name="refresh" className="size-3.5" /> Reopened {reopened === 1 ? "once" : `${reopened} times`}
        </span>
      )}
      <div className="overflow-x-auto pb-2">
        <div className="flex min-w-[620px] items-start">
          {workflow.map((step, index) => (
            <div className="flex flex-1 items-start" key={step}>
              <div className="relative flex w-full flex-col items-center text-center">
                {index < workflow.length - 1 && (
                  <span className={`absolute left-1/2 top-4 h-0.5 w-full ${index < active ? "bg-blue-600" : "bg-slate-200 dark:bg-slate-700"}`} />
                )}
                <span
                  className={`relative z-10 grid size-8 place-items-center rounded-full text-xs font-bold ${
                    index <= active ? "bg-blue-600 text-white" : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
                  }`}
                >
                  {index < active || (index === active && step === "Closed") ? <Icon name="check" className="size-4" /> : index + 1}
                </span>
                <span className={`mt-2 text-xs font-semibold ${index <= active ? "text-slate-800 dark:text-slate-100" : "text-slate-500 dark:text-slate-400"}`}>{step}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

type ExtraEvent = { kind: Action; title: string; note?: string };
type ActFn = (
  id: string,
  action: Action,
  payload?: { note?: string; reason?: string; evidence?: Evidence; patch?: Partial<Complaint>; title?: string; extra?: ExtraEvent[] },
) => Promise<boolean>;

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
      <h2 className="font-bold text-slate-900 dark:text-slate-50">{title}</h2>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

function ReadOnlyNote({ children }: { children: ReactNode }) {
  return <p className="rounded-xl bg-slate-50 dark:bg-slate-950 p-3 text-sm leading-6 text-slate-600 dark:text-slate-300">{children}</p>;
}

/** Optional visit booking: day, length, number of days, then a free start time for the chosen staff member. */
function VisitPicker({
  staff,
  busy,
  value,
  onChange,
}: {
  staff: string;
  busy: Visit[];
  value: Visit | null;
  onChange: (v: Visit | null) => void;
}) {
  const now = Date.now();
  const [day, setDay] = useState(() => toInputDate(value?.start ?? dayAt(new Date(), 1, 0)));
  const [hours, setHours] = useState(() => (value ? Math.round((value.end - value.start) / HOUR) : 1));
  const [days, setDays] = useState(() => value?.days ?? 1);
  const [y, m, d] = day.split("-").map(Number);
  const base = new Date(y, (m || 1) - 1, d || 1);
  const slots: Array<Visit & { taken: boolean }> = [];
  for (let h = WORK_START_HOUR; h + hours <= WORK_END_HOUR; h++) {
    const start = dayAt(base, 0, h);
    if (start <= now) continue;
    const slot: Visit = { start, end: start + hours * HOUR, days };
    slots.push({ ...slot, taken: busy.some((b) => overlaps(b, slot)) });
  }
  const reset = () => onChange(null);
  return (
    <div className="space-y-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3">
      <Field hint={`Optional. Hours ${WORK_START_HOUR}:00–${WORK_END_HOUR}:00 are a placeholder for the prototype.`} label={days > 1 ? "First visit day" : "Visit day"}>
        <input
          className={fieldClass}
          max={toInputDate(dayAt(new Date(), 14, 0))}
          min={toInputDate(now)}
          onChange={(event) => {
            if (event.target.value) {
              setDay(event.target.value);
              reset();
            }
          }}
          type="date"
          value={day}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Visit length">
          <select
            className={fieldClass}
            onChange={(event) => {
              setHours(Number(event.target.value));
              reset();
            }}
            value={hours}
          >
            <option value={1}>1 hour</option>
            <option value={2}>2 hours</option>
            <option value={3}>3 hours</option>
            <option value={4}>4 hours (half day)</option>
          </select>
        </Field>
        <Field label="Number of days">
          <select
            className={fieldClass}
            onChange={(event) => {
              setDays(Number(event.target.value));
              reset();
            }}
            value={days}
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n === 1 ? "1 day" : `${n} days`}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
        Start time{days > 1 ? " (same time each day)" : ""} for {staff}
      </p>
      {slots.length ? (
        <div aria-label="Visit start time" className="flex flex-wrap gap-2" role="group">
          {slots.map((slot) => {
            const selected = value?.start === slot.start && (value.days ?? 1) === days && value.end === slot.end;
            const range = `${fmtTime(slot.start)}–${fmtTime(slot.end)}`;
            return (
              <button
                aria-label={`${fmtTime(slot.start)} to ${fmtTime(slot.end)}, ${slot.taken ? "booked" : "free"}`}
                aria-pressed={selected}
                className={`rounded-lg border px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed ${
                  selected
                    ? "border-blue-600 bg-blue-600 text-white"
                    : slot.taken
                      ? "border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 line-through"
                      : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:border-blue-400"
                }`}
                disabled={slot.taken}
                key={slot.start}
                onClick={() => onChange(selected ? null : { start: slot.start, end: slot.end, days })}
                type="button"
              >
                {range}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-slate-500 dark:text-slate-400">No start times left on this day for a {hours}-hour visit. Choose another day or a shorter visit.</p>
      )}
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {value ? (
          <>
            Selected: <span className="font-semibold text-slate-700 dark:text-slate-200">{fmtSlot(value)}</span> ·{" "}
            <button className="font-semibold text-blue-700 dark:text-blue-300 underline" onClick={reset} type="button">
              clear
            </button>
          </>
        ) : days > 1 ? (
          "Crossed-out times clash with another visit on at least one of the selected days."
        ) : (
          "Crossed-out times clash with another visit for this staff member."
        )}
      </p>
    </div>
  );
}

function AssignFields({
  team,
  setTeam,
  staff,
  setStaff,
}: {
  team: string;
  setTeam: (v: string) => void;
  staff: string;
  setStaff: (v: string) => void;
}) {
  const members = useContext(StaffContext)
    .filter((s) => s.team === team)
    .map((s) => ({ name: s.full_name }));
  return (
    <>
      <Field label="Team">
        <select
          className={fieldClass}
          onChange={(event) => {
            setTeam(event.target.value);
            setStaff("");
          }}
          value={team}
        >
          {teams.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </Field>
      <Field label="Staff member">
        <select className={fieldClass} onChange={(event) => setStaff(event.target.value)} value={staff}>
          <option disabled value="">
            Select staff member
          </option>
          {members.map((m) => (
            <option key={m.name}>{m.name}</option>
          ))}
        </select>
      </Field>
    </>
  );
}

function AdminActions({ item, items, act }: { item: Complaint; items: Complaint[]; act: ActFn }) {
  const [visit, setVisit] = useState<Visit | null>(null);
  const [visitMode, setVisitMode] = useState<"" | "edit" | "cancel">("");
  const [priority, setPriority] = useState<Priority | "">(item.priority === "Not set" ? "" : item.priority);
  const [team, setTeam] = useState(item.team ?? categoryTeam[item.category] ?? "General Maintenance");
  const [staff, setStaff] = useState(item.assignee ?? "");
  const [mode, setMode] = useState<"" | "reject" | "close" | "reopen">("");
  const [error, setError] = useState("");

  const rejectBlock = (
    <>
      {mode === "reject" ? (
        <ReasonForm
          confirmLabel="Reject complaint"
          label="Reason for rejection"
          onCancel={() => setMode("")}
          onConfirm={(reason) => act(item.id, "rejected", { reason })}
          placeholder="e.g. Duplicate of CC-2026-0102, or not a facilities issue…"
          variant="danger"
        />
      ) : (
        <Button className="w-full" onClick={() => setMode("reject")} variant="danger">
          <Icon name="x" className="size-4" /> Reject (not actionable)
        </Button>
      )}
    </>
  );

  if (item.status === "Submitted") {
    return (
      <Panel title="Review">
        <Field hint="Required before review can start." label="Priority">
          <select className={fieldClass} onChange={(event) => setPriority(event.target.value as Priority)} value={priority}>
            <option disabled value="">
              Select priority
            </option>
            {priorities.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </Field>
        <FieldError message={error} />
        <Button
          className="w-full"
          onClick={() => {
            if (!priority) {
              setError("Please select a priority.");
              return;
            }
            act(item.id, "reviewStarted", { note: `Priority set to ${priority}.`, patch: { priority } });
          }}
        >
          Start review
        </Button>
        {rejectBlock}
      </Panel>
    );
  }

  if (item.status === "Under Review") {
    return (
      <Panel title="Assign">
        <p className="text-xs text-slate-500 dark:text-slate-400">Default team suggested from the category ({item.category}).</p>
        <AssignFields
          setStaff={(v) => {
            setStaff(v);
            setVisit(null);
          }}
          setTeam={setTeam}
          staff={staff}
          team={team}
        />
        {staff && <VisitPicker busy={busyFor(staff, items, item.id)} key={staff} onChange={setVisit} staff={staff} value={visit} />}
        <Button
          className="w-full"
          disabled={!staff}
          onClick={() =>
            act(item.id, "assigned", {
              note: `Team: ${team}.`,
              patch: { team, assignee: staff, visit: visit ?? undefined },
              extra: visit ? [{ kind: "visitScheduled", title: `Visit scheduled: ${fmtSlot(visit)}`, note: `${staff} at ${item.location}.` }] : [],
            })
          }
        >
          {visit ? "Assign and book visit" : "Assign complaint"}
        </Button>
        {rejectBlock}
      </Panel>
    );
  }

  if (item.status === "Assigned" || item.status === "In Progress") {
    const current = item.visit;
    const reassigning = !!staff && staff !== item.assignee;
    return (
      <>
      <Panel title="Maintenance visit">
        {current && visitMode === "" && (
          <>
            <ReadOnlyNote>
              Booked for <span className="font-semibold text-slate-800 dark:text-slate-100">{fmtSlot(current)}</span> with {item.assignee}.
            </ReadOnlyNote>
            <div className="grid grid-cols-2 gap-2">
              <Button onClick={() => setVisitMode("edit")} variant="secondary">
                Change time
              </Button>
              <Button onClick={() => setVisitMode("cancel")} variant="danger">
                Cancel visit
              </Button>
            </div>
          </>
        )}
        {current && visitMode === "cancel" && (
          <ReasonForm
            confirmLabel="Cancel visit"
            label="Reason for cancelling"
            onCancel={() => setVisitMode("")}
            onConfirm={(reason) => act(item.id, "visitCancelled", { title: `Visit cancelled: ${fmtSlot(current)}`, reason, patch: { visit: undefined } })}
            placeholder="e.g. Room is locked for exams that day."
            variant="danger"
          />
        )}
        {(!current || visitMode === "edit") && (
          <>
            {!current && <p className="text-xs text-slate-500 dark:text-slate-400">No visit booked yet for {item.assignee}.</p>}
            <VisitPicker busy={busyFor(item.assignee ?? "", items, item.id)} onChange={setVisit} staff={item.assignee ?? ""} value={visit} />
            <div className="flex gap-2">
              <Button
                className="flex-1"
                disabled={!visit}
                onClick={() =>
                  visit &&
                  act(item.id, "visitScheduled", {
                    title: `Visit ${current ? "rescheduled" : "scheduled"}: ${fmtSlot(visit)}`,
                    note: current ? `Previously ${fmtSlot(current)}.` : `${item.assignee} at ${item.location}.`,
                    patch: { visit },
                  })
                }
              >
                {current ? "Save new time" : "Book visit"}
              </Button>
              {current && (
                <Button onClick={() => setVisitMode("")} variant="secondary">
                  Back
                </Button>
              )}
            </div>
          </>
        )}
      </Panel>
      <Panel title="Reassign">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Currently with <span className="font-semibold text-slate-700 dark:text-slate-200">{item.assignee}</span> ({item.team}). Reassigning keeps the status as{" "}
          {item.status}.
        </p>
        <AssignFields setStaff={setStaff} setTeam={setTeam} staff={staff} team={team} />
        {reassigning && current && (
          <p className="text-xs font-medium text-orange-700 dark:text-orange-300">Reassigning cancels the visit booked for {fmtSlot(current)}.</p>
        )}
        <Button
          className="w-full"
          disabled={!reassigning}
          onClick={() => {
            const extra: ExtraEvent[] = current
              ? [{ kind: "visitCancelled", title: `Visit cancelled: ${fmtSlot(current)}`, note: `Cancelled because the complaint moved to ${staff}.` }]
              : [];
            act(item.id, "reassigned", {
              note: `From ${item.assignee} to ${staff} (${team}).`,
              patch: { team, assignee: staff, visit: undefined },
              extra,
            });
          }}
          variant="secondary"
        >
          Reassign
        </Button>
        {reassigning && <p className="text-xs text-slate-500 dark:text-slate-400">You can book a visit for {staff} after reassigning.</p>}
      </Panel>
      </>
    );
  }

  if (item.status === "Resolved") {
    const res = latestResolution(item);
    const waitedDays = res ? Math.floor((Date.now() - res.at) / DAY) : 0;
    const eligible = waitedDays >= NO_RESPONSE_DAYS;
    return (
      <Panel title="Verify resolution">
        <ReadOnlyNote>
          Waiting for {item.requester.name} to confirm since {res ? timeAgo(res.at) : "—"}.{" "}
          {eligible
            ? `No response for ${waitedDays} days, so this is eligible for admin closure.`
            : `Admin closure is normally used after ${NO_RESPONSE_DAYS} days without a response.`}
          <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">Proposed {NO_RESPONSE_DAYS}-day policy for this prototype — not an existing college rule.</span>
        </ReadOnlyNote>
        {mode === "close" ? (
          <ReasonForm
            confirmLabel="Verify & close"
            label="Reason for closing"
            onCancel={() => setMode("")}
            onConfirm={(reason) => act(item.id, "adminClosed", { reason })}
            placeholder="e.g. Checked on site; requester has not responded in 3 days."
          />
        ) : mode === "reopen" ? (
          <ReasonForm
            confirmLabel="Reopen complaint"
            label="Reason for reopening"
            onCancel={() => setMode("")}
            onConfirm={(reason) => act(item.id, "reopened", { reason })}
            placeholder="e.g. Resolution note does not match the reported problem."
            variant="danger"
          />
        ) : (
          <div className="grid gap-2">
            <Button className="w-full" onClick={() => setMode("close")}>
              <Icon name="check" className="size-4" /> Verify & close
            </Button>
            <Button className="w-full" onClick={() => setMode("reopen")} variant="danger">
              Reopen
            </Button>
          </div>
        )}
      </Panel>
    );
  }

  return (
    <Panel title="No actions available">
      <ReadOnlyNote>Closed complaints are read-only. The full history is kept in the timeline.</ReadOnlyNote>
    </Panel>
  );
}

function MaintenanceActions({ item, user, act }: { item: Complaint; user: string; act: ActFn }) {
  const [note, setNote] = useState("");
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [error, setError] = useState("");

  if (item.assignee !== user) {
    return (
      <Panel title="Work status">
        <ReadOnlyNote>This complaint is assigned to {item.assignee ?? "nobody yet"}. Only the assigned staff member can update it.</ReadOnlyNote>
      </Panel>
    );
  }
  if (item.status === "Assigned") {
    return (
      <Panel title="Your next step">
        <ReadOnlyNote>Go to {item.location} and start work when you are on site.</ReadOnlyNote>
        <Button className="w-full" onClick={() => act(item.id, "workStarted", { note: "Work started on site." })}>
          <Icon name="wrench" className="size-4" /> Start work
        </Button>
      </Panel>
    );
  }
  if (item.status === "In Progress") {
    return (
      <Panel title="Submit resolution">
        <Field hint={`Required, at least ${MIN_REASON} characters.`} label="Resolution note">
          <textarea
            className={`${fieldClass} min-h-28 ${error ? "border-red-300 dark:border-red-500/50" : ""}`}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Describe the work completed…"
            value={note}
          />
        </Field>
        <FieldError message={error} />
        <div>
          <span className="mb-2 block text-sm font-semibold text-slate-700 dark:text-slate-200">Evidence</span>
          <EvidencePicker onChange={setEvidence} value={evidence} />
        </div>
        <Button
          className="w-full"
          onClick={() => {
            if (note.trim().length < MIN_REASON) {
              setError(`Please describe the work in at least ${MIN_REASON} characters.`);
              return;
            }
            act(item.id, "resolutionSubmitted", { note: note.trim(), evidence: evidence ?? undefined });
          }}
        >
          <Icon name="check" className="size-4" /> Submit resolution
        </Button>
        <p className="text-xs text-slate-500 dark:text-slate-400">The requester or an administrator verifies the fix. Maintenance cannot close a complaint.</p>
      </Panel>
    );
  }
  if (item.status === "Resolved") {
    return (
      <Panel title="Waiting for verification">
        <ReadOnlyNote>Your resolution has been submitted. The requester or an administrator will confirm it or reopen the complaint.</ReadOnlyNote>
      </Panel>
    );
  }
  return (
    <Panel title="No actions available">
      <ReadOnlyNote>This complaint is {item.status.toLowerCase()}.</ReadOnlyNote>
    </Panel>
  );
}

/** Who acts next, in plain words. "Your move" when the viewer is the one who must act. */
function nextStep(item: Complaint, role: Role, user: string): { yours: boolean; text: string } {
  const mine =
    (role === "admin" && ["Submitted", "Under Review", "Resolved"].includes(item.status)) ||
    (role === "maintenance" && item.assignee === user && ["Assigned", "In Progress"].includes(item.status)) ||
    (role === "student" && item.requester.name === user && item.status === "Resolved");
  if (isRejected(item)) return { yours: false, text: "Closed as not actionable. No further action is needed." };
  switch (item.status) {
    case "Submitted":
      return { yours: mine, text: mine ? "Set a priority and start the review, or reject it with a reason." : "Campus Services (admin) reviews the report and sets its priority." };
    case "Under Review":
      return { yours: mine, text: mine ? "Choose a team and staff member and assign it." : "Campus Services (admin) assigns it to a maintenance staff member." };
    case "Assigned":
      return { yours: mine, text: mine ? "Go to the location and press Start work." : `${item.assignee} (${item.team}) starts work on site.` };
    case "In Progress":
      return { yours: mine, text: mine ? "When the work is done, submit a resolution note." : `${item.assignee} is working on it and will submit a resolution note.` };
    case "Resolved":
      if (role === "student" && mine) return { yours: true, text: "Check the fix, then confirm it or reopen the complaint with a reason." };
      if (role === "admin") return { yours: true, text: `${item.requester.name} should confirm the fix. If they don't respond, you can verify and close it with a reason.` };
      return { yours: false, text: `Waiting for ${item.requester.name} to confirm the fix, or for the admin to verify it.` };
    case "Closed":
      return { yours: false, text: "Closed after the fix was confirmed. No further action is needed." };
  }
}

function NextStep({ item, role, user }: { item: Complaint; role: Role; user: string }) {
  const step = nextStep(item, role, user);
  const last = lastEvent(item);
  return (
    <div
      className={`mb-6 flex flex-col gap-2 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between ${
        step.yours
          ? "border-blue-200 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-500/10"
          : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
      }`}
    >
      <p className="text-sm text-slate-800 dark:text-slate-100">
        <span className={`mr-2 font-bold ${step.yours ? "text-blue-700 dark:text-blue-300" : "text-slate-900 dark:text-slate-50"}`}>
          {step.yours ? "Your next step:" : "Next step:"}
        </span>
        {step.text}
        {hasActiveVisit(item) && item.visit && (
          <span className="mt-1.5 flex items-center gap-1.5 font-semibold text-slate-900 dark:text-slate-50">
            <Icon className="size-4 text-blue-600 dark:text-blue-400" name="clock" /> Visit booked: {fmtSlot(item.visit)}
          </span>
        )}
      </p>
      <p className="shrink-0 text-xs text-slate-500 dark:text-slate-400">
        Last update {timeAgo(last.at)} by {last.by}
      </p>
    </div>
  );
}

function ComplaintDetail({
  role,
  user,
  item,
  items,
  navigate,
  act,
}: {
  role: Role;
  user: string;
  item: Complaint;
  items: Complaint[];
  navigate: (view: View) => void;
  act: ActFn;
}) {
  const resolution = latestResolution(item);
  const rejected = isRejected(item);
  const listView: View = role === "maintenance" ? "assignments" : "complaints";
  return (
    <>
      <button className="mb-5 flex items-center gap-2 text-sm font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white" onClick={() => navigate(listView)}>
        <Icon name="back" className="size-4" /> Back to {role === "maintenance" ? "assignments" : "complaints"}
      </button>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-bold text-blue-600 dark:text-blue-400">{item.id}</p>
            <ComplaintStatus item={item} />
            {!rejected && <PriorityBadge priority={item.priority} />}
          </div>
          <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50 sm:text-3xl">{item.title}</h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Submitted by {item.requester.name} ({item.requester.role}) on {fmtDate(item.submittedAt)}
          </p>
        </div>
        {canAct(item, "confirmed", role, user) && (
          <Button onClick={() => navigate("feedback")}>
            <Icon name="check" className="size-4" /> Review resolution
          </Button>
        )}
      </div>
      <NextStep item={item} role={role} user={user} />
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm sm:p-7">
        <h2 className="font-bold text-slate-900 dark:text-slate-50">Complaint tracking</h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Submitted → Under Review → Assigned → In Progress → Resolved → Closed</p>
        <div className="mt-6">
          <WorkflowStepper item={item} />
        </div>
      </section>
      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-7">
            <h2 className="font-bold text-slate-900 dark:text-slate-50">Issue details</h2>
            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Category</p>
                <p className="mt-1.5 text-sm font-medium text-slate-800 dark:text-slate-100">{item.category}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Location</p>
                <p className="mt-1.5 text-sm font-medium text-slate-800 dark:text-slate-100">{item.location}</p>
              </div>
            </div>
            <div className="mt-6 border-t border-slate-100 dark:border-slate-800 pt-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Description</p>
              <p className="mt-2 text-sm leading-7 text-slate-600 dark:text-slate-300">{item.description}</p>
            </div>
            {item.attachment && <StoredEvidence evidence={item.attachment} from="Evidence from requester" />}
          </section>
          {resolution && (
            <section className="rounded-2xl border border-emerald-200 dark:border-emerald-500/30 bg-white dark:bg-slate-900 p-5 sm:p-7">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-bold text-slate-900 dark:text-slate-50">Resolution submitted</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {resolution.by} · {fmtDateTime(resolution.at)}
                </p>
              </div>
              <p className="mt-3 text-sm leading-7 text-slate-700 dark:text-slate-200">{resolution.note}</p>
              {resolution.evidence ? (
                <StoredEvidence evidence={resolution.evidence} from="Evidence from maintenance" tone="emerald" />
              ) : (
                <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">No evidence file attached.</p>
              )}
            </section>
          )}
          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-7">
            <h2 className="font-bold text-slate-900 dark:text-slate-50">Status timeline</h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Newest first · every entry is an action someone took</p>
            <ol className="mt-5">
              {[...item.history].reverse().map((entry, index, all) => (
                <li className="relative flex gap-3 pb-6 last:pb-0" key={`${entry.kind}-${entry.at}-${index}`}>
                  {index < all.length - 1 && <span className="absolute bottom-0 left-3 top-6 w-px bg-slate-200 dark:bg-slate-700" />}
                  <span
                    className={`relative z-10 mt-0.5 size-6 shrink-0 rounded-full border-4 border-white dark:border-slate-900 ${
                      index === 0 ? "bg-blue-600 ring-2 ring-blue-100 dark:ring-blue-500/20" : "bg-slate-300 dark:bg-slate-600"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">{entry.title}</p>
                      <StatusBadge rejected={entry.kind === "rejected"} status={entry.status} />
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      {fmtDateTime(entry.at)} · {entry.by} ({entry.byRole})
                    </p>
                    {entry.note && <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-300">{entry.note}</p>}
                    {entry.reason && (
                      <p className="mt-1.5 rounded-lg bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm text-slate-700 dark:text-slate-200">
                        <span className="font-semibold">Reason:</span> {entry.reason}
                      </p>
                    )}
                    {entry.evidence && (
                      <p className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300">
                        <Icon name="file" className="size-3.5" /> {entry.evidence.name} ({entry.evidence.size})
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>
        <aside className="order-first space-y-5 xl:order-none">
          {role === "admin" && <AdminActions act={act} item={item} items={items} key={`${item.id}-${item.status}-${item.history.length}`} />}
          {role === "maintenance" && <MaintenanceActions act={act} item={item} key={`${item.id}-${item.status}`} user={user} />}
          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
            <h2 className="font-bold text-slate-900 dark:text-slate-50">{role === "student" ? "Assigned staff" : "Requester"}</h2>
            <div className="mt-4 flex items-center gap-3">
              <span className="grid size-11 place-items-center rounded-full bg-blue-100 dark:bg-blue-500/20 text-sm font-bold text-blue-700 dark:text-blue-300">
                {role === "student" ? (item.assignee ? initials(item.assignee) : "—") : initials(item.requester.name)}
              </span>
              <div>
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  {role === "student" ? (item.assignee ?? (rejected ? "Not assigned" : "Awaiting assignment")) : item.requester.name}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {role === "student"
                    ? item.assignee
                      ? `${item.team} team`
                      : rejected
                        ? "Closed before assignment"
                        : "A staff member will be assigned after review"
                    : item.requester.role}
                </p>
              </div>
            </div>
            {role === "admin" && item.assignee && (
              <p className="mt-4 border-t border-slate-100 dark:border-slate-800 pt-4 text-xs text-slate-500 dark:text-slate-400">
                Assigned to <span className="font-semibold text-slate-700 dark:text-slate-200">{item.assignee}</span> · {item.team}
              </p>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Admin & maintenance dashboards                                      */
/* ------------------------------------------------------------------ */

const priorityRank: Record<Priority, number> = { Urgent: 0, High: 1, Medium: 2, Low: 3, "Not set": 4 };

function AdminDashboard({ items, user, onOpen, navigate }: { items: Complaint[]; user: string; onOpen: (id: string) => void; navigate: (view: View) => void }) {
  const count = (statuses: Status[]) => items.filter((i) => statuses.includes(i.status));
  const submitted = count(["Submitted"]);
  const review = count(["Under Review"]);
  const withMaintenance = count(["Assigned", "In Progress"]);
  const resolved = count(["Resolved"]);
  const highOf = (list: Complaint[]) => list.filter((i) => i.priority === "Urgent" || i.priority === "High").length;
  const overdueVerification = resolved.filter((i) => {
    const r = latestResolution(i);
    return r && Date.now() - r.at >= NO_RESPONSE_DAYS * DAY;
  }).length;

  const attention = items
    .filter((i) => i.status !== "Closed")
    .sort((a, b) => {
      const newA = a.status === "Submitted" ? 0 : 1;
      const newB = b.status === "Submitted" ? 0 : 1;
      if (newA !== newB) return newA - newB;
      if (priorityRank[a.priority] !== priorityRank[b.priority]) return priorityRank[a.priority] - priorityRank[b.priority];
      return a.submittedAt - b.submittedAt;
    })
    .slice(0, 5);

  const open = items.filter((i) => i.status !== "Closed");
  const byCategory = categories
    .map((c) => [c, open.filter((i) => i.category === c).length] as const)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  const maxCat = Math.max(1, ...byCategory.map(([, n]) => n));

  return (
    <>
      <PageTitle copy="Every number on this page is counted from the complaints below." eyebrow={todayLabel()} title={`${greeting()}, ${firstName(user)}`} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard color="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300" icon="clipboard" label="New — needs review" note={`${submitted.length} awaiting priority`} value={submitted.length} />
        <StatCard color="bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400" icon="clock" label="Under review" note="Priority set, awaiting assignment" value={review.length} />
        <StatCard
          color="bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400"
          icon="wrench"
          label="With maintenance"
          note={`${highOf(withMaintenance)} high or urgent`}
          value={withMaintenance.length}
        />
        <StatCard
          color="bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          icon="check"
          label="Awaiting verification"
          note={`${overdueVerification} past the ${NO_RESPONSE_DAYS}-day response window`}
          value={resolved.length}
        />
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(280px,.75fr)]">
        <section className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 px-5 py-4">
            <div>
              <h2 className="font-bold text-slate-900 dark:text-slate-50">Needs attention</h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">New reports first, then by priority and age · closed excluded</p>
            </div>
            <Button onClick={() => navigate("complaints")} variant="ghost">
              View queue
            </Button>
          </div>
          {attention.length ? (
            attention.map((item) => <ComplaintRow item={item} key={item.id} onClick={() => onOpen(item.id)} showPriority />)
          ) : (
            <EmptyState copy="Every complaint is closed." title="Nothing needs attention" />
          )}
        </section>
        <aside className="space-y-5">
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
            <h2 className="font-bold text-slate-900 dark:text-slate-50">Open complaints by category</h2>
            <div className="mt-5 space-y-4">
              {byCategory.length ? (
                byCategory.map(([label, n]) => (
                  <div key={label}>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-600 dark:text-slate-300">{label}</span>
                      <span className="font-bold text-slate-900 dark:text-slate-50">{n}</span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <div className="h-full rounded-full bg-blue-600" style={{ width: `${(n / maxCat) * 100}%` }} />
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-500 dark:text-slate-400">No open complaints.</p>
              )}
            </div>
          </div>
          <div className="rounded-2xl bg-slate-900 p-5 text-white dark:bg-slate-800 dark:ring-1 dark:ring-inset dark:ring-slate-700">
            <p className="text-sm font-bold">Proposed closure policy</p>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              If a requester has not responded {NO_RESPONSE_DAYS} days after a resolution, the admin may verify and close it with a written reason.
            </p>
            <p className="mt-2 text-xs text-slate-400">Proposed for this prototype — not an existing college rule.</p>
          </div>
        </aside>
      </div>
    </>
  );
}

function MaintenanceDashboard({ items, user, onOpen, navigate }: { items: Complaint[]; user: string; onOpen: (id: string) => void; navigate: (view: View) => void }) {
  const assigned = items.filter((i) => i.status === "Assigned").length;
  const inProgress = items.filter((i) => i.status === "In Progress").length;
  const waiting = items.filter((i) => i.status === "Resolved").length;
  const active = items.filter((i) => i.status === "Assigned" || i.status === "In Progress");
  return (
    <>
      <PageTitle copy="Your assigned service requests, most urgent first." eyebrow={todayLabel()} title={`${greeting()}, ${firstName(user)}`} />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard color="bg-violet-50 dark:bg-violet-500/10 text-violet-600 dark:text-violet-400" icon="clipboard" label="Assigned to you" note="Not started yet" value={assigned} />
        <StatCard color="bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400" icon="wrench" label="In progress" note="Work started" value={inProgress} />
        <StatCard color="bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" icon="check" label="Awaiting verification" note="Resolution submitted" value={waiting} />
      </div>
      <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 px-5 py-4">
          <div>
            <h2 className="font-bold text-slate-900 dark:text-slate-50">Active jobs</h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Assigned or in progress, ordered by priority</p>
          </div>
          <Button onClick={() => navigate("assignments")} variant="ghost">
            View all
          </Button>
        </div>
        {active.length ? (
          active.map((item) => <ComplaintRow item={item} key={item.id} onClick={() => onOpen(item.id)} showPriority />)
        ) : (
          <EmptyState copy="New assignments from the admin will appear here." title="No active jobs" />
        )}
      </section>
    </>
  );
}

function Assignments({ items, onOpen }: { items: Complaint[]; onOpen: (id: string) => void }) {
  return (
    <>
      <PageTitle copy="Review your workload, update progress, and document completed work." eyebrow="Maintenance" title="My assignments" />
      {items.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {items.map((item) => (
            <button
              className="group rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 dark:hover:border-blue-500/40 hover:shadow-md"
              key={item.id}
              onClick={() => onOpen(item.id)}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold text-blue-600 dark:text-blue-400">{item.id}</p>
                  <h2 className="mt-2 font-bold text-slate-900 dark:text-slate-50 group-hover:text-blue-700 dark:group-hover:text-blue-300">{item.title}</h2>
                </div>
                <PriorityBadge priority={item.priority} />
              </div>
              <div className="mt-4 flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                <Icon name="location" className="size-4" /> {item.location}
              </div>
              <div className="mt-5 flex items-center justify-between border-t border-slate-100 dark:border-slate-800 pt-4">
                <ComplaintStatus item={item} />
                <span className="flex items-center gap-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
                  <Icon name="clock" className="size-3.5" />{" "}
                  {hasActiveVisit(item) && item.visit ? `Visit ${fmtSlot(item.visit)}` : `Reported ${timeAgo(item.submittedAt)}`}
                </span>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <EmptyState copy="Complaints assigned to you by the admin will appear here." title="No assignments" />
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Requester feedback                                                  */
/* ------------------------------------------------------------------ */

function Feedback({ item, navigate, act }: { item: Complaint; navigate: (view: View) => void; act: ActFn }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [reopening, setReopening] = useState(false);
  const [done, setDone] = useState<"" | "closed" | "reopened">("");
  const resolution = latestResolution(item);

  if (done) {
    return (
      <div className="mx-auto flex min-h-[calc(100vh-10rem)] max-w-xl items-center">
        <div className="w-full rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center shadow-xl shadow-slate-200/50 dark:shadow-none">
          <span
            className={`mx-auto grid size-16 place-items-center rounded-full ${done === "closed" ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-orange-50 dark:bg-orange-500/10 text-orange-600 dark:text-orange-400"}`}
          >
            <Icon name={done === "closed" ? "check" : "refresh"} className="size-8" />
          </span>
          <h1 className="mt-6 text-2xl font-bold text-slate-900 dark:text-slate-50">{done === "closed" ? "Thank you for confirming" : "Complaint reopened"}</h1>
          <p className="mt-3 leading-7 text-slate-500 dark:text-slate-400">
            {done === "closed"
              ? `Complaint ${item.id} is now closed.`
              : `Complaint ${item.id} is back In Progress and has returned to ${item.assignee}’s assignment list.`}
          </p>
          <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
            <Button onClick={() => navigate("detail")}>View complaint</Button>
            <Button onClick={() => navigate("complaints")} variant="secondary">
              Back to my complaints
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (item.status !== "Resolved") {
    return (
      <div className="mx-auto max-w-xl rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center">
        <p className="font-semibold text-slate-800 dark:text-slate-100">This complaint is not waiting for your confirmation.</p>
        <Button className="mt-5" onClick={() => navigate("detail")}>
          Back to complaint
        </Button>
      </div>
    );
  }

  return (
    <>
      <button className="mb-5 flex items-center gap-2 text-sm font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white" onClick={() => navigate("detail")}>
        <Icon name="back" className="size-4" /> Back to complaint
      </button>
      <div className="mx-auto max-w-2xl rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm sm:p-9">
        <div className="text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <Icon name="check" className="size-7" />
          </span>
          <p className="mt-5 text-sm font-bold text-emerald-600 dark:text-emerald-400">{item.id} · Resolution submitted</p>
          <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-50">Is the issue fixed?</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
            {item.assignee} marked “{item.title}” as resolved. Please check {item.location} and let us know.
          </p>
        </div>
        {resolution?.note && (
          <div className="mt-6 rounded-2xl border border-slate-200 dark:border-slate-800 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Resolution note</p>
            <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-slate-200">{resolution.note}</p>
            {resolution.evidence && (
              <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300">
                <Icon name="file" className="size-3.5" /> {resolution.evidence.name}
              </p>
            )}
          </div>
        )}
        {reopening ? (
          <div className="mt-6">
            <ReasonForm
              confirmLabel="Reopen complaint"
              label="What is still wrong?"
              onCancel={() => setReopening(false)}
              onConfirm={(reason) => {
                void act(item.id, "reopened", { reason }).then((ok) => ok && setDone("reopened"));
              }}
              placeholder="e.g. The AC still is not cooling after 30 minutes."
              variant="danger"
            />
          </div>
        ) : (
          <>
            <div className="mt-6 rounded-2xl bg-slate-50 dark:bg-slate-950 p-5">
              <p className="text-center text-sm font-semibold text-slate-700 dark:text-slate-200" id="rating-label">
                How would you rate the resolution? <span className="font-normal text-slate-500 dark:text-slate-400">(optional)</span>
              </p>
              <div aria-labelledby="rating-label" className="mt-4 flex justify-center gap-2" role="radiogroup">
                {[1, 2, 3, 4, 5].map((value) => (
                  <button
                    aria-checked={rating === value}
                    aria-label={`${value} star${value > 1 ? "s" : ""}`}
                    className={`transition ${value <= rating ? "text-amber-400" : "text-slate-300 dark:text-slate-600 hover:text-amber-300"}`}
                    key={value}
                    onClick={() => setRating(rating === value ? 0 : value)}
                    role="radio"
                  >
                    <Icon className="size-8" name="star" />
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-6">
              <Field label="Comment (optional)">
                <textarea
                  className={`${fieldClass} min-h-24`}
                  onChange={(event) => setComment(event.target.value)}
                  placeholder="Anything the team should know?"
                  value={comment}
                />
              </Field>
            </div>
            <div className="mt-7 grid gap-3 sm:grid-cols-2">
              <Button
                onClick={() => {
                  const parts = [rating ? `Rated ${rating}/5.` : "", comment.trim() ? `“${comment.trim()}”` : ""].filter(Boolean);
                  void act(item.id, "confirmed", { note: parts.join(" ") || undefined }).then((ok) => ok && setDone("closed"));
                }}
              >
                <Icon name="check" className="size-4" /> Confirm fixed
              </Button>
              <Button onClick={() => setReopening(true)} variant="danger">
                Not fixed — reopen
              </Button>
            </div>
            <p className="mt-5 text-center text-xs leading-5 text-slate-500 dark:text-slate-400">
              Reopening returns the complaint to In Progress with the same staff member. A reason is required.
            </p>
          </>
        )}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* App                                                                 */
/* ------------------------------------------------------------------ */

/** Full-screen message used for loading, configuration and error states. */
function StatusScreen({ title, message, action }: { title: string; message: string; action?: ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 dark:bg-slate-950 p-6 text-slate-900 dark:text-slate-50">
      <style>{darkModeCss}</style>
      <div className="w-full max-w-md rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center shadow-sm" role="status">
        <div className="mx-auto mb-5 w-fit">
          <Logo />
        </div>
        <h1 className="text-xl font-bold">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">{message}</p>
        {action && <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">{action}</div>}
      </div>
    </main>
  );
}

type AuthState = "checking" | "signedOut" | "signedIn";
type LoadState = "loading" | "ready" | "error";

export default function App() {
  const [auth, setAuth] = useState<AuthState>("checking");
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [load, setLoad] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState("");
  const [view, setView] = useState<View>("dashboard");
  const [menuOpen, setMenuOpen] = useState(false);
  const [items, setItems] = useState<Complaint[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [notice, setNotice] = useState("");
  // Redraw once a minute so time-based text (greeting, today's date, "2 h ago") stays current on an open screen.
  const [, setClockTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setClockTick((t) => t + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const [noticeTone, setNoticeTone] = useState<"info" | "error">("info");
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [saving, setSaving] = useState(""); // "" = idle, otherwise the progress message shown
  const savingRef = useRef(false);

  // Keep the session (it survives a page refresh) and react to sign-in / sign-out.
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setUserId(data.session?.user.id ?? null);
      setAuth(data.session ? "signedIn" : "signedOut");
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user.id ?? null);
      setAuth(session ? "signedIn" : "signedOut");
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  // Load the profile (role and team) and the complaints this user may see.
  const reload = useCallback(async () => {
    if (!userId) return;
    setLoad("loading");
    setLoadError("");
    try {
      const me = await loadMyProfile(userId);
      const [data, staffRows] = await Promise.all([loadComplaintData(), loadStaff()]);
      setProfile(me);
      setStaff(staffRows);
      setItems(toComplaints(data.complaints, data.events));
      setLoad("ready");
      // Safe diagnostics: no passwords, tokens or keys.
      console.info(
        `[CampusCare] ${supabaseProjectHost} · signed in as ${me.email} (${me.role}${me.team ? `, ${me.team}` : ""}) · ` +
          `${data.complaints.length} complaint(s), ${data.events.length} timeline event(s): ${data.complaints.map((c) => c.id).join(", ") || "none"}`,
      );
    } catch (err) {
      console.error("[CampusCare] Loading failed:", err instanceof Error ? err.message : err);
      setLoadError(err instanceof Error ? err.message : "Something went wrong while loading.");
      setLoad("error");
    }
  }, [userId]);

  useEffect(() => {
    if (auth === "signedIn" && userId) {
      setView("dashboard");
      setMenuOpen(false);
      void reload();
    } else {
      setProfile(null);
      setItems([]);
      setSelectedId("");
      setNotice("");
    }
  }, [auth, userId, reload]);

  const signOut = async () => {
    setMenuOpen(false);
    await supabase?.auth.signOut();
  };

  if (supabaseConfigError) {
    return <StatusScreen message={supabaseConfigError} title="CampusCare is not connected yet" />;
  }
  if (auth === "checking") return <StatusScreen message="Checking your sign-in…" title="Loading" />;
  if (auth === "signedOut") return <Login />;
  if (load === "loading" && !profile) return <StatusScreen message="Loading your dashboard…" title="Loading" />;
  if (load === "error" || !profile) {
    return (
      <StatusScreen
        action={
          <>
            <Button onClick={() => void reload()}>Try again</Button>
            <Button onClick={() => void signOut()} variant="secondary">
              Sign out
            </Button>
          </>
        }
        message={loadError || "Your profile could not be loaded."}
        title="Couldn't load CampusCare"
      />
    );
  }

  // Role and team come from the database profile, never from the login screen.
  const role: Role = profile.role === "admin" ? "admin" : profile.role === "maintenance" ? "maintenance" : "student";
  const user = profile.full_name;
  const roleLabel =
    profile.role === "admin"
      ? "Administrator"
      : profile.role === "maintenance"
        ? `Maintenance · ${profile.team ?? ""}`
        : profile.role === "faculty"
          ? "Faculty"
          : "Student";

  const selected = items.find((item) => item.id === selectedId);
  // The database already returns only rows this user may see; these filters just pick the right list for each screen.
  const myComplaints = items.filter((i) => i.requesterId === profile.id);
  const myActive = items.filter((i) => i.assigneeId === profile.id && i.status !== "Closed");
  const myAssignments = [...myActive].sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority] || a.submittedAt - b.submittedAt);

  const openComplaint = (id: string) => {
    setSelectedId(id);
    setView("detail");
  };

  const showNotice = (text: string, tone: "info" | "error") => {
    setNotice(text);
    setNoticeTone(tone);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  /** Saves one lifecycle step through the database function perform_action, then reloads from the database. */
  const act: ActFn = async (id, action, payload = {}) => {
    if (savingRef.current) return false;
    const patch = payload.patch ?? {};
    const visitParams = (v?: Visit) =>
      v ? { visit_start: new Date(v.start).toISOString(), visit_hours: Math.round((v.end - v.start) / 3_600_000), visit_days: v.days ?? 1 } : {};
    const p: Record<string, unknown> = {};
    if (action === "reviewStarted") p.priority = patch.priority;
    else if (action === "assigned" || action === "reassigned") {
      const member = staff.find((s) => s.full_name === patch.assignee);
      if (!member) {
        showNotice("That staff member was not found in the database. Refresh the page and try again.", "error");
        return false;
      }
      p.assignee = member.id;
      if (action === "assigned") Object.assign(p, visitParams(patch.visit));
    } else if (action === "visitScheduled") Object.assign(p, visitParams(patch.visit));
    else if (action === "resolutionSubmitted" || action === "confirmed") {
      if (payload.note) p.note = payload.note;
    } else if (payload.reason) p.reason = payload.reason;

    savingRef.current = true;
    setSaving("Saving…");
    try {
      // Evidence is uploaded first; the database only records files that are already stored.
      if (action === "resolutionSubmitted" && payload.evidence?.file && profile) {
        setSaving("Uploading file…");
        const stored = await uploadEvidence(profile.id, payload.evidence.file);
        Object.assign(p, { evidence_path: stored.path, evidence_thumb: stored.thumb, evidence_name: stored.name, evidence_size: stored.size });
        setSaving("Saving…");
      }
      await performAction(id, action, p);
      console.info(`[CampusCare] saved ${action} on ${id}`);
      await reload();
      setNotice("");
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "The change could not be saved.";
      console.error(`[CampusCare] ${action} on ${id} failed:`, message);
      showNotice(`Not saved: ${message}`, "error");
      return false;
    } finally {
      savingRef.current = false;
      setSaving("");
    }
  };

  /** Saves a new complaint through the database function submit_complaint. */
  const submitComplaint = async (data: NewComplaint) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving("Saving…");
    try {
      let file: Partial<NewComplaintInput> = {};
      if (data.file && profile) {
        setSaving("Uploading file…");
        const stored = await uploadEvidence(profile.id, data.file);
        file = { attachment_path: stored.path, attachment_thumb: stored.thumb, attachment_name: stored.name, attachment_size: stored.size };
        setSaving("Saving…");
      }
      const newId = await submitComplaintToDb({
        category: data.category,
        building: data.building,
        floor: data.floor,
        room: data.room,
        description: data.description,
        ...file,
      });
      console.info(`[CampusCare] submitted ${newId}`);
      await reload();
      setSelectedId(newId);
      setView("confirmation");
      setNotice("");
    } catch (err) {
      const message = err instanceof Error ? err.message : "The complaint could not be saved.";
      console.error("[CampusCare] submit failed:", message);
      showNotice(`Not saved: ${message}`, "error");
    } finally {
      savingRef.current = false;
      setSaving("");
    }
  };

  const renderView = () => {
    if ((view === "detail" || view === "feedback" || view === "confirmation") && !selected) {
      return <EmptyState copy="It may have been removed, or you may not have access to it." title="Complaint not found" />;
    }
    if (role === "student" && view === "report") return <ReportForm onSubmit={submitComplaint} />;
    if (view === "confirmation" && selected) return <Confirmation item={selected} navigate={setView} onOpen={openComplaint} />;
    if (view === "complaints" && role !== "maintenance")
      return <ComplaintsList items={role === "admin" ? items : myComplaints} navigate={setView} onOpen={openComplaint} role={role} />;
    if (view === "detail" && selected)
      return <ComplaintDetail act={act} item={selected} items={items} key={selected.id} navigate={setView} role={role} user={user} />;
    if (view === "assignments" && role === "maintenance") return <Assignments items={myAssignments} onOpen={openComplaint} />;
    if (view === "feedback" && role === "student" && selected) return <Feedback act={act} item={selected} key={selected.id} navigate={setView} />;
    if (role === "admin") return <AdminDashboard items={items} navigate={setView} onOpen={openComplaint} user={user} />;
    if (role === "maintenance") return <MaintenanceDashboard items={myActive} navigate={setView} onOpen={openComplaint} user={user} />;
    return <StudentDashboard items={myComplaints} navigate={setView} onOpen={openComplaint} user={user} />;
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-50">
      <style>{darkModeCss}</style>
      <Sidebar
        onLogout={() => void signOut()}
        open={menuOpen}
        role={role}
        roleLabel={roleLabel}
        setOpen={setMenuOpen}
        setView={(v) => {
          setNotice("");
          setView(v);
        }}
        user={user}
        view={view}
      />
      <div className="lg:pl-64">
        <AppHeader role={role} setOpen={setMenuOpen} />
        <main className="mx-auto max-w-screen-2xl p-4 sm:p-8">
          {notice && (
            <div
              className={`mb-6 flex items-start justify-between gap-3 rounded-2xl border p-4 text-sm ${
                noticeTone === "error"
                  ? "border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 text-red-800 dark:text-red-100"
                  : "border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 text-amber-900 dark:text-amber-100"
              }`}
              role="alert"
            >
              <p>{notice}</p>
              <button aria-label="Dismiss" className="shrink-0 font-semibold underline" onClick={() => setNotice("")} type="button">
                Dismiss
              </button>
            </div>
          )}
          {(saving || load === "loading") && (
            <p className="mb-4 text-xs font-medium text-slate-500 dark:text-slate-400" role="status">
              {saving || "Refreshing…"}
            </p>
          )}
          <StaffContext.Provider value={staff}>{renderView()}</StaffContext.Provider>
        </main>
      </div>
    </div>
  );
}
