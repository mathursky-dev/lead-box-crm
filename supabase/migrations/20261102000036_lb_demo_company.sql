-- LEAD BOX demo company: a shared, isolated sandbox for prospective buyers.
--
--   * lb_companies.is_demo marks it. Login: User ID "demo" (admin view) or "demo-agent" (agent view),
--     password Demo@2026. Both are restored on every reset.
--   * Nothing from a demo company ever reaches WhatsApp or Meta:
--       - lb_claim_outbox marks demo messages "delivered" with a fake id and never hands them to the sender;
--       - triggers refuse Meta tokens, Facebook connections, real numbers and wallet top-ups for demo companies;
--       - the app also blocks those screens (src/lib/demo.ts).
--   * lb_demo_reset() wipes every row of the demo company and reseeds fresh dummy data with dates relative to
--     now(). pg_cron runs it daily at 03:00 IST, so whatever buyers change is gone within 24 hours.
--
-- Safe to run more than once.

-- ------------------------------------------------------------------ flag
alter table public.lb_companies add column if not exists is_demo boolean not null default false;

create or replace function public.lb__is_demo(p_company uuid) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select coalesce((select is_demo from lb_companies where id = p_company), false)
$$;

-- ------------------------------------------------------------------ guards (no Meta / money for demo companies)
create or replace function public.lb__demo_guard() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare v_company uuid;
begin
  if tg_table_name = 'lb_wa_number_secrets' then
    select company_id into v_company from lb_wa_numbers where id = new.number_id;
  else
    v_company := new.company_id;
  end if;
  if lb__is_demo(v_company) then
    if tg_table_name = 'lb_wa_numbers' and to_jsonb(new)->>'provider' = 'cloud' and to_jsonb(new)->>'phone_number_id' like 'demo-%' then
      return new; -- the seeded fake number
    end if;
    raise exception 'Demo account: connecting WhatsApp, Facebook or payments is turned off.' using errcode = 'P0001';
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['lb_wa_numbers','lb_wa_number_secrets','lb_integrations','lb_fb_accounts','lb_fb_pages','lb_fb_ads','lb_wallet_topups','lb_payments'] loop
    execute format('drop trigger if exists lb_demo_guard on public.%I', t);
    execute format('create trigger lb_demo_guard before insert or update on public.%I for each row execute function public.lb__demo_guard()', t);
  end loop;
end $$;

-- ------------------------------------------------------------------ outbox: demo messages are never sent
create or replace function public.lb_claim_outbox(p_limit integer default 10)
returns setof lb_messages
language plpgsql security definer set search_path to 'public' as $$
begin
  -- Demo companies: pretend the message went out. It never leaves the database.
  update lb_messages set status = 'delivered', status_rank = 2, wa_message_id = 'demo.' || id, sent_at = now(), delivered_at = now(),
    locked_at = null, error_code = null, error_message = null
  where status in ('queued', 'sending') and company_id in (select id from lb_companies where is_demo);

  update lb_messages set status = 'failed', failed_at = now(), error_code = 'unknown',
    error_message = 'Send outcome unknown (worker interrupted). Check WhatsApp before retrying.'
  where status = 'sending' and locked_at < now() - interval '5 minutes';
  return query
  update lb_messages m set status = 'sending', locked_at = now(), attempts = m.attempts + 1
  where m.id in (select id from lb_messages where status = 'queued' and next_attempt_at <= now()
                   and company_id not in (select id from lb_companies where is_demo)
                 order by next_attempt_at limit p_limit for update skip locked)
  returning m.*;
end $$;

-- ------------------------------------------------------------------ auth helper
create or replace function public.lb__demo_user(p_id uuid, p_email text, p_name text, p_password text)
returns void language plpgsql security definer set search_path to 'public', 'extensions' as $$
begin
  if exists (select 1 from auth.users where id = p_id) then
    update auth.users set email = p_email, encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
      email_confirmed_at = coalesce(email_confirmed_at, now()), banned_until = null, deleted_at = null, updated_at = now()
    where id = p_id;
  else
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current,
      phone_change, phone_change_token, reauthentication_token, is_sso_user, is_anonymous)
    values ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated', p_email,
      extensions.crypt(p_password, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}',
      jsonb_build_object('full_name', p_name), now(), now(), '', '', '', '', '', '', '', '', false, false);
  end if;
  if not exists (select 1 from auth.identities where user_id = p_id and provider = 'email') then
    insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), p_id::text, p_id,
      jsonb_build_object('sub', p_id::text, 'email', p_email, 'email_verified', true, 'phone_verified', false), 'email', now(), now(), now());
  end if;
end $$;

