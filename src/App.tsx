import { useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";

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
type Status = "Submitted" | "Review" | "Assigned" | "In Progress" | "Resolved" | "Closed";

type Complaint = {
  id: string;
  title: string;
  category: string;
  building: string;
  floor: string;
  room: string;
  location: string;
  status: Status;
  priority: "Low" | "Medium" | "High" | "Urgent";
  submitted: string;
  updated: string;
  description: string;
  assignee?: string;
  attachment?: { name: string; size: string };
  history: HistoryEntry[];
};

type HistoryEntry = { status: Status; at: string; by: string; note: string };

const seedComplaints: Omit<Complaint, "history" | "location">[] = [
  {
    id: "CC-2025-1042",
    title: "Air conditioner not working",
    category: "Electrical",
    building: "A1",
    floor: "2nd Floor",
    room: "204",
    status: "In Progress",
    priority: "High",
    submitted: "Sep 16, 2025",
    updated: "2 hours ago",
    description:
      "The air conditioner has stopped cooling and is making a rattling sound. The room becomes very warm during afternoon lectures.",
    assignee: "Marcus Lee",
    attachment: { name: "issue-photo.jpg", size: "1.8 MB" },
  },
  {
    id: "CC-2025-1038",
    title: "Water leak near east staircase",
    category: "Plumbing",
    building: "B",
    floor: "2nd Floor",
    room: "205",
    status: "Assigned",
    priority: "Urgent",
    submitted: "Sep 15, 2025",
    updated: "Yesterday",
    description: "Water is pooling beside the east stairwell and creating a slipping hazard.",
    assignee: "Priya Shah",
  },
  {
    id: "CC-2025-1024",
    title: "Broken desk in lecture hall",
    category: "Furniture",
    building: "C",
    floor: "Ground Floor",
    room: "102",
    status: "Resolved",
    priority: "Medium",
    submitted: "Sep 12, 2025",
    updated: "Sep 15",
    description: "The front-left desk has a loose writing surface and cannot be used safely.",
    assignee: "Daniel Ortiz",
  },
  {
    id: "CC-2025-1017",
    title: "Wi-Fi drops frequently",
    category: "IT & Network",
    building: "D",
    floor: "3rd Floor",
    room: "301",
    status: "Closed",
    priority: "Medium",
    submitted: "Sep 10, 2025",
    updated: "Sep 13",
    description: "The Wi-Fi disconnects every few minutes in rooms 301 through 312.",
    assignee: "IT Support",
  },
  {
    id: "CC-2025-1009",
    title: "Overflowing waste bins",
    category: "Cleanliness",
    building: "A2",
    floor: "Ground Floor",
    room: "12",
    status: "Review",
    priority: "Low",
    submitted: "Sep 9, 2025",
    updated: "Sep 10",
    description: "Waste bins near the north seating area need more frequent collection.",
  },
  {
    id: "CC-2025-0996",
    title: "Flickering corridor lights",
    category: "Electrical",
    building: "D",
    floor: "1st Floor",
    room: "108",
    status: "Resolved",
    priority: "Medium",
    submitted: "Sep 5, 2025",
    updated: "Sep 8",
    description: "Lights in the ground-floor corridor flicker constantly in the evening.",
    assignee: "Marcus Lee",
  },
  {
    id: "CC-2025-0981",
    title: "Broken stairwell light",
    category: "Safety",
    building: "C",
    floor: "Ground Floor",
    room: "4",
    status: "Closed",
    priority: "High",
    submitted: "Aug 29, 2025",
    updated: "Sep 3",
    description: "The stairwell light outside the room has been out for several nights.",
    assignee: "Daniel Ortiz",
  },
  {
    id: "CC-2025-0964",
    title: "Projector won't turn on",
    category: "IT & Network",
    building: "A1",
    floor: "1st Floor",
    room: "110",
    status: "Closed",
    priority: "Medium",
    submitted: "Aug 22, 2025",
    updated: "Aug 26",
    description: "The ceiling projector shows no signal even with a known-good HDMI cable.",
    assignee: "IT Support",
  },
];

const workflow: Status[] = ["Submitted", "Review", "Assigned", "In Progress", "Resolved", "Closed"];

const stepTimes = ["9:08 AM", "1:42 PM", "3:15 PM", "10:32 AM", "2:10 PM", "4:00 PM"];
const stepDays = [0, 0, 1, 1, 2, 3];

function buildHistory(item: Omit<Complaint, "history" | "location">): HistoryEntry[] {
  const who: Record<Status, string> = {
    Submitted: "Alex Johnson",
    Review: "Campus Services",
    Assigned: "Nina Rao",
    "In Progress": item.assignee ?? "Facilities team",
    Resolved: item.assignee ?? "Facilities team",
    Closed: "Alex Johnson",
  };
  const notes: Record<Status, string> = {
    Submitted: "Complaint submitted with details.",
    Review: `Reviewed and priority set to ${item.priority}.`,
    Assigned: `Assigned to ${item.assignee ?? "the facilities team"}.`,
    "In Progress": "Work started on site.",
    Resolved: "Work completed and marked resolved.",
    Closed: "Resolution confirmed and complaint closed.",
  };
  return workflow.slice(0, workflow.indexOf(item.status) + 1).map((status, index) => {
    const date = new Date(item.submitted);
    date.setDate(date.getDate() + stepDays[index]);
    return {
      status,
      at: `${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })} · ${stepTimes[index]}`,
      by: who[status],
      note: notes[status],
    };
  });
}

const initialComplaints: Complaint[] = seedComplaints.map((item) => ({
  ...item,
  location: formatLocation(item),
  history: buildHistory(item),
}));

const categories = ["Electrical", "Plumbing", "IT & Network", "Furniture", "Cleanliness", "Safety", "HVAC", "Other"];
const buildings = ["A1", "A2", "B", "C", "D"];
const floors = ["Ground Floor", "1st Floor", "2nd Floor", "3rd Floor"];

function formatLocation(place: { building: string; floor: string; room: string }) {
  return `Building ${place.building} · ${place.floor} · Room ${place.room}`;
}

function nowLabel() {
  return `Today · ${new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}

const iconPaths: Record<string, ReactNode> = {
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
  plus: (
    <>
      <path d="M12 5v14M5 12h14" />
    </>
  ),
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
  wrench: (
    <>
      <path d="M14.7 6.3a4 4 0 0 0-5-5l2.1 2.1-2.4 2.4-2.1-2.1a4 4 0 0 0 5 5L20 17.4a1.8 1.8 0 0 1-2.6 2.6l-7.7-8.7" />
    </>
  ),
  search: <circle cx="11" cy="11" r="7" />,
  bell: (
    <>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
    </>
  ),
  arrow: <path d="m9 18 6-6-6-6" />,
  back: <path d="m15 18-6-6 6-6" />,
  check: <path d="m5 12 4 4L19 6" />,
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
  logout: (
    <>
      <path d="M10 4H4v16h6M14 8l4 4-4 4M18 12H9" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  star: <path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z" />,
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
  variant?: "primary" | "secondary" | "ghost" | "danger";
  className?: string;
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  const styles = {
    primary: "bg-blue-600 text-white shadow-sm hover:bg-blue-700",
    secondary: "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
    ghost: "text-slate-600 hover:bg-slate-100",
    danger: "border border-red-200 bg-red-50 text-red-700 hover:bg-red-100",
  };
  return (
    <button
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition focus:outline-none focus:ring-4 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`}
      disabled={disabled}
      onClick={onClick}
      type={type}
    >
      {children}
    </button>
  );
}

