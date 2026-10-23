// Creates a company and its first admin. Idempotent per email/slug.
// Usage: node --env-file=.env.local scripts/bootstrap.mjs --company "Essential Soul Lifestyle Pvt Ltd" --email you@example.com --name "Your Name" [--role super_admin|company_admin]
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const { company, email, name } = args;
const role = args.role ?? "super_admin";
if (!company || !email || !name) {
  console.error('Usage: --company "Name" --email admin@x.com --name "Full Name" [--role super_admin|company_admin]');
  process.exit(1);
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (use --env-file=.env.local).");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });
const slug = company.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

let { data: co } = await db.from("lb_companies").select("id,name").eq("slug", slug).maybeSingle();
if (!co) {
  const r = await db.from("lb_companies").insert({ name: company, slug }).select("id,name").single();
  if (r.error) throw r.error;
  co = r.data;
  console.log(`Created company "${co.name}" (${co.id})`);
} else console.log(`Company exists: ${co.name}`);

const { data: list } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
let user = list?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
let password = null;
if (!user) {
  password = randomBytes(12).toString("base64url");
  const r = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: name } });
  if (r.error) throw r.error;
  user = r.data.user;
  console.log(`Created auth user ${email}`);
} else console.log(`Auth user exists: ${email} (existing password unchanged)`);

const { data: prof } = await db.from("lb_profiles").select("id").eq("id", user.id).maybeSingle();
if (!prof) {
  const r = await db.from("lb_profiles").insert({ id: user.id, company_id: co.id, role, full_name: name, email: email.toLowerCase() });
  if (r.error) throw r.error;
  await db.from("lb_audit_log").insert({ company_id: co.id, action: "bootstrap.admin", entity: "user", entity_id: user.id, data: { email, role } });
  console.log(`Granted ${role} in ${co.name}`);
} else console.log("LEAD BOX profile already exists.");
if (password) console.log(`\nTemporary password (shown once): ${password}\nSign in and change it from "Forgot password" or ask another admin.`);