-- ------------------------------------------------------------------ reset + seed
create or replace function public.lb_demo_reset() returns jsonb
language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare
  c constant uuid := 'de000000-0000-4000-8000-000000000001';
  u_admin constant uuid := 'de000000-0000-4000-8000-0000000000a1';
  u_priya constant uuid := 'de000000-0000-4000-8000-0000000000a2';
  u_rahul constant uuid := 'de000000-0000-4000-8000-0000000000a3';
  u_anjali constant uuid := 'de000000-0000-4000-8000-0000000000a4';
  u_vikram constant uuid := 'de000000-0000-4000-8000-0000000000a5';
  u_neha constant uuid := 'de000000-0000-4000-8000-0000000000a6';
  v_fixed uuid[];
  v_pw constant text := 'Demo@2026';
  t text; v_left int; v_pass int; r record;
  -- masters
  br_jaipur uuid; br_delhi uuid; dep uuid; tm_jaipur uuid; tm_delhi uuid; num uuid;
  st jsonb := '{}'; subs jsonb := '{}'; src jsonb := '{}'; prd jsonb := '{}'; tg jsonb := '{}';
  v_src_names text[] := array['WhatsApp','Facebook Ads','Website','Instagram','IndiaMART','Referral','Walk-in','Manual'];
  v_src_w int[] := array[34,26,10,8,8,7,4,3];
  v_prd_names text[] := array['Modular Kitchen','Wardrobes','Full Home Interiors','Office Interiors','Renovation'];
  v_first text[] := array['Aarav','Rohit','Sneha','Pooja','Amit','Kavita','Manish','Ritu','Sanjay','Deepika','Arjun','Meera','Karan','Nisha','Suresh',
    'Anita','Gaurav','Swati','Harsh','Preeti','Nikhil','Shalini','Varun','Komal','Ajay','Divya','Mohit','Payal','Rakesh','Tanvi','Yash','Isha',
    'Vivek','Sakshi','Alok','Jyoti','Sachin','Neelam','Kunal','Bhavna'];
  v_surname text[] := array['Sharma','Agarwal','Jain','Gupta','Khandelwal','Mehta','Singh','Choudhary','Bansal','Rathore','Malhotra','Saxena','Joshi',
    'Kapoor','Verma','Mathur','Goyal','Shekhawat','Arora','Bhatia'];
  v_city text[] := array['Jaipur','Jaipur','Jaipur','Gurugram','Noida','Delhi','Ajmer','Udaipur','Jodhpur','Kota'];
  v_agents uuid[]; v_cats text[] := array['new','assigned','contacted','interested','follow_up','scheduled','won','lost','invalid'];
  v_path text[] := array['assigned','contacted','interested','follow_up','scheduled','won'];
  v_calls text[] := array['Called — interested, wants quotation','Not picked, will try again','Discussed budget and timeline','Asked for site visit on weekend',
    'Shared design ideas over call','Customer comparing with 2 other vendors','Call back after 6 PM','Confirmed measurements'];
  v_fu_notes text[] := array['Share revised quotation','Confirm site visit time','Call to discuss material options','Send kitchen 3D design',
    'Collect advance payment','Follow up on catalogue feedback','Remind about Diwali offer','Check if family approved the design'];
  v_lost text[] := array['Budget too low','Bought from local carpenter','Project postponed','Not responding'];
  -- per lead
  i int; k int; n int; x float; age float; created timestamptz; t_ev timestamptz; t_end timestamptz;
  v_cat text; v_srcname text; v_prdname text; v_owner uuid; v_lead uuid; v_cust uuid; v_conv uuid; v_name text; v_phone text;
  v_exp numeric; v_won numeric; v_sub uuid; v_prev text; v_status uuid; v_fu timestamptz; v_last timestamptz; v_team uuid;
  v_script int; v_lines text[]; v_line text; v_dir text; v_open boolean; v_convs int := 0; v_leads int := 0; v_msgs int := 0;
  v_lastin timestamptz; v_lastout timestamptz; v_preview text; v_unread int;
  scripts jsonb := '[
    ["I|Hi, I saw your ad on Facebook. Need modular kitchen price","O|Hi {name} 👋 Thanks for contacting Urban Nest Interiors! Kitchen ka shape kya hai? (L-shape / U-shape / straight)","I|L-shape, around 10x8 ft","O|Great! L-shape 10x8 ka approx budget ₹1.8L – ₹2.6L hai, material ke hisaab se. Free site measurement book kar dein?","I|Haan, Saturday ko possible hai?","O|Done ✅ Saturday 11 AM, our designer will visit. Please share your address 📍"],
    ["I|Hello, wardrobe ke liye quotation chahiye","O|Hello {name}! Sure 😊 How many wardrobes and what size?","I|2 sliding wardrobes, 7 ft height","O|Noted. Sliding wardrobe with laminate finish starts at ₹1,450/sq ft. Sending our catalogue 👇","O|📎 Wardrobe Catalogue 2026.pdf","I|Thanks, will check and revert"],
    ["I|Hi","O|Hi {name}! Welcome to Urban Nest Interiors 🏠 How can we help?\n1️⃣ Modular Kitchen\n2️⃣ Wardrobes\n3️⃣ Full Home Interiors","I|3","O|Full home interiors — great choice! Flat size kya hai? (2BHK / 3BHK / 4BHK)","I|3BHK, Mansarovar","O|Thank you! Our design team will call you within 30 minutes 📞"],
    ["I|What is the price for office interior? 2000 sq ft","O|Hi {name}, office interiors start at ₹1,200/sq ft (basic) and ₹2,000/sq ft (premium). Shall we schedule a site visit?","I|Please send some previous work photos","O|Sure! Here is our portfolio 🙂 urbannest-demo.in/portfolio","I|Looks good. Call me after 5 pm","O|Noted 👍 Our team will call you after 5 PM today."],
    ["I|Kitchen installation kab tak complete hoga?","O|Namaste {name} ji 🙏 Installation team Monday ko pahunchegi, 3 din me complete.","I|Ok thank you","O|Our pleasure! Please share feedback once done ⭐"],
    ["I|Is there any Diwali offer?","O|Yes {name}! Flat 15% off on modular kitchens + free chimney till 15th Nov 🎉","I|Nice. Can I visit your experience centre?","O|Of course! Experience centre: C-Scheme, Jaipur. Open 10 AM – 8 PM. Kab aana chahenge?","I|Tomorrow evening, around 6"],
    ["I|Need renovation of bathroom and kitchen, budget 3 lakh","O|Hi {name}, thanks for sharing! Dono kaam ₹3L me ho jayenge (basic + premium mix). Can our engineer visit for measurement?","I|Yes, Sunday","O|Booked for Sunday 12 PM ✅ You will get a reminder a day before."],
    ["I|Payment link bhej do advance ke liye","O|Sure {name} ji. Advance amount ₹50,000. UPI: urbannest@demo","I|Paid, screenshot bhej raha hoon","O|Received, thank you! 🙏 Order confirmed. Production starts tomorrow."],
    ["I|Hello, I want to know the rate of modular kitchen with granite top","O|Hi {name}! Granite top ke saath kitchen ₹1,650/sq ft se start hota hai. Aapka kitchen kitna bada hai?","I|12 ft straight","I|Can you give me best price?","O|Ji bilkul, site visit ke baad final best price denge 🙂 Kal 4 baje theek rahega?"]
  ]';