function StatusBadge({ status }: { status: Status }) {
  const styles: Record<Status, string> = {
    Submitted: "bg-slate-100 text-slate-700",
    Review: "bg-amber-50 text-amber-700 ring-amber-200",
    Assigned: "bg-violet-50 text-violet-700 ring-violet-200",
    "In Progress": "bg-blue-50 text-blue-700 ring-blue-200",
    Resolved: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    Closed: "bg-slate-100 text-slate-600 ring-slate-200",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${styles[status]}`}>
      {status}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: Complaint["priority"] }) {
  const color = {
    Low: "text-slate-600 bg-slate-100",
    Medium: "text-amber-700 bg-amber-50",
    High: "text-orange-700 bg-orange-50",
    Urgent: "text-red-700 bg-red-50",
  }[priority];
  return <span className={`rounded-md px-2 py-1 text-xs font-semibold ${color}`}>{priority}</span>;
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

const fieldClass =
  "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-50";

function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-blue-600 text-white shadow-sm shadow-blue-200">
        <Icon name="logo" className="size-6" />
      </span>
      {!compact && (
        <span className="text-xl font-extrabold tracking-tight text-slate-900">
          Campus<span className="text-blue-600">Care</span>
        </span>
      )}
    </div>
  );
}

function Login({ onLogin }: { onLogin: (role: Role) => void }) {
  const [role, setRole] = useState<Role>("student");
  const roleOptions: Array<{ role: Role; title: string; copy: string; icon: string }> = [
    { role: "student", title: "Student / Faculty", copy: "Report and track campus concerns", icon: "users" },
    { role: "admin", title: "Administrator", copy: "Review, prioritize and assign", icon: "clipboard" },
    { role: "maintenance", title: "Maintenance", copy: "Manage assigned service requests", icon: "wrench" },
  ];
  return (
    <main className="grid min-h-screen bg-slate-50 lg:grid-cols-[1.05fr_.95fr]">
      <section className="relative hidden overflow-hidden bg-slate-950 px-12 py-10 text-white lg:flex lg:flex-col">
        <div className="absolute -right-24 -top-24 size-96 rounded-full bg-blue-600/20 blur-3xl" />
        <div className="absolute -bottom-20 left-20 size-80 rounded-full bg-cyan-500/10 blur-3xl" />
        <Logo />
        <div className="relative my-auto max-w-xl">
          <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-medium text-blue-200">
            <span className="size-2 rounded-full bg-emerald-400" />
            A better campus, together
          </span>
          <h1 className="text-5xl font-extrabold leading-tight tracking-tight">
            Campus support that keeps everyone in the loop.
          </h1>
          <p className="mt-6 max-w-lg text-lg leading-8 text-slate-300">
            Report issues, follow every update, and help your campus teams resolve problems faster.
          </p>
          <div className="mt-10 grid grid-cols-3 gap-3">
            {[
              ["2.4k+", "Issues resolved"],
              ["4.8/5", "Satisfaction"],
              ["18h", "Avg. response"],
            ].map(([value, label]) => (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4" key={label}>
                <p className="text-2xl font-bold">{value}</p>
                <p className="mt-1 text-xs text-slate-400">{label}</p>
              </div>
            ))}
          </div>
        </div>
        <p className="relative text-xs text-slate-500">CampusCare demonstration portal · Simulated data only</p>
      </section>
      <section className="flex items-center justify-center p-5 sm:p-10">
        <div className="w-full max-w-lg">
          <div className="mb-8 lg:hidden">
            <Logo />
          </div>
          <div className="mb-8">
            <p className="text-sm font-semibold text-blue-600">Welcome back</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">Sign in to CampusCare</h2>
            <p className="mt-2 text-slate-500">Choose a demo view to explore the complete workflow.</p>
          </div>
          <div className="space-y-3">
            {roleOptions.map((item) => (
              <button
                className={`flex w-full items-center gap-4 rounded-2xl border p-4 text-left transition ${
                  role === item.role
                    ? "border-blue-500 bg-blue-50 ring-4 ring-blue-50"
                    : "border-slate-200 bg-white hover:border-slate-300"
                }`}
                key={item.role}
                onClick={() => setRole(item.role)}
              >
                <span
                  className={`grid size-11 shrink-0 place-items-center rounded-xl ${
                    role === item.role ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"
                  }`}
                >
                  <Icon name={item.icon} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-slate-900">{item.title}</span>
                  <span className="mt-0.5 block text-sm text-slate-500">{item.copy}</span>
                </span>
                <span
                  className={`grid size-5 place-items-center rounded-full border ${
                    role === item.role ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300"
                  }`}
                >
                  {role === item.role && <Icon name="check" className="size-3" />}
                </span>
              </button>
            ))}
          </div>
          <Field label="Campus email">
            <input className={fieldClass} defaultValue="demo@northbridge.edu" type="email" />
          </Field>
          <div className="mt-4">
            <Field label="Password">
              <input className={fieldClass} defaultValue="campuscare" type="password" />
            </Field>
          </div>
          <Button className="mt-6 w-full" onClick={() => onLogin(role)}>
            Continue to demo <Icon name="arrow" className="size-4" />
          </Button>
          <p className="mt-5 text-center text-xs leading-5 text-slate-400">
            This is a simulated college demo. Sign-in and data are not connected to a live backend.
          </p>
        </div>
      </section>
    </main>
  );
}

function Sidebar({
  role,
  view,
  setView,
  onLogout,
  open,
  setOpen,
}: {
  role: Role;
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
  return (
    <>
      {open && (
        <button
          aria-label="Close navigation"
          className="fixed inset-0 z-30 bg-slate-950/40 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-slate-200 bg-white p-5 transition-transform lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="px-2 py-1">
          <Logo />
        </div>
        <nav className="mt-9 flex-1 space-y-1.5">
          <p className="mb-3 px-3 text-xs font-bold uppercase tracking-widest text-slate-400">Workspace</p>
          {nav.map(([target, icon, label]) => {
            const active =
              view === target ||
              (target === "complaints" && ["detail", "feedback"].includes(view));
            return (
              <button
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold transition ${
                  active ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
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
        <div className="rounded-2xl bg-slate-50 p-3">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-full bg-slate-900 text-xs font-bold text-white">
              {role === "student" ? "AJ" : role === "admin" ? "NR" : "ML"}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-900">
                {role === "student" ? "Alex Johnson" : role === "admin" ? "Nina Rao" : "Marcus Lee"}
              </p>
              <p className="truncate text-xs capitalize text-slate-500">{role}</p>
            </div>
          </div>
          <button
            className="mt-3 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-xs font-semibold text-slate-500 hover:bg-white hover:text-slate-900"
            onClick={onLogout}
          >
            <Icon name="logout" className="size-4" /> Sign out
          </button>
        </div>
      </aside>
    </>
  );
}

function AppHeader({
  role,
  setOpen,
}: {
  role: Role;
  setOpen: (value: boolean) => void;
}) {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-8">
      <button
        aria-label="Open navigation"
        className="grid size-10 place-items-center rounded-xl text-slate-600 hover:bg-slate-100 lg:hidden"
        onClick={() => setOpen(true)}
      >
        <Icon name="menu" />
      </button>
      <div className="flex items-center gap-3 text-sm text-slate-500">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 ring-1 ring-inset ring-amber-200">
          <span className="size-1.5 rounded-full bg-amber-500" />
          Prototype · simulated data
        </span>
        <span className="hidden items-center gap-2 xl:flex">
          <span className="size-2 rounded-full bg-emerald-500" />
          Campus services are operational
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button className="relative grid size-10 place-items-center rounded-xl text-slate-600 hover:bg-slate-100">
          <Icon name="bell" />
          <span className="absolute right-2 top-2 size-2 rounded-full bg-blue-600 ring-2 ring-white" />
        </button>
        <span className="hidden text-sm font-semibold text-slate-700 sm:block">
          {role === "student" ? "JSPM RSCOE" : role === "admin" ? "Admin portal" : "Maintenance team"}
        </span>
      </div>
    </header>
  );
}

function PageTitle({
  eyebrow,
  title,
  copy,
  action,
}: {
  eyebrow?: string;
  title: string;
  copy: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && <p className="mb-1 text-sm font-semibold text-blue-600">{eyebrow}</p>}
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500 sm:text-base">{copy}</p>
      </div>
      {action}
    </div>
  );
}

function StatCard({
  label,
  value,
  note,
  icon,
  color,
}: {
  label: string;
  value: string;
  note: string;
  icon: string;
  color: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/40">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-slate-500">{label}</p>
          <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900">{value}</p>
        </div>
        <span className={`grid size-11 place-items-center rounded-xl ${color}`}>
          <Icon name={icon} />
        </span>
      </div>
      <p className="mt-3 text-xs font-medium text-slate-500">{note}</p>
    </div>
  );
}

function ComplaintRow({
  item,
  onClick,
  admin = false,
}: {
  item: Complaint;
  onClick: () => void;
  admin?: boolean;
}) {
  return (
    <button
      className="group grid w-full gap-3 border-b border-slate-100 px-5 py-4 text-left transition last:border-0 hover:bg-slate-50 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
      onClick={onClick}
    >
      <div className="flex min-w-0 items-start gap-3.5">
        <span className="mt-0.5 hidden size-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-500 sm:grid">
          <Icon name={item.category === "Plumbing" ? "wrench" : "clipboard"} className="size-5" />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-semibold text-slate-900 group-hover:text-blue-700">{item.title}</p>
            {admin && <PriorityBadge priority={item.priority} />}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {item.id} · {item.location}
          </p>
        </div>
      </div>
      <div className="flex items-center justify-between gap-4 pl-0 sm:justify-end">
        <div className="text-right">
          <StatusBadge status={item.status} />
          <p className="mt-1.5 text-xs text-slate-400">Updated {item.updated}</p>
        </div>
        <Icon name="arrow" className="size-4 text-slate-300 group-hover:text-blue-600" />
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
            <tr className="bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-500">
              <th className="px-5 py-3 font-semibold">ID</th>
              <th className="px-3 py-3 font-semibold">Category</th>
              <th className="px-3 py-3 font-semibold">Location</th>
              <th className="px-3 py-3 font-semibold">Date</th>
              <th className="px-3 py-3 font-semibold">Status</th>
              <th className="w-10 px-3 py-3" />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                className="group cursor-pointer border-t border-slate-100 transition hover:bg-slate-50 focus-visible:bg-blue-50 focus-visible:outline-none"
                key={item.id}
                onClick={() => onOpen(item.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") onOpen(item.id);
                }}
                tabIndex={0}
              >
                <td className="px-5 py-4">
                  <p className="font-bold text-blue-700">{item.id}</p>
                  <p className="mt-0.5 max-w-[220px] truncate text-xs text-slate-500">{item.title}</p>
                </td>
                <td className="px-3 py-4 font-medium text-slate-700">{item.category}</td>
                <td className="px-3 py-4 text-slate-600">{item.location}</td>
                <td className="whitespace-nowrap px-3 py-4 text-slate-600">{item.submitted}</td>
                <td className="px-3 py-4">
                  <StatusBadge status={item.status} />
                </td>
                <td className="px-3 py-4">
                  <Icon name="arrow" className="size-4 text-slate-300 group-hover:text-blue-600" />
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

function StudentDashboard({
  items,
  navigate,
  onOpen,
}: {
  items: Complaint[];
  navigate: (view: View) => void;
  onOpen: (id: string) => void;
}) {
  const pending = items.filter((i) => ["Submitted", "Review", "Assigned"].includes(i.status)).length;
  const inProgress = items.filter((i) => i.status === "In Progress").length;
  const resolved = items.filter((i) => i.status === "Resolved" || i.status === "Closed").length;
  return (
    <>
      <PageTitle
        action={
          <Button className="px-5 py-3 text-base shadow-md shadow-blue-200" onClick={() => navigate("report")}>
            <Icon name="plus" className="size-5" /> Report an Issue
          </Button>
        }
        copy="Here’s what’s happening with your campus requests."
        eyebrow="Tuesday, September 16"
        title="Good morning, Alex"
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard color="bg-blue-50 text-blue-600" icon="clipboard" label="Total complaints" note="Submitted this semester" value={String(items.length)} />
        <StatCard color="bg-amber-50 text-amber-600" icon="clock" label="Pending" note="Awaiting review or assignment" value={String(pending)} />
        <StatCard color="bg-violet-50 text-violet-600" icon="wrench" label="In progress" note="Being worked on by a team" value={String(inProgress)} />
        <StatCard color="bg-emerald-50 text-emerald-600" icon="check" label="Resolved" note="Resolved or closed" value={String(resolved)} />
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(280px,.75fr)]">
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/40">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div>
              <h2 className="font-bold text-slate-900">Recent complaints</h2>
              <p className="mt-0.5 text-xs text-slate-500">Select a row to track its progress</p>
            </div>
            <Button onClick={() => navigate("complaints")} variant="ghost">
              View all
            </Button>
          </div>
          <ComplaintTable items={items.slice(0, 5)} onOpen={onOpen} />
        </section>
        <aside className="space-y-6">
          <div className="relative overflow-hidden rounded-2xl bg-blue-600 p-6 text-white shadow-lg shadow-blue-200">
            <div className="absolute -right-8 -top-8 size-32 rounded-full bg-white/10" />
            <span className="grid size-11 place-items-center rounded-xl bg-white/15">
              <Icon name="plus" />
            </span>
            <h2 className="mt-5 text-xl font-bold">Spot a campus issue?</h2>
            <p className="mt-2 text-sm leading-6 text-blue-100">Send the right team all the details in just a few steps.</p>
            <Button className="mt-5 bg-white text-blue-700 hover:bg-blue-50" onClick={() => navigate("report")}>
              Start a report
            </Button>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <p className="font-bold text-slate-900">Need urgent help?</p>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              For emergencies or immediate safety threats, contact Campus Security directly.
            </p>
            <p className="mt-3 text-sm font-bold text-slate-900">Campus Security · Ext. 2222</p>
          </div>
          <p className="px-1 text-xs leading-5 text-slate-400">
            CampusCare is a prototype. All complaints shown here are simulated and live only in this browser session.
          </p>
        </aside>
      </div>
    </>
  );
}

type NewComplaint = { category: string; building: string; floor: string; room: string; description: string; file: File | null };

const ALLOWED_EXTENSIONS = ["jpg", "jpeg", "png", "pdf"];
const ALLOWED_TYPES = ["image/jpeg", "image/png", "application/pdf"];
const MAX_FILE_BYTES = 10 * 1024 * 1024;

function validateFile(file: File): string {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXTENSIONS.includes(extension) || (file.type && !ALLOWED_TYPES.includes(file.type))) {
    return `“${file.name}” is not a supported format. Please upload a JPG, JPEG, PNG or PDF file.`;
  }
  if (file.size > MAX_FILE_BYTES) {
    return `“${file.name}” is larger than 10 MB. Please choose a smaller file.`;
  }
  return "";
}

function formatSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="mt-1.5 text-xs font-medium text-red-600" role="alert">
      {message}
    </p>
  );
}

function ReportForm({ onSubmit }: { onSubmit: (data: NewComplaint) => void }) {
  const [category, setCategory] = useState("");
  const [building, setBuilding] = useState("");
  const [floor, setFloor] = useState("");
  const [room, setRoom] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [draftSaved, setDraftSaved] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const chooseFile = (selected?: File) => {
    if (!selected) return;
    const problem = validateFile(selected);
    if (problem) {
      setFile(null);
      setFileError(problem);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setFileError("");
    setFile(selected);
  };

  const clearFile = () => {
    setFile(null);
    setFileError("");
    if (inputRef.current) inputRef.current.value = "";
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
    if (Object.keys(next).length || fileError) return;
    onSubmit({
      category,
      building,
      floor,
      room: room.trim(),
      description: description.trim(),
      file,
    });
  };

  const invalid = (key: string) => (errors[key] ? "border-red-300 focus:border-red-500 focus:ring-red-50" : "");

  return (
    <>
      <PageTitle
        copy="Share the details below so the right campus team can respond."
        eyebrow="New complaint"
        title="Report a campus issue"
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <form
          className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7"
          noValidate
          onSubmit={submit}
        >
          <div className="mb-6 flex items-center gap-3 border-b border-slate-100 pb-5">
            <span className="grid size-9 place-items-center rounded-full bg-blue-600 text-sm font-bold text-white">1</span>
            <div>
              <h2 className="font-bold text-slate-900">Issue details</h2>
              <p className="text-xs text-slate-500">Category, building, floor, room number and description are required.</p>
            </div>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <Field label="Category">
                <select
                  className={`${fieldClass} ${invalid("category")}`}
                  onChange={(event) => setCategory(event.target.value)}
                  value={category}
                >
                  <option disabled value="">Select a category</option>
                  {categories.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </Field>
              <FieldError message={errors.category} />
            </div>
            <div>
              <Field label="Building">
                <select
                  className={`${fieldClass} ${invalid("building")}`}
                  onChange={(event) => setBuilding(event.target.value)}
                  value={building}
                >
                  <option disabled value="">Select a building</option>
                  {buildings.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </Field>
              <FieldError message={errors.building} />
            </div>
            <div>
              <Field label="Floor">
                <select
                  className={`${fieldClass} ${invalid("floor")}`}
                  onChange={(event) => setFloor(event.target.value)}
                  value={floor}
                >
                  <option disabled value="">Select a floor</option>
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
                  onChange={(event) => setRoom(event.target.value)}
                  placeholder="Enter room number (e.g., 204)"
                  value={room}
                />
              </Field>
              <FieldError message={errors.room} />
            </div>
          </div>
          <div className="mt-5">
            <Field label="Describe the issue" hint="Please don’t include sensitive personal information.">
              <textarea
                className={`${fieldClass} min-h-36 resize-y ${invalid("description")}`}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What happened? When did you first notice it? Include anything that could help the team respond."
                value={description}
              />
            </Field>
            <FieldError message={errors.description} />
          </div>
          <div className="mt-5">
            <span className="mb-2 block text-sm font-semibold text-slate-700">Add supporting evidence (optional)</span>
            {file ? (
              <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <span className="grid size-10 place-items-center rounded-lg bg-white text-blue-600">
                  <Icon name="file" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-800">{file.name}</p>
                  <p className="text-xs text-slate-500">{formatSize(file.size)} · Ready to attach</p>
                </div>
                <Button onClick={clearFile} variant="ghost">Remove</Button>
              </div>
            ) : (
              <label
                className={`flex cursor-pointer flex-col items-center rounded-2xl border-2 border-dashed px-5 py-7 text-center transition focus-within:ring-4 focus-within:ring-blue-100 ${
                  fileError
                    ? "border-red-300 bg-red-50/50"
                    : dragging
                      ? "border-blue-400 bg-blue-50"
                      : "border-slate-200 bg-slate-50 hover:border-blue-300 hover:bg-blue-50/40"
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
                <span className="grid size-11 place-items-center rounded-xl bg-white text-blue-600 shadow-sm">
                  <Icon name="upload" />
                </span>
                <span className="mt-3 text-sm font-semibold text-slate-700">Choose a file or drag it here</span>
                <span className="mt-1 text-xs text-slate-500">JPG, JPEG, PNG or PDF · Maximum 10 MB</span>
              </label>
            )}
            <FieldError message={fileError} />
          </div>
          <div className="mt-7 flex flex-col-reverse gap-3 border-t border-slate-100 pt-6 sm:flex-row sm:items-center sm:justify-end">
            {draftSaved && <span className="text-xs font-medium text-emerald-600 sm:mr-auto">Draft saved locally (demo only)</span>}
            <Button onClick={() => setDraftSaved(true)} variant="secondary">Save draft</Button>
            <Button type="submit">
              Submit complaint <Icon name="arrow" className="size-4" />
            </Button>
          </div>
        </form>
        <aside className="space-y-4">
          <div className="rounded-2xl border border-blue-100 bg-blue-50 p-5">
            <h3 className="font-bold text-slate-900">What happens next?</h3>
            <ol className="mt-4 space-y-4">
              {[
                ["Review", "Campus Services checks your report."],
                ["Assignment", "The right team member is notified."],
                ["Updates", "You’ll see progress here as it happens."],
              ].map(([title, copy], index) => (
                <li className="flex gap-3" key={title}>
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-blue-600 text-xs font-bold text-white">
                    {index + 1}
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{title}</p>
                    <p className="mt-0.5 text-xs leading-5 text-slate-500">{copy}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <p className="px-2 text-xs leading-5 text-slate-500">
            Prototype notice: reports in this demo are stored only in the current browser session and are not sent to a real campus team. Files are not uploaded anywhere.
          </p>
        </aside>
      </div>
    </>
  );
}

function Confirmation({
  item,
  navigate,
  onOpen,
}: {
  item: Complaint;
  navigate: (view: View) => void;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="mx-auto flex min-h-[calc(100vh-10rem)] max-w-2xl items-center justify-center">
      <div className="w-full rounded-3xl border border-slate-200 bg-white p-7 text-center shadow-xl shadow-slate-200/50 sm:p-12">
        <span className="mx-auto grid size-20 place-items-center rounded-full bg-emerald-50 text-emerald-600 ring-8 ring-emerald-50/50">
          <Icon name="check" className="size-10" />
        </span>
        <p className="mt-7 text-sm font-bold uppercase tracking-widest text-emerald-600">Report submitted</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">Thanks for letting us know</h1>
        <p className="mx-auto mt-3 max-w-md leading-7 text-slate-500">
          Your complaint is ready for review. We’ll show updates in your dashboard as the campus team responds.
        </p>
        <div className="mx-auto mt-7 max-w-sm rounded-2xl border border-slate-200 bg-slate-50 p-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Complaint ID</p>
          <p className="mt-2 mb-3 text-2xl font-bold tracking-tight text-slate-900">{item.id}</p>
          <StatusBadge status={item.status} />
          <p className="mt-3 text-xs text-slate-500">
            {item.category} · {item.location}
          </p>
        </div>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Button onClick={() => onOpen(item.id)}>Track complaint</Button>
          <Button onClick={() => navigate("dashboard")} variant="secondary">Return to overview</Button>
        </div>
        <p className="mt-6 text-xs text-slate-400">Demo ID generated locally. No data was sent to a server.</p>
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
          `${item.title} ${item.id} ${item.location} ${item.category}`.toLowerCase().includes(search.toLowerCase()),
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
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row">
          <div className="relative flex-1">
            <Icon name="search" className="absolute left-3.5 top-3 size-4 text-slate-400" />
            <input
              aria-label="Search complaints"
              className={`${fieldClass} py-2.5 pl-10`}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by ID, issue, category or location"
              value={search}
            />
          </div>
          <select
            aria-label="Filter by status"
            className={`${fieldClass} py-2.5 sm:w-44`}
            onChange={(event) => setFilter(event.target.value)}
            value={filter}
          >
            {["All", ...workflow].map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center justify-between bg-slate-50 px-5 py-3 text-xs font-semibold text-slate-500">
          <span>{filtered.length} complaints</span>
          <span>Most recent first</span>
        </div>
        {filtered.length ? (
          role === "student" ? (
            <ComplaintTable items={filtered} onOpen={onOpen} />
          ) : (
            filtered.map((item) => (
              <ComplaintRow admin={role === "admin"} item={item} key={item.id} onClick={() => onOpen(item.id)} />
            ))
          )
        ) : (
          <div className="p-12 text-center">
            <p className="font-semibold text-slate-700">No complaints match your search</p>
            <p className="mt-1 text-sm text-slate-500">Try a different keyword or status.</p>
          </div>
        )}
      </div>
    </>
  );
}

function Workflow({ current }: { current: Status }) {
  const active = workflow.indexOf(current);
  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex min-w-[620px] items-start">
        {workflow.map((step, index) => (
          <div className="flex flex-1 items-start" key={step}>
            <div className="relative flex w-full flex-col items-center text-center">
              {index < workflow.length - 1 && (
                <span className={`absolute left-1/2 top-4 h-0.5 w-full ${index < active ? "bg-blue-600" : "bg-slate-200"}`} />
              )}
              <span
                className={`relative z-10 grid size-8 place-items-center rounded-full text-xs font-bold ${
                  index <= active ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500"
                }`}
              >
                {index < active ? <Icon name="check" className="size-4" /> : index + 1}
              </span>
              <span className={`mt-2 text-xs font-semibold ${index <= active ? "text-slate-800" : "text-slate-500"}`}>{step}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

type UpdateFn = (id: string, status: Status, by: string, note: string, patch?: Partial<Complaint>) => void;

function ComplaintDetail({
  role,
  item,
  navigate,
  onUpdate,
}: {
  role: Role;
  item: Complaint;
  navigate: (view: View) => void;
  onUpdate: UpdateFn;
}) {
  const [saved, setSaved] = useState(false);
  const [priority, setPriority] = useState<Complaint["priority"]>(item.priority);
  const [team, setTeam] = useState("Facilities — Plumbing");
  const [staff, setStaff] = useState(item.assignee ?? "Priya Shah");
  const [draftStatus, setDraftStatus] = useState<Status>(
    item.status === "Assigned" || item.status === "Resolved" ? item.status : "In Progress",
  );
  const [notes, setNotes] = useState("");
  const status = item.status;
  const requester = "Alex Johnson";

  return (
    <>
      <button className="mb-5 flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-slate-900" onClick={() => navigate(role === "maintenance" ? "assignments" : "complaints")}>
        <Icon name="back" className="size-4" /> Back to {role === "maintenance" ? "assignments" : "complaints"}
      </button>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-bold text-blue-600">{item.id}</p>
            <StatusBadge status={status} />
            <PriorityBadge priority={item.priority} />
          </div>
          <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{item.title}</h1>
          <p className="mt-2 text-sm text-slate-500">Submitted by {requester} on {item.submitted}</p>
        </div>
        {role === "student" && status === "Resolved" && (
          <Button onClick={() => navigate("feedback")}>
            Review resolution
          </Button>
        )}
      </div>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <h2 className="font-bold text-slate-900">Complaint tracking</h2>
        <p className="mt-1 text-xs text-slate-500">Submit → Review → Assign → In Progress → Resolved → Closed</p>
        <div className="mt-6"><Workflow current={status} /></div>
      </section>
      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-7">
            <h2 className="font-bold text-slate-900">Issue details</h2>
            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Category</p>
                <p className="mt-1.5 text-sm font-medium text-slate-800">{item.category}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Location</p>
                <p className="mt-1.5 text-sm font-medium text-slate-800">{item.location}</p>
              </div>
            </div>
            <div className="mt-6 border-t border-slate-100 pt-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Description</p>
              <p className="mt-2 text-sm leading-7 text-slate-600">{item.description}</p>
            </div>
            {item.attachment && (
              <div className="mt-5 flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <span className="grid size-10 place-items-center rounded-lg bg-white text-blue-600"><Icon name="file" /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-800">{item.attachment.name}</p>
                  <p className="text-xs text-slate-500">{item.attachment.size} · Evidence attachment</p>
                </div>
              </div>
            )}
          </section>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-7">
            <h2 className="font-bold text-slate-900">Status timeline</h2>
            <div className="mt-5">
              {[...item.history].reverse().map((entry, index, all) => (
                <div className="relative flex gap-3 pb-6 last:pb-0" key={`${entry.status}-${entry.at}-${index}`}>
                  {index < all.length - 1 && <span className="absolute left-3 top-6 bottom-0 w-px bg-slate-200" />}
                  <span className={`relative z-10 mt-0.5 size-6 shrink-0 rounded-full border-4 border-white ${index === 0 ? "bg-blue-600 ring-2 ring-blue-100" : "bg-slate-300"}`} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={entry.status} />
                      <p className="text-xs text-slate-500">{entry.at}</p>
                    </div>
                    <p className="mt-1.5 text-sm font-semibold text-slate-800">{entry.note}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{entry.by}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
        <aside className="space-y-5">
          {role === "admin" && (
            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="font-bold text-slate-900">Review & assign</h2>
              <div className="mt-4 space-y-4">
                <Field label="Priority">
                  <select className={fieldClass} onChange={(event) => setPriority(event.target.value as Complaint["priority"])} value={priority}>
                    <option>Low</option><option>Medium</option><option>High</option><option>Urgent</option>
                  </select>
                </Field>
                <Field label="Assign team">
                  <select className={fieldClass} onChange={(event) => setTeam(event.target.value)} value={team}>
                    <option>Facilities — Plumbing</option><option>Facilities — Electrical</option><option>IT Support</option><option>Housekeeping</option>
                  </select>
                </Field>
                <Field label="Staff member">
                  <select className={fieldClass} onChange={(event) => setStaff(event.target.value)} value={staff}>
                    <option>Priya Shah</option><option>Marcus Lee</option><option>Daniel Ortiz</option>
                  </select>
                </Field>
                <Button
                  className="w-full"
                  onClick={() => {
                    const next = workflow.indexOf(status) < 2 ? "Assigned" : status;
                    onUpdate(item.id, next, "Nina Rao", `Assigned to ${staff} (${team}), priority ${priority}.`, { assignee: staff, priority });
                    setSaved(true);
                  }}
                >
                  {saved ? <><Icon name="check" className="size-4" /> Assignment saved</> : "Assign complaint"}
                </Button>
              </div>
            </section>
          )}
          {role === "maintenance" && (
            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="font-bold text-slate-900">Update assignment</h2>
              <div className="mt-4 space-y-4">
                <Field label="Status">
                  <select className={fieldClass} onChange={(event) => setDraftStatus(event.target.value as Status)} value={draftStatus}>
                    <option>Assigned</option><option>In Progress</option><option>Resolved</option>
                  </select>
                </Field>
                <Field label="Resolution notes">
                  <textarea className={`${fieldClass} min-h-28`} onChange={(event) => setNotes(event.target.value)} placeholder="Describe the work completed or next steps…" value={notes} />
                </Field>
                <Field label="Evidence">
                  <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3 text-sm font-semibold text-slate-600">
                    <input accept=".jpg,.jpeg,.png,.pdf" className="sr-only" type="file" />
                    <Icon name="upload" className="size-4 text-blue-600" /> Upload photo or PDF
                  </label>
                </Field>
                <Button
                  className="w-full"
                  onClick={() => {
                    onUpdate(item.id, draftStatus, item.assignee ?? "Marcus Lee", notes.trim() || `Status updated to ${draftStatus}.`);
                    setNotes("");
                    setSaved(true);
                  }}
                >
                  {saved ? <><Icon name="check" className="size-4" /> Update saved</> : "Save update"}
                </Button>
              </div>
            </section>
          )}
          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="font-bold text-slate-900">{role === "student" ? "Assigned team" : "Request contact"}</h2>
            <div className="mt-4 flex items-center gap-3">
              <span className="grid size-11 place-items-center rounded-full bg-blue-100 text-sm font-bold text-blue-700">
                {role === "student" ? (item.assignee ? item.assignee.split(" ").map((p) => p[0]).join("") : "—") : "AJ"}
              </span>
              <div>
                <p className="text-sm font-semibold text-slate-800">
                  {role === "student" ? (item.assignee ?? "Awaiting assignment") : requester}
                </p>
                <p className="text-xs text-slate-500">
                  {role === "student" ? (item.assignee ? `Facilities · ${item.category}` : "A team will be assigned after review") : "Student · ID 291047"}
                </p>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}

function AdminDashboard({ items, onOpen, navigate }: { items: Complaint[]; onOpen: (id: string) => void; navigate: (view: View) => void }) {
  return (
    <>
      <PageTitle copy="Monitor service levels and keep campus requests moving." eyebrow="Operations overview" title="Good morning, Nina" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard color="bg-amber-50 text-amber-600" icon="clock" label="Awaiting review" note="5 received today" value="14" />
        <StatCard color="bg-violet-50 text-violet-600" icon="users" label="Unassigned" note="3 high priority" value="8" />
        <StatCard color="bg-blue-50 text-blue-600" icon="wrench" label="In progress" note="Across 6 teams" value="27" />
        <StatCard color="bg-emerald-50 text-emerald-600" icon="check" label="Resolved this week" note="12% above last week" value="43" />
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(280px,.75fr)]">
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div><h2 className="font-bold text-slate-900">Needs attention</h2><p className="mt-0.5 text-xs text-slate-500">Urgent and recently submitted complaints</p></div>
            <Button onClick={() => navigate("complaints")} variant="ghost">View queue</Button>
          </div>
          {items.slice(0, 4).map((item) => <ComplaintRow admin item={item} key={item.id} onClick={() => onOpen(item.id)} />)}
        </section>
        <aside className="space-y-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="font-bold text-slate-900">Service health</h2>
            <div className="mt-5 space-y-5">
              {[["First response SLA", "92%", "w-[92%]"], ["Resolution target", "78%", "w-[78%]"], ["Student satisfaction", "89%", "w-[89%]"]].map(([label, value, width]) => (
                <div key={label}>
                  <div className="flex justify-between text-sm"><span className="text-slate-600">{label}</span><span className="font-bold text-slate-900">{value}</span></div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full bg-blue-600 ${width}`} /></div>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-2xl bg-slate-900 p-5 text-white">
            <p className="text-sm font-bold">Peak report time</p>
            <p className="mt-2 text-3xl font-bold">11 AM–2 PM</p>
            <p className="mt-2 text-xs leading-5 text-slate-400">Consider scheduling additional coverage during midday hours.</p>
          </div>
        </aside>
      </div>
    </>
  );
}

function assignedTo(items: Complaint[]) {
  return items.filter((item) => item.assignee && item.status !== "Closed").slice(0, 4);
}

function MaintenanceDashboard({ items, onOpen, navigate }: { items: Complaint[]; onOpen: (id: string) => void; navigate: (view: View) => void }) {
  return (
    <>
      <PageTitle copy="Here are your assigned service requests for today." eyebrow="Tuesday, September 16" title="Good morning, Marcus" />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard color="bg-violet-50 text-violet-600" icon="clipboard" label="Assigned to you" note="2 added today" value="7" />
        <StatCard color="bg-blue-50 text-blue-600" icon="wrench" label="In progress" note="1 due today" value="3" />
        <StatCard color="bg-emerald-50 text-emerald-600" icon="check" label="Completed this week" note="On track for target" value="11" />
      </div>
      <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div><h2 className="font-bold text-slate-900">Today’s priority assignments</h2><p className="mt-0.5 text-xs text-slate-500">Ordered by urgency and service target</p></div>
          <Button onClick={() => navigate("assignments")} variant="ghost">View all</Button>
        </div>
        {assignedTo(items).map((item) => <ComplaintRow admin item={item} key={item.id} onClick={() => onOpen(item.id)} />)}
      </section>
    </>
  );
}

function Assignments({ items, onOpen }: { items: Complaint[]; onOpen: (id: string) => void }) {
  return (
    <>
      <PageTitle copy="Review your workload, update progress, and document completed work." eyebrow="Maintenance" title="My assignments" />
      <div className="grid gap-4 lg:grid-cols-2">
        {assignedTo(items).map((item, index) => (
          <button className="group rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md" key={item.id} onClick={() => onOpen(item.id)}>
            <div className="flex items-start justify-between gap-3">
              <div><p className="text-xs font-bold text-blue-600">{item.id}</p><h2 className="mt-2 font-bold text-slate-900 group-hover:text-blue-700">{item.title}</h2></div>
              <PriorityBadge priority={item.priority} />
            </div>
            <div className="mt-4 flex items-center gap-2 text-sm text-slate-500"><Icon name="location" className="size-4" /> {item.location}</div>
            <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4">
              <StatusBadge status={item.status} />
              <span className="flex items-center gap-1 text-xs font-semibold text-slate-500"><Icon name="clock" className="size-3.5" /> Due {index < 2 ? "today" : "tomorrow"}</span>
            </div>
          </button>
        ))}
      </div>
    </>
  );
}

function Feedback({
  item,
  navigate,
  onClose,
  onReopen,
}: {
  item: Complaint;
  navigate: (view: View) => void;
  onClose: (id: string, rating: number, comment: string) => void;
  onReopen: (id: string) => void;
}) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);
  if (submitted) {
    return (
      <div className="mx-auto flex min-h-[calc(100vh-10rem)] max-w-xl items-center">
        <div className="w-full rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-xl shadow-slate-200/50">
          <span className="mx-auto grid size-16 place-items-center rounded-full bg-emerald-50 text-emerald-600"><Icon name="check" className="size-8" /></span>
          <h1 className="mt-6 text-2xl font-bold text-slate-900">Thank you for your feedback</h1>
          <p className="mt-3 leading-7 text-slate-500">Complaint {item.id} is now closed. Your feedback helps improve campus services.</p>
          <Button className="mt-7" onClick={() => navigate("complaints")}>Back to my complaints</Button>
        </div>
      </div>
    );
  }
  return (
    <>
      <button className="mb-5 flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-slate-900" onClick={() => navigate("detail")}><Icon name="back" className="size-4" /> Back to complaint</button>
      <div className="mx-auto max-w-2xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-9">
        <div className="text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-emerald-50 text-emerald-600"><Icon name="check" className="size-7" /></span>
          <p className="mt-5 text-sm font-bold text-emerald-600">{item.id} · Resolution submitted</p>
          <h1 className="mt-2 text-2xl font-bold text-slate-900">Is the issue resolved?</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            {item.assignee ?? "The maintenance team"} marked “{item.title}” as resolved. Please confirm the issue is fixed so we can close it.
          </p>
        </div>
        <div className="mt-7 rounded-2xl bg-slate-50 p-5">
          <p className="text-center text-sm font-semibold text-slate-700">How would you rate the resolution?</p>
          <div className="mt-4 flex justify-center gap-2">
            {[1, 2, 3, 4, 5].map((value) => (
              <button aria-label={`${value} star${value > 1 ? "s" : ""}`} className={`transition ${value <= rating ? "text-amber-400" : "text-slate-300 hover:text-amber-300"}`} key={value} onClick={() => setRating(value)}>
                <Icon name="star" className="size-8" />
              </button>
            ))}
          </div>
        </div>
        <div className="mt-6">
          <Field label="Additional feedback (optional)">
            <textarea className={`${fieldClass} min-h-28`} onChange={(event) => setComment(event.target.value)} placeholder="Tell us what went well or what could be improved…" value={comment} />
          </Field>
        </div>
        <div className="mt-7 grid gap-3 sm:grid-cols-2">
          <Button
            disabled={!rating}
            onClick={() => {
              onClose(item.id, rating, comment.trim());
              setSubmitted(true);
            }}
          >
            <Icon name="check" className="size-4" /> Confirm & close
          </Button>
          <Button
            onClick={() => {
              onReopen(item.id);
              navigate("detail");
            }}
            variant="danger"
          >
            I’m not satisfied — reopen
          </Button>
        </div>
        <p className="mt-5 text-center text-xs leading-5 text-slate-500">Reopening returns the complaint to In Progress and notifies the assigned team.</p>
      </div>
    </>
  );
}

export default function App() {
  const [role, setRole] = useState<Role | null>(null);
  const [view, setView] = useState<View>("login");
  const [menuOpen, setMenuOpen] = useState(false);
  const [items, setItems] = useState<Complaint[]>(initialComplaints);
  const [selectedId, setSelectedId] = useState<string>(initialComplaints[0].id);

  if (!role || view === "login") {
    return (
      <Login
        onLogin={(selectedRole) => {
          setRole(selectedRole);
          setView("dashboard");
        }}
      />
    );
  }

  const selected = items.find((item) => item.id === selectedId) ?? items[0];

  const openComplaint = (id: string) => {
    setSelectedId(id);
    setView("detail");
  };

  const updateComplaint: UpdateFn = (id, status, by, note, patch = {}) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === id
          ? { ...item, ...patch, status, updated: "Just now", history: [...item.history, { status, at: nowLabel(), by, note }] }
          : item,
      ),
    );
  };

  const submitComplaint = (data: NewComplaint) => {
    const next = Math.max(...items.map((item) => Number(item.id.split("-")[2]))) + 1;
    const id = `CC-2025-${String(next).padStart(4, "0")}`;
    const title = data.description.length > 56 ? `${data.description.slice(0, 56).trim()}…` : data.description;
    const created: Complaint = {
      id,
      title,
      category: data.category,
      building: data.building,
      floor: data.floor,
      room: data.room,
      location: formatLocation(data),
      status: "Submitted",
      priority: "Medium",
      submitted: "Sep 16, 2025",
      updated: "Just now",
      description: data.description,
      attachment: data.file ? { name: data.file.name, size: formatSize(data.file.size) } : undefined,
      history: [
        {
          status: "Submitted",
          at: nowLabel(),
          by: "Alex Johnson",
          note: data.file ? "Complaint submitted with evidence attached." : "Complaint submitted with details.",
        },
      ],
    };
    setItems((prev) => [created, ...prev]);
    setSelectedId(id);
    setView("confirmation");
  };

  const renderView = () => {
    if (view === "report") return <ReportForm onSubmit={submitComplaint} />;
    if (view === "confirmation") return <Confirmation item={selected} navigate={setView} onOpen={openComplaint} />;
    if (view === "complaints") return <ComplaintsList items={items} navigate={setView} onOpen={openComplaint} role={role} />;
    if (view === "detail") return <ComplaintDetail item={selected} key={selected.id} navigate={setView} onUpdate={updateComplaint} role={role} />;
    if (view === "assignments") return <Assignments items={items} onOpen={openComplaint} />;
    if (view === "feedback")
      return (
        <Feedback
          item={selected}
          key={selected.id}
          navigate={setView}
          onClose={(id, rating, comment) =>
            updateComplaint(id, "Closed", "Alex Johnson", `Confirmed resolved (${rating}/5)${comment ? `: “${comment}”` : "."}`)
          }
          onReopen={(id) => updateComplaint(id, "In Progress", "Alex Johnson", "Reopened — requester was not satisfied with the resolution.")}
        />
      );
    if (role === "admin") return <AdminDashboard items={items} navigate={setView} onOpen={openComplaint} />;
    if (role === "maintenance") return <MaintenanceDashboard items={items} navigate={setView} onOpen={openComplaint} />;
    return <StudentDashboard items={items} navigate={setView} onOpen={openComplaint} />;
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <Sidebar
        onLogout={() => {
          setRole(null);
          setView("login");
        }}
        open={menuOpen}
        role={role}
        setOpen={setMenuOpen}
        setView={setView}
        view={view}
      />
      <div className="lg:pl-64">
        <AppHeader role={role} setOpen={setMenuOpen} />
        <main className="mx-auto max-w-screen-2xl p-4 sm:p-8">{renderView()}</main>
      </div>
    </div>
  );
}
