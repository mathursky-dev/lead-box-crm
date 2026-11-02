// Custom report builder: what can be grouped and counted (shared by page, action and UI).

export const DIMS = {
  status: "Status", stage: "Stage", sub_status: "Sub-status", source: "Source", owner: "Owner", team: "Team",
  product: "Product / Service", branch: "Branch", department: "Department", priority: "Priority", number: "WhatsApp number",
  ai_score: "AI score", lost_reason: "Lost reason", location: "City / location",
  day: "Day", week: "Week", month: "Month",
} as const;
export type Dim = keyof typeof DIMS;

export const MEASURES = {
  leads: "Leads", open: "Open", won: "Won", lost: "Lost", invalid: "Invalid", win_rate: "Win rate %",
  expected_value: "Expected value (₹)", won_value: "Won value (₹)", avg_won_value: "Avg. deal size (₹)",
} as const;
export type Measure = keyof typeof MEASURES;

export const DATE_FIELDS = { created_at: "Lead created", closed_at: "Lead closed", converted_at: "Lead won" } as const;
export type DateField = keyof typeof DATE_FIELDS;

export const CHARTS = { bar: "Bar chart", line: "Line chart", pie: "Pie chart", none: "Table only" } as const;
export type ChartKind = keyof typeof CHARTS;

export type ReportSpec = {
  rows: Dim; cols: Dim | ""; measures: Measure[]; date: DateField; preset: string; from?: string; to?: string;
  chart: ChartKind; status_ids: string[]; source_ids: string[]; owner_ids: string[]; product_ids: string[];
};

export const DEFAULT_SPEC: ReportSpec = {
  rows: "source", cols: "", measures: ["leads", "won", "win_rate", "won_value"], date: "created_at", preset: "30",
  chart: "bar", status_ids: [], source_ids: [], owner_ids: [], product_ids: [],
};

export type ReportResult = {
  error?: string; truncated?: boolean; total: number; from: string; to: string;
  rowKeys: { key: string; label: string }[]; colKeys: { key: string; label: string }[];
  // cells[rowKey][colKey or "_"][measure]
  cells: Record<string, Record<string, Partial<Record<Measure, number>>>>;
  totals: Partial<Record<Measure, number>>;
};