begin
  if not exists (select 1 from lb_companies where id = c and is_demo) then raise exception 'Demo company % is missing', c; end if;
  perform setseed(0.42);
  v_fixed := array[u_admin, u_priya, u_rahul, u_anjali, u_vikram, u_neha];

  -- ============================================================ 1. wipe (only rows of the demo company)
  delete from lb_lead_tags where lead_id in (select id from lb_leads where company_id = c);
  delete from lb_conversation_tags where conversation_id in (select id from lb_conversations where company_id = c);
  delete from lb_message_status_events where wa_message_id in (select wa_message_id from lb_messages where company_id = c and wa_message_id is not null);
  delete from lb_wa_number_users where number_id in (select id from lb_wa_numbers where company_id = c);
  delete from lb_wa_number_teams where number_id in (select id from lb_wa_numbers where company_id = c);
  delete from lb_wa_number_secrets where number_id in (select id from lb_wa_numbers where company_id = c);
  delete from lb_journey_steps where journey_id in (select id from lb_journeys where company_id = c);
  delete from lb_journey_versions where journey_id in (select id from lb_journeys where company_id = c);
  delete from lb_allocation_rule_users where rule_id in (select id from lb_allocation_rules where company_id = c);
  delete from lb_user_team_access where user_id in (select id from lb_profiles where company_id = c);
  update lb_profiles set backup_user_id = null, branch_id = null, department_id = null, team_id = null where company_id = c;
  for v_pass in 1..10 loop
    v_left := 0;
    for t in select tb.table_name from information_schema.tables tb
             where tb.table_schema = 'public' and tb.table_type = 'BASE TABLE' and tb.table_name like 'lb\_%'
               and tb.table_name not in ('lb_companies','lb_billing','lb_profiles','lb_trial_claims','lb_payments')
               and exists (select 1 from information_schema.columns cl where cl.table_schema = 'public' and cl.table_name = tb.table_name and cl.column_name = 'company_id')
    loop
      begin
        execute format('delete from public.%I where company_id = $1', t) using c;
      exception when foreign_key_violation then v_left := v_left + 1;
      end;
    end loop;
    exit when v_left = 0;
  end loop;
  if v_left > 0 then raise exception 'Demo reset could not clear % table(s)', v_left; end if;
  -- Logins buyers created inside the demo disappear too.
  for r in select id from lb_profiles where company_id = c and not (id = any(v_fixed)) loop
    delete from lb_profiles where id = r.id;
    delete from auth.users where id = r.id;
  end loop;

  -- ============================================================ 2. company, billing, logins
  update lb_companies set name = 'Urban Nest Interiors', is_active = true, auto_create_leads = true, auto_allocate = true,
    automation_paused = false, ai_enabled = false, timezone = 'Asia/Kolkata', default_country = 'IN' where id = c;
  update lb_billing set plan = 'internal', plan_id = null, paid_until = null, suspended_at = null, suspended_reason = null,
    notes = 'Shared demo company. Resets daily at 03:00 IST (lb_demo_reset).', updated_at = now() where company_id = c;

  perform lb__demo_user(u_admin, 'demo@demo.leadboxs.in', 'Demo Admin', v_pw);
  perform lb__demo_user(u_priya, 'priya@demo.leadboxs.in', 'Priya Sharma', encode(gen_random_bytes(18), 'base64'));
  perform lb__demo_user(u_rahul, 'rahul@demo.leadboxs.in', 'Rahul Verma', v_pw);
  perform lb__demo_user(u_anjali, 'anjali@demo.leadboxs.in', 'Anjali Gupta', encode(gen_random_bytes(18), 'base64'));
  perform lb__demo_user(u_vikram, 'vikram@demo.leadboxs.in', 'Vikram Singh', encode(gen_random_bytes(18), 'base64'));
  perform lb__demo_user(u_neha, 'neha@demo.leadboxs.in', 'Neha Kapoor', encode(gen_random_bytes(18), 'base64'));

  insert into lb_profiles (id, company_id, role, full_name, email, phone, username, is_active, accepts_auto_allocation, availability, permissions)
  values
    (u_admin, c, 'company_admin', 'Demo Admin', 'demo@demo.leadboxs.in', '+919000000001', 'demo', true, false, 'available', '{}'),
    (u_priya, c, 'team_leader', 'Priya Sharma', 'priya@demo.leadboxs.in', '+919000000002', null, true, true, 'available', '{}'),
    (u_rahul, c, 'agent', 'Rahul Verma', 'rahul@demo.leadboxs.in', '+919000000003', 'demo-agent', true, true, 'available', '{}'),
    (u_anjali, c, 'agent', 'Anjali Gupta', 'anjali@demo.leadboxs.in', '+919000000004', null, true, true, 'available', '{}'),
    (u_vikram, c, 'agent', 'Vikram Singh', 'vikram@demo.leadboxs.in', '+919000000005', null, true, true, 'away', '{}'),
    (u_neha, c, 'agent', 'Neha Kapoor', 'neha@demo.leadboxs.in', '+919000000006', null, true, true, 'available', '{}')
  on conflict (id) do update set company_id = excluded.company_id, role = excluded.role, full_name = excluded.full_name, email = excluded.email,
    phone = excluded.phone, username = excluded.username, is_active = true, deactivated_at = null, accepts_auto_allocation = excluded.accepts_auto_allocation,
    availability = excluded.availability, permissions = '{}', allocation_limit = null, working_hours = null, updated_at = now();

  -- ============================================================ 3. masters
  insert into lb_branches (company_id, name) values (c, 'Jaipur HQ') returning id into br_jaipur;
  insert into lb_branches (company_id, name) values (c, 'Delhi NCR') returning id into br_delhi;
  insert into lb_departments (company_id, branch_id, name) values (c, null, 'Sales') returning id into dep;
  insert into lb_teams (company_id, branch_id, department_id, name) values (c, br_jaipur, dep, 'Team Jaipur') returning id into tm_jaipur;
  insert into lb_teams (company_id, branch_id, department_id, name) values (c, br_delhi, dep, 'Team Delhi') returning id into tm_delhi;
  update lb_profiles set branch_id = br_jaipur, department_id = dep, team_id = tm_jaipur where id in (u_priya, u_rahul, u_anjali);
  update lb_profiles set branch_id = br_delhi, department_id = dep, team_id = tm_delhi where id in (u_vikram, u_neha);
  update lb_profiles set branch_id = br_jaipur where id = u_admin;
  v_agents := array[u_rahul, u_anjali, u_vikram, u_neha, u_rahul, u_anjali, u_priya, u_admin, u_admin]; -- the demo login owns some leads too

  for r in select * from (values ('New','new',10),('Assigned','assigned',20),('Contacted','contacted',30),('Interested','interested',40),
      ('Follow-up','follow_up',50),('Site Visit Scheduled','scheduled',60),('Converted/Won','won',70),('Lost','lost',80),('Invalid','invalid',90)) s(name, cat, so)
  loop
    insert into lb_lead_statuses (company_id, name, category, sort_order, is_default) values (c, r.name, r.cat, r.so, true) returning id into v_status;
    st := st || jsonb_build_object(r.cat, v_status);
  end loop;

  for r in select * from (values ('Not picked',null,10),('Switched off',null,20),('Out of station',null,30),('Other',null,90),
      ('Call back later','contacted',15),('Wrong timing','contacted',25),
      ('Hot','interested',10),('Warm','interested',20),('Price discussion','interested',30),
      ('Quotation sent','follow_up',10),('Design shared','follow_up',20),('Family discussion','follow_up',30),
      ('Measurement done','scheduled',10),('Visit confirmed','scheduled',20),
      ('Budget issue','lost',10),('Bought elsewhere','lost',20),('Not interested','lost',30),
      ('Duplicate','invalid',10),('Wrong number','invalid',20)) s(name, cat, so)
  loop
    insert into lb_lead_sub_statuses (company_id, status_id, name, sort_order)
    values (c, case when r.cat is null then null else (st->>r.cat)::uuid end, r.name, r.so) returning id into v_sub;
    if r.cat is not null then subs := jsonb_set(subs, array[r.cat], coalesce(subs->r.cat, '[]'::jsonb) || to_jsonb(v_sub)); end if;
  end loop;

  for r in select * from (values ('WhatsApp',true),('Manual',true),('Import',true),('Facebook Ads',false),('Website',false),('Instagram',false),
      ('IndiaMART',false),('Referral',false),('Walk-in',false)) s(name, sys)
  loop
    insert into lb_sources (company_id, name, is_system) values (c, r.name, r.sys) returning id into v_status;
    src := src || jsonb_build_object(r.name, v_status);
  end loop;
  foreach t in array v_prd_names loop
    insert into lb_products (company_id, name) values (c, t) returning id into v_status;
    prd := prd || jsonb_build_object(t, v_status);
  end loop;
  for r in select * from (values ('Hot lead','#dc2626'),('Site visit','#2563eb'),('Budget 5L+','#7c3aed'),('Repeat customer','#0f766e'),
      ('Price asked','#d97706'),('Diwali offer','#db2777')) s(name, color)
  loop
    insert into lb_tags (company_id, name, color) values (c, r.name, r.color) returning id into v_status;
    tg := tg || jsonb_build_object(r.name, v_status);
  end loop;

  -- ============================================================ 4. WhatsApp (fake number, never connected to Meta)
  insert into lb_wa_numbers (company_id, label, phone_number_id, waba_id, display_phone, verified_name, quality_rating, branch_id, team_id,
    status, is_active, provider, last_checked_at, last_webhook_at)
  values (c, 'Urban Nest Sales', 'demo-pn-urbannest', 'demo-waba-urbannest', '+91 90000 12345', 'Urban Nest Interiors', 'GREEN', br_jaipur, null,
    'connected', true, 'cloud', now(), now() - interval '7 minutes') returning id into num;
  insert into lb_wa_number_users (number_id, user_id) select num, unnest(array[u_priya, u_rahul, u_anjali, u_vikram, u_neha]);
  insert into lb_wa_prefs (company_id, away_message, hours_enabled) values (c, 'Thanks for messaging Urban Nest Interiors 🙏 We are closed right now and will reply at 10 AM.', false);

  insert into lb_wa_templates (company_id, waba_id, wa_template_id, name, language, category, status, components) values
    (c, 'demo-waba-urbannest', 'demo-t1', 'welcome_offer', 'en', 'MARKETING', 'APPROVED',
      '[{"type":"HEADER","format":"TEXT","text":"Urban Nest Interiors 🏠"},{"type":"BODY","text":"Hi {{1}}, thanks for your interest! Get flat 15% off on modular kitchens this month. Reply YES to book a free site visit."},{"type":"FOOTER","text":"Reply STOP to opt out"}]'),
    (c, 'demo-waba-urbannest', 'demo-t2', 'site_visit_reminder', 'en', 'UTILITY', 'APPROVED',
      '[{"type":"BODY","text":"Hi {{1}}, reminder: our designer will visit you on {{2}}. Reply 1 to confirm or 2 to reschedule."}]'),
    (c, 'demo-waba-urbannest', 'demo-t3', 'quotation_followup', 'en', 'UTILITY', 'APPROVED',
      '[{"type":"BODY","text":"Hi {{1}}, did you get a chance to look at the quotation we shared? Happy to answer any questions 🙂"}]'),
    (c, 'demo-waba-urbannest', 'demo-t4', 'payment_received', 'en', 'UTILITY', 'APPROVED',
      '[{"type":"BODY","text":"Thank you {{1}}! We have received your payment of ₹{{2}}. Your order is confirmed ✅"}]'),
    (c, 'demo-waba-urbannest', 'demo-t5', 'festive_sale_hindi', 'hi', 'MARKETING', 'PENDING',
      '[{"type":"BODY","text":"नमस्ते {{1}} जी, त्योहारों पर Urban Nest की खास पेशकश: मॉड्यूलर किचन पर 15% छूट!"}]');

  insert into lb_wa_bots (company_id, name, keywords, match_type, reply, number_id, priority, is_active, reply_count, created_by)
  values (c, 'Address & timings', array['address','location','timing'], 'contains',
      'Experience centre 📍 C-Scheme, Jaipur. Open 10 AM – 8 PM, all days.', num, 10, true, 37, u_admin),
    (c, 'Catalogue request', array['catalogue','catalog','brochure'], 'contains',
      'Here is our latest catalogue 📎 Our team will also call you shortly.', num, 20, true, 21, u_admin);

  insert into lb_quick_replies (company_id, shortcut, title, body, created_by) values
    (c, '/hi', 'Greeting', 'Hi! Thanks for contacting Urban Nest Interiors 🙏 How can we help you today?', u_admin),
    (c, '/visit', 'Site visit', 'We offer a FREE site measurement. Please share a suitable day and time 📅', u_admin),
    (c, '/price', 'Price range', 'Modular kitchens start at ₹1.5 lakh, wardrobes at ₹1,450/sq ft. Final price after site measurement.', u_admin),
    (c, '/address', 'Address', 'Experience centre: C-Scheme, Jaipur. Open 10 AM – 8 PM 📍', u_admin);

  -- Chatbot flows (visual editor)
  insert into lb_wa_flows (company_id, name, description, trigger_type, keywords, match_type, number_id, priority, is_active, version, run_count, created_by, updated_by, graph)
  values (c, 'Welcome menu', 'Greets new chats, asks what they need and hands over to sales', 'keywords', array['hi','hello','menu'], 'exact', num, 10, true, 1, 186, u_admin, u_admin,
  jsonb_build_object('nodes', jsonb_build_array(
      jsonb_build_object('id','start','type','start','x',80,'y',200,'data','{}'::jsonb),
      jsonb_build_object('id','n_menu','type','buttons','x',420,'y',160,'data',jsonb_build_object('text','Hi {{name}} 👋 Welcome to Urban Nest Interiors! What are you looking for?',
        'choices', jsonb_build_array(jsonb_build_object('id','b_kit','title','Modular Kitchen'), jsonb_build_object('id','b_war','title','Wardrobes'), jsonb_build_object('id','b_home','title','Full Home')))),
      jsonb_build_object('id','n_city','type','question','x',800,'y',60,'data',jsonb_build_object('text','Great choice! Which city is your home in?','variable','city','validate','text')),
      jsonb_build_object('id','n_tag','type','tag','x',1160,'y',60,'data',jsonb_build_object('tag','Hot lead','tag_op','add')),
      jsonb_build_object('id','n_cat','type','message','x',800,'y',340,'data',jsonb_build_object('text','Our wardrobe catalogue is on its way 📎 Sliding and hinged options from ₹1,450/sq ft.')),
      jsonb_build_object('id','n_assign','type','assign','x',1500,'y',200,'data',jsonb_build_object('user_id',u_rahul::text,'text','Thanks! Connecting you to our design expert 🙏'))),
    'edges', jsonb_build_array(
      jsonb_build_object('id','e1','from','start','port','next','to','n_menu'),
      jsonb_build_object('id','e2','from','n_menu','port','b_kit','to','n_city'),
      jsonb_build_object('id','e3','from','n_menu','port','b_home','to','n_city'),
      jsonb_build_object('id','e4','from','n_menu','port','b_war','to','n_cat'),
      jsonb_build_object('id','e5','from','n_city','port','next','to','n_tag'),
      jsonb_build_object('id','e6','from','n_tag','port','next','to','n_assign'),
      jsonb_build_object('id','e7','from','n_cat','port','next','to','n_assign')),
    'settings', jsonb_build_object('timeout_hours',24,'invalid_text','Please choose one of the options above 🙏','max_retries',2,'restart_keyword','menu','stop_keyword','stop bot')));

  insert into lb_wa_flows (company_id, name, description, trigger_type, keywords, match_type, number_id, priority, is_active, version, run_count, created_by, updated_by, graph)
  values (c, 'Price enquiry', 'Answers "price / rate" questions with a product list', 'keywords', array['price','rate','cost'], 'contains', num, 20, true, 1, 64, u_admin, u_admin,
  jsonb_build_object('nodes', jsonb_build_array(
      jsonb_build_object('id','start','type','start','x',80,'y',200,'data','{}'::jsonb),
      jsonb_build_object('id','n_list','type','list','x',420,'y',160,'data',jsonb_build_object('text','Sure! Which product price would you like to know?','button','View products',
        'choices', jsonb_build_array(jsonb_build_object('id','r_kit','title','Modular Kitchen'), jsonb_build_object('id','r_war','title','Wardrobes'), jsonb_build_object('id','r_off','title','Office Interiors')))),
      jsonb_build_object('id','n_kit','type','message','x',820,'y',40,'data',jsonb_build_object('text','Modular kitchens start at ₹1.5 lakh (straight) and ₹1.8 lakh (L-shape) 🍳')),
      jsonb_build_object('id','n_war','type','message','x',820,'y',200,'data',jsonb_build_object('text','Wardrobes start at ₹1,450 per sq ft with laminate finish 🚪')),
      jsonb_build_object('id','n_off','type','message','x',820,'y',360,'data',jsonb_build_object('text','Office interiors start at ₹1,200 per sq ft 🏢')),
      jsonb_build_object('id','n_end','type','end','x',1200,'y',200,'data','{}'::jsonb)),
    'edges', jsonb_build_array(
      jsonb_build_object('id','e1','from','start','port','next','to','n_list'),
      jsonb_build_object('id','e2','from','n_list','port','r_kit','to','n_kit'),
      jsonb_build_object('id','e3','from','n_list','port','r_war','to','n_war'),
      jsonb_build_object('id','e4','from','n_list','port','r_off','to','n_off'),
      jsonb_build_object('id','e5','from','n_kit','port','next','to','n_end'),
      jsonb_build_object('id','e6','from','n_war','port','next','to','n_end'),
      jsonb_build_object('id','e7','from','n_off','port','next','to','n_end')),
    'settings', jsonb_build_object('timeout_hours',24,'invalid_text','Please pick an option from the list 🙏','max_retries',2,'restart_keyword','menu','stop_keyword','stop bot')));
  insert into lb_wa_flow_versions (flow_id, company_id, version, snapshot, note, created_by)
    select id, c, 1, jsonb_build_object('name', name, 'description', description, 'trigger_type', trigger_type, 'keywords', keywords, 'match_type', match_type,
      'number_id', number_id, 'tag_names', tag_names, 'priority', priority, 'is_active', is_active, 'graph', graph), 'Published', u_admin
    from lb_wa_flows where company_id = c;

  -- Allocation: per source, ratio + max per day
  insert into lb_alloc_sources (company_id, source_id) values (c, (src->>'WhatsApp')::uuid) returning id into v_status;
  insert into lb_alloc_members (alloc_id, company_id, user_id, ratio, max_per_day, rr_weight, day, day_count, total_count) values
    (v_status, c, u_rahul, 2, 25, 0, (now() at time zone 'Asia/Kolkata')::date, 3, 41),
    (v_status, c, u_anjali, 1, 20, 0, (now() at time zone 'Asia/Kolkata')::date, 2, 22),
    (v_status, c, u_priya, 1, null, 0, (now() at time zone 'Asia/Kolkata')::date, 1, 18);
  insert into lb_alloc_sources (company_id, source_id) values (c, (src->>'Facebook Ads')::uuid) returning id into v_status;
  insert into lb_alloc_members (alloc_id, company_id, user_id, ratio, max_per_day, rr_weight, day, day_count, total_count) values
    (v_status, c, u_vikram, 1, 30, 0, (now() at time zone 'Asia/Kolkata')::date, 2, 26),
    (v_status, c, u_neha, 1, 30, 0, (now() at time zone 'Asia/Kolkata')::date, 2, 25);
  insert into lb_alloc_sources (company_id, source_id) values (c, null) returning id into v_status;
  insert into lb_alloc_members (alloc_id, company_id, user_id, ratio, max_per_day, rr_weight, day, day_count, total_count) values
    (v_status, c, u_rahul, 1, null, 0, (now() at time zone 'Asia/Kolkata')::date, 0, 9),
    (v_status, c, u_neha, 1, null, 0, (now() at time zone 'Asia/Kolkata')::date, 1, 8);

  -- Documents (the files themselves are written by the app on first open: src/lib/demo.ts)
  insert into lb_documents (company_id, description, file_name, path, mime, size, created_by, created_at) values
    (c, 'Latest price list for kitchens, wardrobes and full home packages', 'Urban Nest Price List 2026.pdf', c || '/demo-price-list.pdf', 'application/pdf', 2100, u_admin, now() - interval '20 days'),
    (c, 'Modular kitchen catalogue with finishes and layouts', 'Modular Kitchen Catalogue.pdf', c || '/demo-kitchen-catalogue.pdf', 'application/pdf', 2300, u_priya, now() - interval '12 days'),
    (c, 'Wardrobe designs: sliding and hinged', 'Wardrobe Catalogue 2026.pdf', c || '/demo-wardrobe-catalogue.pdf', 'application/pdf', 2000, u_priya, now() - interval '9 days'),
    (c, 'Company profile to share with new customers', 'Urban Nest Company Profile.pdf', c || '/demo-company-profile.pdf', 'application/pdf', 2200, u_admin, now() - interval '30 days'),
    (c, 'Quotation format used by the sales team', 'Quotation Format.csv', c || '/demo-quotation-format.csv', 'text/csv', 600, u_rahul, now() - interval '4 days');

  -- ============================================================ 5. leads, activity, follow-ups, chats
  for i in 1..140 loop
    age := power(random(), 1.7) * 60;                         -- more recent leads than old ones
    created := now() - make_interval(secs => (age * 86400)::int + 600);
    -- source (weighted)
    x := random() * 100; k := 0;
    for n in 1..array_length(v_src_names, 1) loop k := k + v_src_w[n]; if x < k then v_srcname := v_src_names[n]; exit; end if; end loop;
    v_prdname := v_prd_names[1 + floor(random() * (case when random() < 0.45 then 1 else 5 end))::int];
    -- status by age
    x := random();
    if age < 1 then v_cat := case when x < .35 then 'new' when x < .6 then 'assigned' when x < .85 then 'contacted' else 'interested' end;
    elsif age < 7 then v_cat := case when x < .1 then 'assigned' when x < .32 then 'contacted' when x < .55 then 'interested' when x < .75 then 'follow_up'
      when x < .87 then 'scheduled' when x < .93 then 'won' when x < .97 then 'lost' else 'invalid' end;
    else v_cat := case when x < .08 then 'contacted' when x < .18 then 'interested' when x < .33 then 'follow_up' when x < .43 then 'scheduled'
      when x < .7 then 'won' when x < .9 then 'lost' else 'invalid' end;
    end if;
    v_owner := case when v_cat = 'new' then null else v_agents[1 + floor(random() * array_length(v_agents, 1))::int] end;
    v_team := case when v_owner in (u_vikram, u_neha) then tm_delhi when v_owner is null then null else tm_jaipur end;
    v_exp := round(case v_prdname when 'Modular Kitchen' then 150000 + random() * 300000 when 'Wardrobes' then 60000 + random() * 140000
      when 'Full Home Interiors' then 600000 + random() * 1900000 when 'Office Interiors' then 400000 + random() * 1100000 else 100000 + random() * 400000 end / 5000) * 5000;
    v_won := case when v_cat = 'won' then round(v_exp * (0.82 + random() * 0.2) / 1000) * 1000 end;
    v_sub := null;
    if subs ? v_cat and random() < (case v_cat when 'lost' then .9 when 'invalid' then .8 else .6 end) then
      v_sub := (subs->v_cat->>floor(random() * jsonb_array_length(subs->v_cat))::int)::uuid;
    elsif v_cat = 'contacted' and random() < .4 then
      select id into v_sub from lb_lead_sub_statuses where company_id = c and status_id is null and name = 'Not picked';
    end if;
    v_name := v_first[1 + floor(random() * array_length(v_first, 1))::int] || ' ' || v_surname[1 + floor(random() * array_length(v_surname, 1))::int];
    v_phone := '+9190010' || lpad(i::text, 5, '0');
    t_end := least(now() - interval '2 minutes', created + make_interval(secs => (greatest(age, 0.02) * 86400 * 0.8)::int));

    insert into lb_customers (company_id, name, phone_e164, email, location, wa_profile_name, wa_opt_in_at, created_at, updated_at)
    values (c, v_name, v_phone, case when random() < .4 then lower(replace(v_name, ' ', '.')) || '@example.com' end,
      v_city[1 + floor(random() * array_length(v_city, 1))::int], case when v_srcname in ('WhatsApp','Facebook Ads','Instagram') then split_part(v_name, ' ', 1) end,
      case when random() < .5 then created end, created, created)
    returning id into v_cust;

    insert into lb_leads (company_id, customer_id, branch_id, department_id, team_id, product_id, source_id, number_id, status_id, status_category, priority,
      owner_id, original_owner_id, first_allocated_at, assigned_at, converted_owner_id, converted_at, closed_at, expected_value, won_value,
      lost_reason, created_by, created_at, updated_at, last_activity_at, payment_status, payment_due_amount, payment_due_at, sub_status_id)
    values (c, v_cust, case when v_team = tm_delhi then br_delhi else br_jaipur end, dep, v_team, (prd->>v_prdname)::uuid, (src->>v_srcname)::uuid,
      case when v_srcname in ('WhatsApp','Facebook Ads','Instagram') then num end, (st->>v_cat)::uuid, v_cat,
      case when random() < .06 then 'urgent' when random() < .25 then 'high' when random() < .85 then 'normal' else 'low' end,
      v_owner, v_owner, case when v_owner is not null then created + interval '2 minutes' end, case when v_owner is not null then created + interval '2 minutes' end,
      case when v_cat = 'won' then v_owner end, case when v_cat = 'won' then t_end end, case when v_cat in ('won','lost','invalid') then t_end end,
      v_exp, v_won, case when v_cat = 'lost' then v_lost[1 + floor(random() * 4)::int] end,
      case when v_srcname in ('Manual','Walk-in','Referral') then coalesce(v_owner, u_admin) end, created, t_end, t_end,
      case when v_cat = 'won' then (array['paid','paid','paid','partial','partial','pending'])[1 + floor(random() * 6)::int] else 'none' end,
      null, null, v_sub)
    returning id into v_lead;
    update lb_leads set payment_due_amount = round(v_won * 0.4 / 1000) * 1000, payment_due_at = now() + make_interval(days => 1 + floor(random() * 10)::int)
      where id = v_lead and payment_status in ('partial','pending');
    v_leads := v_leads + 1;

    -- timeline
    insert into lb_lead_events (company_id, lead_id, actor_id, owner_id, type, is_work, to_status_id, to_category, data, created_at)
    values (c, v_lead, null, null, 'created', false, (st->>'new')::uuid, 'new', jsonb_build_object('via', lower(v_srcname)), created);
    if v_owner is not null then
      insert into lb_lead_events (company_id, lead_id, actor_id, owner_id, type, to_user_id, reason, data, created_at)
      values (c, v_lead, null, v_owner, 'assignment', v_owner, 'Auto allocation', '{}', created + interval '2 minutes');
      v_prev := 'new';
      n := case v_cat when 'assigned' then 1 when 'contacted' then 2 when 'interested' then 3 when 'follow_up' then 4 when 'scheduled' then 5
        when 'won' then 6 when 'lost' then 2 + floor(random() * 3)::int when 'invalid' then 1 else 0 end;
      for k in 1..n loop
        t_ev := created + (t_end - created) * (k::float / (n + 1)) + interval '3 minutes';
        insert into lb_lead_events (company_id, lead_id, actor_id, owner_id, type, is_work, from_status_id, to_status_id, to_category, data, created_at)
        values (c, v_lead, case when k = 1 then null else v_owner end, v_owner, 'status_change', k > 1, (st->>v_prev)::uuid, (st->>v_path[k])::uuid, v_path[k], '{}', t_ev);
        v_prev := v_path[k];
        if k >= 2 and random() < .7 then
          insert into lb_lead_events (company_id, lead_id, actor_id, owner_id, type, is_work, data, created_at)
          values (c, v_lead, v_owner, v_owner, 'call', true, jsonb_build_object('body', v_calls[1 + floor(random() * array_length(v_calls, 1))::int]), t_ev - interval '10 minutes');
        end if;
      end loop;
      if v_cat in ('lost','invalid') then
        insert into lb_lead_events (company_id, lead_id, actor_id, owner_id, type, is_work, from_status_id, to_status_id, to_category, reason, data, created_at)
        values (c, v_lead, v_owner, v_owner, 'status_change', true, (st->>v_prev)::uuid, (st->>v_cat)::uuid, v_cat,
          case when v_cat = 'lost' then v_lost[1 + floor(random() * 4)::int] else 'Wrong number' end, '{}', t_end);
      end if;
    end if;

    -- follow-ups
    if v_cat in ('contacted','interested','follow_up','scheduled','assigned') and v_owner is not null then
      x := random();
      v_fu := case when x < .25 then now() - make_interval(hours => 2 + floor(random() * 60)::int)            -- overdue
                   when x < .6 then date_trunc('hour', now()) + make_interval(hours => 1 + floor(random() * 8)::int) -- today
                   else now() + make_interval(days => 1 + floor(random() * 5)::int, hours => floor(random() * 6)::int) end;
      insert into lb_followups (company_id, lead_id, assigned_to, due_at, note, status, created_by, created_at, action_type)
      values (c, v_lead, v_owner, v_fu, v_fu_notes[1 + floor(random() * array_length(v_fu_notes, 1))::int], 'pending', v_owner, t_end,
        case when v_cat = 'scheduled' then 'meeting' when random() < .3 then 'whatsapp' else 'call' end);
      insert into lb_lead_events (company_id, lead_id, actor_id, owner_id, type, is_work, data, created_at)
      values (c, v_lead, v_owner, v_owner, 'followup_created', true, jsonb_build_object('note', '', 'due_at', v_fu), t_end);
      update lb_leads set next_followup_at = v_fu where id = v_lead;
    end if;
    if age > 3 and v_owner is not null and random() < .6 then
      t_ev := created + (t_end - created) * 0.5;
      insert into lb_followups (company_id, lead_id, assigned_to, due_at, note, status, completed_at, completed_by, created_by, created_at, action_type)
      values (c, v_lead, v_owner, t_ev, v_fu_notes[1 + floor(random() * array_length(v_fu_notes, 1))::int], 'done', t_ev + interval '20 minutes', v_owner, v_owner, created + interval '1 hour', 'call');
      insert into lb_lead_events (company_id, lead_id, actor_id, owner_id, type, is_work, data, created_at)
      values (c, v_lead, v_owner, v_owner, 'followup_done', true, jsonb_build_object('note', null, 'cancelled', false), t_ev + interval '20 minutes');
    end if;

    -- notes & tags
    if v_owner is not null and random() < .35 then
      insert into lb_notes (company_id, customer_id, lead_id, author_id, body, created_at)
      values (c, v_cust, v_lead, v_owner, (array['Customer wants delivery before Diwali.','Prefers acrylic finish, white + grey combo.',
        'Husband will decide, call in the evening.','Asked for EMI options.','Visited experience centre, liked the Italian kitchen.',
        'Needs 3D design before confirming.'])[1 + floor(random() * 6)::int], t_end - interval '30 minutes');
      insert into lb_lead_events (company_id, lead_id, actor_id, owner_id, type, is_work, data, created_at)
      values (c, v_lead, v_owner, v_owner, 'note', true, jsonb_build_object('body', 'Note added'), t_end - interval '30 minutes');
    end if;
    if random() < .3 then
      insert into lb_lead_tags (lead_id, tag_id) values (v_lead, (tg->>(array['Hot lead','Site visit','Budget 5L+','Price asked','Diwali offer','Repeat customer'])[1 + floor(random() * 6)::int])::uuid)
      on conflict do nothing;
    end if;

    -- WhatsApp chat
    if v_srcname in ('WhatsApp','Facebook Ads','Instagram') and v_convs < 48 then
      v_script := case
        when v_cat = 'won' then (array[4, 7])[1 + floor(random() * 2)::int]
        when v_cat in ('new','assigned') then (array[0, 2, 5, 8])[1 + floor(random() * 4)::int]
        when v_cat in ('interested','follow_up','scheduled') then (array[1, 3, 6, 5, 8])[1 + floor(random() * 5)::int]
        else floor(random() * 9)::int end;
      select array_agg(value order by ord) into v_lines from jsonb_array_elements_text(scripts->v_script) with ordinality as e(value, ord);
      n := array_length(v_lines, 1);
      -- Chats still in progress end within the last day (the 24-hour reply window is open); older ones end with the lead.
      v_open := v_cat in ('new','assigned','contacted','interested','follow_up','scheduled') and (age < 2 or random() < .45);
      v_last := case when v_open then now() - make_interval(mins => 5 + floor(random() * 900)::int) else t_end end;
      insert into lb_conversations (company_id, number_id, customer_id, lead_id, team_id, assignee_id, status, created_at, updated_at)
      values (c, num, v_cust, v_lead, v_team, v_owner, case when v_open then 'open' when v_cat in ('won','lost','invalid') then 'resolved' else 'pending' end,
        v_last - make_interval(mins => n * 4), v_last)
      returning id into v_conv;
      v_lastin := null; v_lastout := null; v_preview := null;
      for k in 1..n loop
        v_dir := case when split_part(v_lines[k], '|', 1) = 'I' then 'in' else 'out' end;
        v_line := replace(substr(v_lines[k], 3), '{name}', split_part(v_name, ' ', 1));
        t_ev := v_last - make_interval(mins => (n - k) * 4);
        insert into lb_messages (company_id, conversation_id, direction, type, body, wa_message_id, status, status_rank, sent_by, wa_timestamp,
          sent_at, delivered_at, read_at, created_at, automated)
        values (c, v_conv, v_dir, 'text', v_line, 'demo.' || gen_random_uuid(),
          case when v_dir = 'in' then 'received' when k = n and v_open then 'delivered' else 'read' end,
          case when v_dir = 'in' then 0 when k = n and v_open then 2 else 3 end,
          case when v_dir = 'out' then coalesce(v_owner, u_admin) end, t_ev,
          case when v_dir = 'out' then t_ev end, case when v_dir = 'out' then t_ev + interval '5 seconds' end,
          case when v_dir = 'out' and not (k = n and v_open) then t_ev + interval '1 minute' end, t_ev,
          v_dir = 'out' and v_script = 2 and k = 2);
        if v_dir = 'in' then v_lastin := t_ev; else v_lastout := t_ev; end if;
        v_preview := left(v_line, 140);
        v_msgs := v_msgs + 1;
      end loop;
      v_unread := case when v_open and v_dir = 'in' then 1 + floor(random() * 2)::int else 0 end;
      update lb_conversations set last_message_at = v_last, last_message_preview = v_preview, last_inbound_at = v_lastin, last_outbound_at = v_lastout,
        unread_count = v_unread, awaiting_reply_since = case when v_dir = 'in' and v_open then v_last end, updated_at = v_last,
        sla_alerted_at = case when v_dir = 'in' and v_open then v_last end
      where id = v_conv;
      if random() < .4 then
        insert into lb_conversation_tags (conversation_id, tag_id) values (v_conv, (tg->>(array['Hot lead','Price asked','Site visit'])[1 + floor(random() * 3)::int])::uuid)
        on conflict do nothing;
      end if;
      v_convs := v_convs + 1;
    end if;
  end loop;

  -- Signals/notifications the message triggers raised while seeding are kept; add a few for the demo admin's bell.
  insert into lb_notifications (company_id, user_id, type, title, body, link, created_at) values
    (c, u_admin, 'assignment', 'New Facebook lead assigned to Neha Kapoor', 'Modular Kitchen enquiry from Jaipur', '/leads', now() - interval '25 minutes'),
    (c, u_admin, 'followup', '6 follow-ups are overdue in your team', 'Open Follow-ups to see them', '/followups', now() - interval '2 hours'),
    (c, u_admin, 'signal', 'Buying signal: customer asked for price', '“Can you give me best price?”', '/inbox', now() - interval '3 hours');

  return jsonb_build_object('company', c, 'leads', v_leads, 'conversations', v_convs, 'messages', v_msgs);
end $$;

revoke all on function public.lb_demo_reset() from public, anon, authenticated;
revoke all on function public.lb__demo_user(uuid, text, text, text) from public, anon, authenticated;

-- ------------------------------------------------------------------ create the demo company once
do $$
begin
  if not exists (select 1 from lb_companies where id = 'de000000-0000-4000-8000-000000000001') then
    insert into lb_companies (id, name, slug, is_demo) values ('de000000-0000-4000-8000-000000000001', 'Urban Nest Interiors', 'demo-urban-nest', true);
  else
    update lb_companies set is_demo = true where id = 'de000000-0000-4000-8000-000000000001';
  end if;
end $$;

select public.lb_demo_reset();

-- ------------------------------------------------------------------ daily reset at 03:00 IST (21:30 UTC)
select cron.schedule('lb-demo-reset', '30 21 * * *', 'select public.lb_demo_reset()');
