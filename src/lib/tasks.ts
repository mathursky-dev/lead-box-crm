// Task module constants shared by the server page, the client table and the actions.

export const TASK_STATUSES = [
  { value: "created", label: "Created", cls: "bg-sky-100 text-sky-800" },
  { value: "in_progress", label: "In progress", cls: "bg-violet-100 text-violet-800" },
  { value: "on_hold", label: "On hold", cls: "bg-amber-100 text-amber-800" },
  { value: "completed", label: "Completed", cls: "bg-emerald-100 text-emerald-800" },
  { value: "cancelled", label: "Cancelled", cls: "bg-slate-200 text-slate-600" },
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number]["value"];
export const OPEN_STATUSES: TaskStatus[] = ["created", "in_progress", "on_hold"];
export const statusOf = (v: string) => TASK_STATUSES.find((s) => s.value === v) ?? TASK_STATUSES[0];

// 1 lowest … 5 highest (stored as a number so it sorts).
export const TASK_PRIORITIES = [
  { value: 1, label: "Lowest", cls: "text-sky-600" },
  { value: 2, label: "Low", cls: "text-sky-500" },
  { value: 3, label: "Medium", cls: "text-amber-500" },
  { value: 4, label: "High", cls: "text-red-500" },
  { value: 5, label: "Highest", cls: "text-red-600" },
] as const;
export const priorityOf = (v: number) => TASK_PRIORITIES.find((p) => p.value === v) ?? TASK_PRIORITIES[2];

// "Filter" dropdown on the tasks page.
export const TASK_DUE_FILTERS = [
  { value: "", label: "All tasks" },
  { value: "open", label: "Open tasks" },
  { value: "overdue", label: "Overdue tasks" },
  { value: "today", label: "Due today" },
  { value: "upcoming", label: "Due later" },
  { value: "nodate", label: "No end date" },
  { value: "completed", label: "Completed" },
] as const;

// Which tasks: mine (assigned to me), by me (I assigned), or all I can see.
export const TASK_SCOPES = [
  { value: "all", label: "All tasks" },
  { value: "to_me", label: "Assigned to me" },
  { value: "by_me", label: "Assigned by me" },
] as const;

// Sortable columns -> lb_tasks column.
export const TASK_SORT: Record<string, string> = {
  task: "title", status: "status", priority: "priority", created: "created_at", modified: "updated_at", due: "due_at", no: "task_no",
};

export const TASK_PAGE_SIZES = [10, 20, 50, 100];
