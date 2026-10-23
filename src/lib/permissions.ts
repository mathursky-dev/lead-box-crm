// Mirrors lb_permission_catalog (enforced in the database by lb_can()).
export const PERMISSIONS = {
  "leads.create": "Create leads",
  "leads.edit": "Edit lead details",
  "leads.status": "Change lead status",
  "leads.assign": "Assign / reassign leads",
  "leads.import": "Import leads (CSV)",
  "leads.export": "Export leads (CSV)",
  "chats.send": "Send WhatsApp messages",
  "chats.transfer": "Transfer chats",
  "reports.view": "View 360 Reports",
  "customers.view": "View Customer 360 directory",
  "nurture.view": "View nurture & recovery queues",
  "journeys.manage": "Manage nurturing journeys",
  "campaigns.manage": "Create campaigns & segments",
  "campaigns.approve": "Approve campaigns & offers",
  "consent.manage": "Record consent & suppressions",
  "ai.use": "Use AI summaries & suggested replies",
  "knowledge.manage": "Manage approved AI knowledge",
  "automation.control": "Pause automation globally",
  "complaints.manage": "Raise & resolve complaints",
} as const;
export type Permission = keyof typeof PERMISSIONS;
