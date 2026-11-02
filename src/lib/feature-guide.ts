// Every Lead Box CRM feature with a step-by-step how-to.
// Single source for the Features & Guide page (/guide), the Help & Guides drawer and the AI help bot.
// Steps are plain text; [Label](/path) is a link to a CRM page and **text** is bold.
// When a feature is added or a page moves, update this file: the bot only knows what is written here.

export const GUIDE_CATS = [
  "Getting started",
  "Leads & sales",
  "WhatsApp & inbox",
  "Automation & AI",
  "Marketing",
  "Customer care & store",
  "Money",
  "Team & field",
  "Reports",
  "Settings & admin",
  "Integrations",
  "Platform",
] as const;
export type GuideCat = (typeof GUIDE_CATS)[number];

/** Who can open the page: everyone, company admins (and super admin), super admin only, or users with reports access. */
export type Access = "all" | "admin" | "super" | "reports";

export type Feature = {
  id: string;
  title: string;
  cat: GuideCat;
  href: string;
  icon: string;
  what: string;
  steps: string[];
  tips?: string[];
  keywords?: string;
  access?: Access;
  /** Plan feature the page needs (hidden when the company's plan does not include it). */
  plan?: "nurture" | "fb_leads" | "ai";
};

export const CAT_ICON: Record<GuideCat, string> = {
  "Getting started": "sparkle", "Leads & sales": "target", "WhatsApp & inbox": "chat", "Automation & AI": "bot", Marketing: "megaphone",
  "Customer care & store": "heart", Money: "rupee", "Team & field": "pin", Reports: "chart", "Settings & admin": "gear", Integrations: "link", Platform: "building",
};

export const FEATURES: Feature[] = [
  // ───────── Getting started ─────────
  { id: "first-setup", cat: "Getting started", icon: "sparkle", href: "/admin/quick-setup", access: "admin", title: "First-time setup (admin checklist)",
    what: "The order to set up a new company so leads, WhatsApp and the team all work from day one.",
    steps: [
      "Add your team in [Users](/admin/users) and pick each person's role (Company Admin, Team Leader, Agent).",
      "Set branches, departments and teams in [Organisation](/admin/org).",
      "Set lead statuses, sources, tags and custom fields from [Settings](/settings) → Leads.",
      "Connect WhatsApp: save Meta app credentials in [WhatsApp Cloud API](/admin/integrations), then add your number in [Connections](/whatsapp/connections).",
      "Sync or create message templates in [Templates](/whatsapp/templates).",
      "Bring leads in: [Import](/import) an Excel/CSV, connect [Facebook Lead Ads](/admin/fb-login) and [Lead sources](/admin/lead-sources) (Google Ads, IndiaMART, JustDial, website).",
      "Decide who gets new leads in [Lead allocation](/admin/allocation).",
      "Turn on a [chatbot](/whatsapp/chatbots) or [flow](/whatsapp/flows) so customers get an instant reply.",
    ],
    tips: ["[Quick Setup](/admin/quick-setup) has the import and integration shortcuts on one page."],
    keywords: "start setup onboarding new company begin kaise shuru" },
  { id: "navigation", cat: "Getting started", icon: "menu", href: "/dashboard", title: "Finding your way: menu, search, Quick Create, help",
    what: "The left menu is grouped into Work (Dashboard, Sales, Conversations, WhatsApp, Field Force), Grow (Marketing, Automation & AI, Store, Customer care), Insights (Reports), Help and Admin (Settings). The top bar has search, Quick Create, Help & Guides, wallet, notifications and your profile.",
    steps: [
      "Use the search box at the top of the left menu to find any page by name (e.g. type \"tasks\" or \"allocation\").",
      "Press **Ctrl + K** (or the search button in the top bar) to search leads, customers and pages.",
      "Click **Quick Create** (+) in the top bar for shortcuts: New lead, Import, Send WhatsApp, New task, Check in, Add expense, Upload document and more.",
      "Press **?** or click the help icon to open **Help & Guides**. Its **Ask AI** tab answers any \"how do I…\" question.",
      "The bell shows your notifications (new leads, follow-up reminders, alerts).",
      "Set your availability (Available / Away / Offline) in the top bar so smart allocation skips you when you are away.",
      "The menu button collapses the sidebar; on mobile it opens the menu.",
    ],
    keywords: "menu sidebar search ctrl k quick create shortcut bell notification availability away busy help" },
  { id: "day-brief", cat: "Getting started", icon: "sparkle", href: "/dashboard", title: "Day brief after login",
    what: "When you log in, a popup shows your numbers for today: follow-ups due, overdue items, new leads and (for leaders) the team panel.",
    steps: [
      "Log in. The day brief opens automatically.",
      "Click an item to open that lead or list.",
      "Close it to continue; it comes back on your next login.",
    ],
    keywords: "login popup brief good morning today summary" },
  { id: "mobile-app", cat: "Getting started", icon: "phone", href: "/calls", title: "Mobile app (Android)",
    what: "The Lead Box Android app gives the full CRM on the phone, plus automatic call logging and recordings.",
    steps: [
      "Install the Lead Box app on the Android phone and sign in with your CRM login.",
      "Allow call access once when asked, so calls are saved on the lead.",
      "After an outgoing call the app asks for the outcome; pick it so the history stays complete.",
      "See all calls in [Calls](/calls).",
    ],
    keywords: "android app mobile phone install play store apk" },

  // ───────── Leads & sales ─────────
  { id: "add-lead", cat: "Leads & sales", icon: "plus", href: "/leads/new", title: "Add a new lead",
    what: "Create a lead by hand. The phone number is normalised and checked for duplicates in your company.",
    steps: [
      "Go to [New lead](/leads/new) (or Quick Create → New lead, or **Create lead** on the Leads page).",
      "Enter name and mobile number (with country code if outside India).",
      "Pick source, product, status, priority and owner (leave owner empty to use auto-allocation).",
      "Fill any custom fields and click **Create lead**.",
      "If the number already exists you see the existing lead; you can still create a repeat opportunity for the same customer.",
    ],
    keywords: "create lead add new enquiry manual naya lead kaise banaye" },
  { id: "leads-list", cat: "Leads & sales", icon: "list", href: "/leads", title: "Leads list: filters, saved tabs, columns",
    what: "All leads you can see, with status cards, filters, saved views, customisable columns and sorting.",
    steps: [
      "Open [Leads](/leads). Status cards at the top show counts; click a card to filter by that status. Use **Pin statuses** to choose which cards show.",
      "Use the filters (status, sub-status, owner, team, source, product, tag, priority, AI score, follow-up, Seen by owner) and the search box.",
      "Quick tabs: Due today, Overdue, Untouched, Stale 14d+, Unassigned, Hot + warm. Click **Save current filters as a tab** to keep your own view.",
      "Click **Customize Table** to show, hide and reorder columns (Sub-status, Remark, AI score, Next follow-up…).",
      "Click a column header to sort. Change rows per page at the bottom.",
      "Click a row to open the lead; the WhatsApp icon opens its chat in a popup.",
      "Click **Export / Download** to download the filtered leads as CSV.",
    ],
    tips: ["Agents see only their own leads, team leaders their teams, admins everyone."],
    keywords: "filter search sort columns customize table saved view tab status cards pin seen unseen" },
  { id: "inline-edit", cat: "Leads & sales", icon: "pencil", href: "/leads", title: "Change status, follow-up or remark from the list",
    what: "Update a lead without opening it: status, sub-status, next follow-up and remark are editable in the table.",
    steps: [
      "In [Leads](/leads), click the status cell of a row and pick the new status (and sub-status).",
      "Click the next follow-up cell to set or change the date and time.",
      "Click **Add a remark** to save a note on the lead.",
      "Moving to Lost asks for a reason.",
    ],
    keywords: "inline edit quick status update remark follow up date" },
  { id: "bulk-actions", cat: "Leads & sales", icon: "layers", href: "/leads", title: "Bulk actions on leads",
    what: "Select many leads and change owner, status, tags or priority, send a WhatsApp template, or delete them together.",
    steps: [
      "In [Leads](/leads), tick the checkbox on rows (or the header checkbox for the whole page).",
      "The bulk bar appears: pick **Assign**, **Status**, **Sub-status**, **Tags**, **Priority**, **WhatsApp** (send a template) or **Delete**.",
      "Confirm. A message shows how many leads were updated.",
      "Deleted leads go to **Show deleted leads**, where admins can restore them.",
    ],
    keywords: "bulk select multiple assign transfer many leads delete restore priority" },
  { id: "lead-detail", cat: "Leads & sales", icon: "user", href: "/leads", title: "Working a lead (lead page)",
    what: "The lead page has details, status and next action, follow-ups, tasks, chats, quotes, payments, journeys, custom fields and the full history.",
    steps: [
      "Open a lead from [Leads](/leads).",
      "In **Sales status & next action**, set the status and schedule the next follow-up (open leads must always have one).",
      "Click **Log activity** to record a call, meeting or note.",
      "Click **Open chat** to message the customer on WhatsApp.",
      "Use **Edit** on Lead details to change name, product, values, owner or custom fields.",
      "Create a quotation, invoice or payment link from the lead (see Quotes & Invoices).",
      "Scroll down for tasks, journeys, other opportunities of the same customer and the History timeline.",
    ],
    keywords: "lead page detail open lead history timeline log activity next action expected value" },
  { id: "followups", cat: "Leads & sales", icon: "calendar", href: "/followups", title: "Follow-ups and reminders",
    what: "Every scheduled follow-up in one list. Reminders arrive 15 minutes before; a missed follow-up alerts you again.",
    steps: [
      "Schedule a follow-up from a lead (**Schedule follow-up**) or from the Leads list.",
      "Open [Follow-ups](/followups) to see Today, Overdue and Upcoming.",
      "Click **Mark done** after you finish it, then set the next one on the lead.",
      "You get a bell notification (and phone push / WhatsApp if your admin turned them on) 15 minutes before it is due.",
    ],
    tips: ["Admins set missed follow-up alerts in [Follow-up alerts](/admin/alerts)."],
    keywords: "follow up reminder callback schedule overdue due today alarm" },
  { id: "tasks", cat: "Leads & sales", icon: "check", href: "/tasks", title: "Tasks",
    what: "To-dos for yourself or teammates, optionally linked to a lead, with priority, due date and status.",
    steps: [
      "Open [Tasks](/tasks) and click **Add task** (or Quick Create → New task).",
      "Write the title, pick who it is for, due date, priority and (optional) the lead.",
      "Change status from the row (Open → In progress → Done) or select several and use **Change status** / **Reassign to…**.",
      "Use Filters and **Customize Table** to change what you see.",
    ],
    keywords: "task todo assign work kaam reminder" },
  { id: "calls", cat: "Leads & sales", icon: "phone", href: "/calls", title: "Call log and recordings",
    what: "Calls made and received on the Lead Box mobile app are saved on the lead automatically.",
    steps: [
      "Install the Lead Box Android app and allow call access once.",
      "Call customers from the phone as usual; each call is matched to the lead by number.",
      "After an outgoing call, choose the outcome the app asks for.",
      "Open [Calls](/calls) to see All calls and By user, filtered by date and person.",
    ],
    tips: ["Recording upload needs the permission \"upload call recordings\" given by an admin."],
    keywords: "call log calling recording dialer phone tracking" },
  { id: "customers", cat: "Leads & sales", icon: "user", href: "/customers", title: "Customer 360",
    what: "One page per customer with all their chats, leads, notes, follow-ups, consent and timeline.",
    steps: [
      "Open [Customers 360](/customers) and search by name or phone.",
      "Click a customer to see every lead (opportunity), WhatsApp chat, note and follow-up.",
      "Record WhatsApp opt-in or opt-out under **WhatsApp consent**.",
    ],
    keywords: "customer profile 360 contact history consent opt in" },
  { id: "import", cat: "Leads & sales", icon: "upload", href: "/import", title: "Import leads from Excel / CSV",
    what: "Upload a sheet of leads. Columns are mapped, duplicates are found, then leads are created.",
    steps: [
      "Open [Import](/import) and click **Download sample file** to see the format.",
      "Upload your Excel or CSV file.",
      "Map each column (name, phone, source, product, owner email, tags…).",
      "Choose **Skip numbers already in CRM** or **Create repeat opportunities for them**, and whether to **Auto-allocate rows without an owner**.",
      "Check the preview, then import. The summary shows created, duplicates skipped and errors.",
    ],
    keywords: "import excel csv upload sheet bulk upload leads data" },
  { id: "duplicates", cat: "Leads & sales", icon: "layers", href: "/leads/duplicates", access: "admin", title: "Merge duplicate leads",
    what: "Leads with the same phone number, merged into one so history is not split.",
    steps: [
      "Open [Duplicate leads](/leads/duplicates).",
      "Pick a phone number group, choose the lead to keep.",
      "Click merge. History, notes, follow-ups, tags, tasks and chats move to the kept lead; its empty fields are filled from the others.",
    ],
    keywords: "duplicate merge same number dedupe double lead" },
  { id: "allocation", cat: "Leads & sales", icon: "refresh", href: "/admin/allocation", access: "admin", title: "Lead allocation (who gets new leads)",
    what: "Per source (and per city), pick users, a ratio and a max per day. New leads are shared between them automatically.",
    steps: [
      "Open [Lead allocation](/admin/allocation).",
      "For each lead source (WhatsApp, Facebook, Website, Others…), click the row and add users with a ratio (e.g. 2:1) and **Max / day**.",
      "Optional: add a **City-wise allocation** list (e.g. Jaipur → Jaipur team). City lists are checked first.",
      "Save. Users who are switched off, away or at their daily max are skipped.",
    ],
    tips: ["Mark a user \"Eligible for automatic round-robin allocation\" in [Users](/admin/users)."],
    keywords: "allocation round robin assign auto automatically distribute divide share baante baant team ratio max per day city wise lead kisko jaye" },
  { id: "ai-score", cat: "Leads & sales", icon: "sparkle", href: "/leads", plan: "ai", title: "AI lead score (Hot / Warm / Cold)",
    what: "AI reads the WhatsApp chat and rates each lead Hot, Warm or Cold with a reason and the next step.",
    steps: [
      "Admin: turn on **Auto AI lead score** in [Settings](/admin/settings) (AI must be enabled for the company).",
      "Leads with chats are scored automatically; on a lead page click the AI score card to score it now.",
      "Filter or sort [Leads](/leads) by AI score (Any AI score → Hot / Warm / Cold).",
    ],
    keywords: "ai score hot warm cold rating priority intelligence" },
  { id: "leaderboard", cat: "Leads & sales", icon: "trophy", href: "/leaderboard", title: "Leaderboard and targets",
    what: "Monthly ranking of agents by targets, revenue, won leads, conversion and first-reply time.",
    steps: [
      "Open [Leaderboard](/leaderboard).",
      "Admins and team leaders click **Set targets** to set each person's monthly leads / revenue target.",
      "Compare won leads, revenue, conversion, follow-ups done on time and median first reply time.",
    ],
    keywords: "leaderboard ranking target performance agents best" },

  // ───────── WhatsApp & inbox ─────────
  { id: "inbox", cat: "WhatsApp & inbox", icon: "inbox", href: "/inbox", title: "Inbox: chat with customers",
    what: "All WhatsApp chats you can access, with templates, files, notes, transfer, AI replies and lead linking.",
    steps: [
      "Open [Inbox](/inbox) and pick a chat (filter by number, tag, Open/Pending/Resolved).",
      "Type and send. Inside 24 hours of the customer's last message you can send free text; after that click **Send template**.",
      "Type **/** to use a quick reply.",
      "Attach a file from your device, or **Select from Documents** to send a brochure or price list.",
      "Tick **Team note** for a note only your team sees; type **@** to mention a teammate.",
      "Click **Transfer** to move the chat to another agent (a reason is needed).",
      "Click **Create / link lead** to connect the chat to a lead; set the chat to Pending or Resolved when done.",
      "Use **AI assist** for a summary or 3 ready reply suggestions (you still edit and send).",
    ],
    tips: ["Files up to 100 MB can be sent from the inbox.", "Send a Razorpay payment link right from the chat."],
    keywords: "inbox chat reply whatsapp message customer conversation transfer note attachment template 24 hour" },
  { id: "live-chat", cat: "WhatsApp & inbox", icon: "chat", href: "/whatsapp/live-chat", title: "Live chat board",
    what: "Open conversations, customers waiting for a reply, unassigned chats and who is handling each.",
    steps: [
      "Open [Live chat](/whatsapp/live-chat).",
      "Check \"customers waiting for a reply\" and \"nobody owns these yet\" first.",
      "Click a conversation to open it in the Inbox and reply.",
    ],
    keywords: "live chat waiting unassigned agents online" },
  { id: "wa-connect", cat: "WhatsApp & inbox", icon: "plug", href: "/whatsapp/connections", access: "admin", title: "Connect a WhatsApp number (Cloud API)",
    what: "Connect your official WhatsApp Business number so messages come into the CRM.",
    steps: [
      "In Meta for Developers create a **Business** app and add the **WhatsApp** product.",
      "Copy the App ID and App Secret into **Meta app credentials** in [WhatsApp Cloud API](/admin/integrations).",
      "In Meta → WhatsApp → Configuration paste the Callback URL and Verify token shown on that page, verify and subscribe **messages**.",
      "In Business Settings → System users create a system user and generate a permanent token (whatsapp_business_messaging + whatsapp_business_management).",
      "In [Connections](/whatsapp/connections) click **Connect number** and enter Phone number ID, WABA ID and the token.",
      "Click **Subscribe webhook** and **Sync templates** in [WhatsApp numbers](/admin/numbers).",
      "Send a WhatsApp to the number; it should appear in the Inbox.",
    ],
    tips: ["Or use **Connect with Facebook** (embedded signup) on the Integrations page if it is set up.", "Choose which teams/users may use each number in [WhatsApp numbers](/admin/numbers)."],
    keywords: "connect whatsapp number cloud api meta waba token webhook setup integrate number kaise jode" },
  { id: "templates", cat: "WhatsApp & inbox", icon: "template", href: "/whatsapp/templates", title: "Message templates",
    what: "Meta-approved messages needed to start a chat or reply after 24 hours.",
    steps: [
      "Open [Templates](/whatsapp/templates) to see approved, pending and rejected templates.",
      "Admins: to create one, go to [Admin templates](/admin/templates) → **Submit a template to Meta**, fill name, category (Utility / Marketing), language and text, then **Submit for review**.",
      "Or create it in WhatsApp Manager and click **Sync templates**.",
      "Once APPROVED, click **Send this** or pick it in the Inbox / Broadcast.",
    ],
    tips: ["MARKETING templates are blocked for customers who opted out."],
    keywords: "template approve meta create submit 24 hour utility marketing" },
  { id: "send", cat: "WhatsApp & inbox", icon: "send", href: "/whatsapp/send", title: "Send a single WhatsApp message",
    what: "Send a template or free text to any number.",
    steps: [
      "Open [Send](/whatsapp/send).",
      "Pick the number to send from, enter the customer's phone.",
      "Choose **Template** (any time) or **Free text** (only within 24 hours of their last message).",
      "Click **Send message**. A new number becomes a contact and a lead automatically.",
    ],
    keywords: "send message single whatsapp one number" },
  { id: "broadcast", cat: "WhatsApp & inbox", icon: "megaphone", href: "/whatsapp/broadcast", title: "WhatsApp broadcast to leads",
    what: "Send a template to many leads picked by status, tag, source, owner and more, with a delivery report.",
    steps: [
      "Open [Broadcast](/whatsapp/broadcast).",
      "Step 1 \"Who should get it\": pick statuses, tags, sources, owners, created in last N days; optionally include closed leads.",
      "Step 2 \"Message\": pick the sending number and an approved template, fill variables.",
      "Send now. Track sent, delivered, read and replies in [Campaigns](/whatsapp/campaigns); open a campaign to see failures and why.",
    ],
    tips: ["Opted-out customers are skipped automatically.", "You can also select leads in [Leads](/leads) and use the bulk bar to send a template."],
    keywords: "broadcast bulk whatsapp mass message send to all leads blast" },
  { id: "contacts", cat: "WhatsApp & inbox", icon: "contacts", href: "/whatsapp/contacts", title: "WhatsApp contacts",
    what: "Everyone you can message: add one, import a CSV, tag them and see opt-in.",
    steps: [
      "Open [Contacts](/whatsapp/contacts).",
      "Click **Add contact** or **Import CSV**; inbound messages also create contacts.",
      "Filter by tag and opt-in; click **New group (segment)** to save an audience.",
    ],
    keywords: "contacts phonebook import csv tag opt in" },
  { id: "wa-settings", cat: "WhatsApp & inbox", icon: "gear", href: "/whatsapp/settings", title: "WhatsApp settings: hours, agents, auto-assign, tags",
    what: "Business hours, away message, live chat agents, auto-assign rules, chat tags, canned replies, STOP handling and diagnostics.",
    steps: [
      "Open [WhatsApp settings](/whatsapp/settings).",
      "Set **Business hours** (used by the away message and chatbot \"inside/outside hours\" rules).",
      "Add **Live chat agents** and set **Auto-assign rules** (e.g. chats from a number or with a keyword go to a team). Without rules, new chats use round-robin.",
      "Manage chat **Tags** and **Canned replies**; check **Diagnostics** for failed sends and webhook health.",
      "Click **Save preferences**.",
    ],
    keywords: "business hours away message auto assign rules agents tags canned replies diagnostics stop opt out" },
  { id: "wa-reports", cat: "WhatsApp & inbox", icon: "chart", href: "/whatsapp/reports", title: "WhatsApp reports",
    what: "Messages per day, delivery funnel, busiest hours, failures, credits, numbers, agents, bots and templates.",
    steps: ["Open [WhatsApp reports](/whatsapp/reports), pick the date range and click **Apply**.", "Check \"Why sends failed\" to fix template or number problems."],
    keywords: "whatsapp report delivery read failed credits analytics" },
  { id: "wallet", cat: "WhatsApp & inbox", icon: "wallet", href: "/wallet", title: "Wallet: add WhatsApp message balance",
    what: "WhatsApp template messages are paid from the company wallet. Add balance by UPI.",
    steps: [
      "Click the wallet chip in the top bar or open [Wallet](/wallet).",
      "Enter an amount and pay to the UPI ID shown.",
      "Enter the 12-digit UTR from your UPI app and submit. Balance is added after verification.",
    ],
    keywords: "wallet balance recharge top up upi payment credits utr" },

  // ───────── Automation & AI ─────────
  { id: "chatbots", cat: "Automation & AI", icon: "bot", href: "/whatsapp/chatbots", title: "Keyword chatbots (auto-replies)",
    what: "Instant replies when a message contains a word like \"price\", \"hi\" or \"timing\", 24×7.",
    steps: [
      "Open [Chatbots](/whatsapp/chatbots) and start from the library or create a new keyword bot.",
      "Enter the keyword(s) and choose match type: contains the word, starts with it, or whole message.",
      "Write the reply (text, media or buttons) and optionally limit to inside / outside business hours.",
      "Use **Test a message** to check which bot answers.",
      "Check **Unmatched questions** and turn common ones into bots.",
    ],
    keywords: "chatbot bot auto reply keyword automatic answer 24x7" },
  { id: "flows", cat: "Automation & AI", icon: "flow", href: "/whatsapp/flows", title: "Chatbot flow builder (visual)",
    what: "Drag-and-drop chatbot with buttons, list menus, questions, media, conditions, tags and hand-off to an agent.",
    steps: [
      "Open [Flows](/whatsapp/flows) → **New chatbot flow** (start from scratch or an idea).",
      "Set the trigger: any message, keywords, new contact, or off.",
      "Drag blocks from the palette (Message, Buttons, List, Question, Condition, Tag, Assign, Template…) and connect ports by dragging.",
      "Click **Simulate** to test the conversation.",
      "Fix red items in **Validation**, set the flow **Active** and save.",
    ],
    tips: ["Flows run before keyword bots. When several match, the lowest order number wins.", "Use **Export JSON / Import JSON** to copy a flow."],
    keywords: "flow builder chatbot visual drag drop buttons menu question" },
  { id: "drip", cat: "Automation & AI", icon: "clock", href: "/nurture/drip", plan: "nurture", title: "Drip campaigns (day-wise follow-up)",
    what: "Day-wise WhatsApp templates (Day 0 welcome, Day 1 brochure, Day 3 offer…) that start automatically.",
    steps: [
      "Open [Drip campaigns](/nurture/drip) → **Create a drip**.",
      "Name it and choose **Start when**: a new lead is created, or a lead moves to a status (optionally only from one source).",
      "Pick the sending number and add messages with the day number and approved template.",
      "Choose stop rules: stop when status changes, pause when the customer replies; optional task for the owner at the end.",
      "Save and turn it on. It always stops when the lead is won, lost or raises a complaint.",
    ],
    keywords: "drip day wise sequence automatic follow up messages nurture" },
  { id: "journeys", cat: "Automation & AI", icon: "flow", href: "/nurture/journeys", plan: "nurture", title: "Nurturing journeys",
    what: "Automated sequences of template messages, agent tasks, waits and branches, triggered by status, segment or conversion.",
    steps: [
      "Open [Journeys](/nurture/journeys) → New journey.",
      "Set the trigger (status category, product, source, segment, days after conversion) and priority.",
      "Add steps: message (approved template, optional offer), task for the lead owner, wait, branch.",
      "Click **Preview & publish** to check who it reaches and publish a version.",
      "Watch runs in the [Execution log](/nurture/logs).",
    ],
    keywords: "journey nurture sequence automation workflow" },
  { id: "ai-assist", cat: "Automation & AI", icon: "sparkle", href: "/inbox", plan: "ai", title: "AI replies and chat summary",
    what: "AI summarises a chat and suggests 3 replies using only your approved knowledge.",
    steps: [
      "Admin: enable **AI summaries & suggested replies** in [Settings](/admin/settings).",
      "Add product, price and policy facts in [AI knowledge](/nurture/knowledge) and approve them.",
      "In the [Inbox](/inbox), open a chat and click **AI assist** → summary or AI replies.",
      "Click **Use as draft**, edit if needed and send.",
    ],
    keywords: "ai reply suggestion summary assist knowledge gpt claude" },
  { id: "team-notes", cat: "WhatsApp & inbox", icon: "chat", href: "/inbox", title: "Team notes and @mentions in chats",
    what: "Write notes inside a customer chat that only your team sees, and @mention a teammate so they get a notification.",
    steps: [
      "Open a chat in the [Inbox](/inbox) and tick **Team note** under the message box.",
      "Type **@** (or click the **@** button) and pick a teammate, then write the note and click **Add note**.",
      "The note shows in the chat in yellow. It is never sent to the customer.",
      "The teammate gets a bell + phone notification. They see all their mentions under **@ Mentions** at the top of the Inbox.",
      "If the chat is not assigned to them, they see only the team notes (not the customer's messages) and can reply with a note.",
    ],
    keywords: "internal note mention tag teammate colleague comment private note collaborate" },
  { id: "sales-forecast", cat: "Automation & AI", icon: "sparkle", href: "/forecast", access: "reports", title: "AI sales forecast",
    what: "Product-wise sales expected next month (or this whole month) from your won leads, paid invoices, store orders and open Hot/Warm leads.",
    steps: [
      "Open [AI sales forecast](/forecast). Choose **Next month** or **This month** at the top.",
      "The table shows each product's last 3 months, this month so far, open pipeline and a trend forecast (works without AI).",
      "Click **Run AI forecast** for an AI forecast per product with a low-high range, confidence, reason and tips.",
      "Add a product on your leads so won leads count under the right product.",
    ],
    tips: ["Sales are counted once: paid invoices, then store orders, then won leads without an invoice or order."],
    keywords: "forecast prediction next month sales projection product wise target estimate" },
  { id: "ai-knowledge", cat: "Automation & AI", icon: "book", href: "/nurture/knowledge", plan: "nurture", title: "AI knowledge",
    what: "Facts the AI may use in suggested replies. Only APPROVED entries are used.",
    steps: ["Open [AI knowledge](/nurture/knowledge) and add an entry (title + facts).", "Click **Approve**. Editing returns it to draft until re-approved."],
    keywords: "knowledge base faq facts ai training" },
  { id: "nurture-queue", cat: "Automation & AI", icon: "alert", href: "/nurture", plan: "nurture", title: "Action queues and SLA",
    what: "Leads that need action: SLA breached, escalated, unassigned or missing a next action.",
    steps: [
      "Open [Action queues](/nurture).",
      "For each item click **Respond**, **Set next action**, **Assign to…** or **Dismiss**.",
      "Admins can **Pause all automation** here in an emergency and **Resume** later.",
    ],
    tips: ["SLA times and \"Require a next action\" are set in [Settings](/admin/settings) → Nurturing & SLA policy."],
    keywords: "sla queue escalation pending action pause automation" },

  // ───────── Marketing ─────────
  { id: "campaigns", cat: "Marketing", icon: "megaphone", href: "/nurture/campaigns", plan: "nurture", title: "Campaigns with approval",
    what: "One-off sends of an approved template to a segment: draft → approval → scheduled send.",
    steps: [
      "Create a [segment](/nurture/segments) first.",
      "Open [Campaigns](/nurture/campaigns), choose segment, number and template, **Save draft**.",
      "Open it and click **Submit for approval**; an approver clicks **Approve & schedule** with the send time.",
      "See delivery, replies, conversions and revenue on the campaign page.",
    ],
    keywords: "campaign marketing approval schedule segment send" },
  { id: "segments", cat: "Marketing", icon: "layers", href: "/nurture/segments", plan: "nurture", title: "Customer segments",
    what: "Reusable audiences (by status, product, source, purchase, priority or CSV list) for campaigns and journeys.",
    steps: ["Open [Segments](/nurture/segments).", "Pick the conditions or upload a CSV list, check the live count and **Save segment**."],
    keywords: "segment audience group list filter customers" },
  { id: "offers", cat: "Marketing", icon: "gift", href: "/nurture/offers", plan: "nurture", title: "Offers",
    what: "Discounts used in journeys and campaigns. Only approved offers inside their validity window are sent.",
    steps: ["Open [Offers](/nurture/offers), add the offer with validity dates and **Save draft**.", "Click **Approve**."],
    keywords: "offer discount coupon validity" },
  { id: "consent", cat: "Marketing", icon: "shield", href: "/nurture/consent", plan: "nurture", title: "Consent and opt-out",
    what: "Automation only messages customers with WhatsApp opt-in. STOP opts out, START opts back in.",
    steps: [
      "Record opt-in on a customer's [Customer 360](/customers) page.",
      "Open [Consent & suppression](/nurture/consent) to see history and add numbers to the suppression list.",
    ],
    keywords: "consent opt in opt out stop unsubscribe suppression dnd" },
  { id: "performance", cat: "Marketing", icon: "chart", href: "/nurture/performance", plan: "nurture", title: "Journey & campaign performance",
    what: "Messaged, replied, converted and revenue per journey and campaign for the last 90 days.",
    steps: ["Open [Performance](/nurture/performance) and compare reply rate and conversions."],
    keywords: "performance roi conversions campaign result" },
  { id: "fb-ads", cat: "Marketing", icon: "facebook", href: "/admin/fb-login", access: "admin", plan: "fb_leads", title: "Facebook / Instagram Lead Ads",
    what: "Leads from your Facebook and Instagram lead forms come into the CRM automatically.",
    steps: [
      "Save the Meta App ID and App Secret in [WhatsApp Cloud API](/admin/integrations) → Meta app credentials.",
      "Open [Facebook Lead Ads](/admin/fb-login) and click **Connect Facebook**.",
      "Select the Ad account and the Pages to receive leads from.",
      "Optional: turn on **Process FB Leads only for Selected Pages and Ads** and pick specific ads.",
      "New leads arrive with source Facebook and are allocated by your allocation rules.",
    ],
    keywords: "facebook instagram lead ads meta form fb leads connect page" },

  // ───────── Customer care & store ─────────
  { id: "store", cat: "Customer care & store", icon: "cart", href: "/store", title: "WhatsApp mini-store and orders",
    what: "Your catalog as a shop link. Customers order from WhatsApp; orders land here and on the lead.",
    steps: [
      "Admin: set up the store once in [Store settings](/store/settings) (name, delivery address, auto-reply store link) and **Save store**.",
      "Add products with price and photo in [Store products](/store/products) and switch on **Show in store**.",
      "Share the store link on WhatsApp (in the inbox type the store shortcut, or **Share on WhatsApp**).",
      "Manage orders in [Orders](/store): change order, payment and delivery status and click **Update customer on WhatsApp**.",
    ],
    keywords: "store shop catalog order ecommerce products mini store link" },
  { id: "appointments", cat: "Customer care & store", icon: "calendar", href: "/care/appointments", title: "Appointment booking",
    what: "Customers pick a free slot from a link. Each booking lands on their lead and in the owner's follow-ups.",
    steps: [
      "Admin: turn on the booking page and set working hours in [Care settings](/care/settings).",
      "Share the booking link with customers (or click **Book** to add one yourself).",
      "See bookings in [Appointments](/care/appointments).",
    ],
    keywords: "appointment booking slot calendar meeting visit schedule" },
  { id: "feedback", cat: "Customer care & store", icon: "heart", href: "/care/feedback", title: "Feedback and NPS",
    what: "After a deal is Won, customers are asked \"How likely are you to recommend us?\" (0–10). Unhappy answers alert the owner.",
    steps: ["Admin: turn it on in [Care settings](/care/settings) and **Save feedback settings**.", "See scores and comments in [Feedback & NPS](/care/feedback)."],
    keywords: "feedback nps rating review survey" },
  { id: "referrals", cat: "Customer care & store", icon: "gift", href: "/care/referrals", title: "Referral program",
    what: "Each customer gets a referral link. Friends who fill it become leads (source Referral); the reward is due when the friend's lead is Won.",
    steps: [
      "Admin: turn on referrals and set the reward in [Care settings](/care/settings).",
      "Share a customer's link from their lead, or add \"referred by\" on a lead.",
      "In [Referrals](/care/referrals) see top referrers and click **Mark rewarded** after paying.",
    ],
    keywords: "referral refer friend reward" },
  { id: "portal", cat: "Customer care & store", icon: "globe", href: "/care/settings", access: "admin", title: "Customer portal",
    what: "A private link per customer showing their quotations, invoices, payment links, orders and appointments.",
    steps: ["Turn on the portal in [Care settings](/care/settings) and **Save portal settings**.", "Send the portal link from any lead page."],
    keywords: "customer portal self service link" },
  { id: "documents", cat: "Customer care & store", icon: "files", href: "/documents", title: "Documents library",
    what: "Company files (catalogues, price lists, brochures) to send from the inbox.",
    steps: [
      "Open [Documents](/documents) and click add; choose a file (PDF, image, video, Excel…) and a description.",
      "In the [Inbox](/inbox), click **Select from Documents** to send it to a customer.",
    ],
    keywords: "documents files brochure pdf catalogue price list upload" },

  // ───────── Money ─────────
  { id: "quotes", cat: "Money", icon: "rupee", href: "/quotes", title: "Quotations and invoices",
    what: "Make GST quotations and invoices from a lead, send them on WhatsApp as PDF, convert quotes to invoices.",
    steps: [
      "Admin (once): add company details and tax in [Quote settings](/settings/quotes).",
      "Open a lead and click to create a quotation (or [New quote](/quotes/new)).",
      "Add items with rate, quantity, tax and discount; save.",
      "Click **Send on WhatsApp now** or **Download PDF**.",
      "When the customer agrees mark **Customer accepted**, then **Convert to invoice**.",
      "See all in [Quotes & Invoices](/quotes).",
    ],
    keywords: "quotation quote invoice bill gst pdf estimate" },
  { id: "payment-links", cat: "Money", icon: "rupee", href: "/quotes", title: "Razorpay payment links",
    what: "Collect payment with a Razorpay link from a lead, quote or chat. Paid status updates automatically.",
    steps: [
      "Admin: add Razorpay keys and webhook in [Quote settings](/settings/quotes).",
      "On a lead or quote, create a **Payment link** with the amount; or in the Inbox use **Send Razorpay payment link**.",
      "Share it on WhatsApp. When paid, the lead's payment updates (and status can move to Won automatically).",
    ],
    keywords: "payment link razorpay collect money upi pay online" },
  { id: "profit-loss", cat: "Money", icon: "rupee", href: "/profit-loss", access: "admin", title: "Profit & Loss",
    what: "Sales vs ad cost by source: Meta ad spend is pulled automatically, other costs and sales added by hand.",
    steps: [
      "Open [Profit & Loss](/profit-loss) and pick the period.",
      "Click **Connect Facebook** (or **Pull Meta spend now**) to bring Meta ad spend.",
      "Add Google/offline ad cost and sales not in the CRM under **Ad cost & sale entries**.",
      "Read **Source-wise profit** to see which source makes money.",
    ],
    keywords: "profit loss p&l roi ad spend cost revenue" },

  // ───────── Team & field ─────────
  { id: "field-app", cat: "Team & field", icon: "pin", href: "/field", title: "Field app: check in, visits, expenses",
    what: "For field staff: GPS check-in/out, visit reports, expense claims and quick leads. Works without network.",
    steps: [
      "Open [Field app](/field) on the phone and tap **Check in** (allow location).",
      "At a customer, start a **Field visit**, write how it went, add photo and next follow-up.",
      "Tap **Add expense claim** with amount, distance and bill photo.",
      "Tap **Check out** at the end of the day.",
      "No network? Everything is saved on the phone and sent when you are back online (**Send now**).",
    ],
    keywords: "field attendance check in check out gps visit expense offline sales executive" },
  { id: "attendance", cat: "Team & field", icon: "clock", href: "/field/attendance", title: "Attendance report",
    what: "Check-in and check-out times with location, one line per person per day.",
    steps: ["Open [Attendance](/field/attendance), pick dates and person, click **Apply**.", "Click the map link to see where they checked in/out."],
    keywords: "attendance present hours report" },
  { id: "expenses", cat: "Team & field", icon: "rupee", href: "/field/expenses", title: "Expense approval",
    what: "Expense claims from the field app with receipts, for approval and payment.",
    steps: ["Open [Expenses](/field/expenses).", "Check the receipt and click **Approve** (or **Approve all shown**), then **Mark paid** after paying."],
    keywords: "expense claim approve reimbursement travel fuel" },
  { id: "visits", cat: "Team & field", icon: "pin", href: "/field/visits", title: "Field visits report",
    what: "Visits with location, outcome and report; also shown on each lead's timeline.",
    steps: ["Open [Field visits](/field/visits), filter by date and person, click **Apply**."],
    keywords: "visit report meeting location" },
  { id: "users", cat: "Team & field", icon: "contacts", href: "/admin/users", access: "admin", title: "Add users and set roles",
    what: "Create logins, set role, team, permissions, working hours and allocation limits.",
    steps: [
      "Open [Users](/admin/users) → **+ Add user**.",
      "Enter name, email or User ID, role (Company Admin, Team Leader, Agent), branch / department / team.",
      "Set a password (**Generate strong password**) or send an email invitation.",
      "Tick **Eligible for automatic round-robin allocation** if they should get new leads; set working hours.",
      "To stop access click **Deactivate** (history is kept).",
    ],
    keywords: "add user employee staff login create agent password role deactivate" },
  { id: "roles", cat: "Team & field", icon: "shield", href: "/admin/roles", access: "admin", title: "Roles and permissions",
    what: "Choose what Agents and Team Leaders can do. Enforced by the database, not just hidden buttons.",
    steps: ["Open [Roles & permissions](/admin/roles).", "Tick or untick each permission for Team Leader and Agent and **Save permissions**.", "Give one person extra permissions from [Users](/admin/users)."],
    keywords: "permission role access rights agent team leader" },
  { id: "org", cat: "Team & field", icon: "building", href: "/admin/org", access: "admin", title: "Branches, departments and teams",
    what: "Company → Branch → Department → Team → Users.",
    steps: ["Open [Organisation](/admin/org).", "Add branches, departments and teams; assign users to teams in [Users](/admin/users).", "Deactivate instead of deleting to keep history."],
    keywords: "branch department team organisation structure" },

  // ───────── Reports ─────────
  { id: "dashboard", cat: "Reports", icon: "grid", href: "/dashboard", title: "Dashboard",
    what: "Summary, lead funnel, opportunity funnel, lead trend, sources, WhatsApp messages, calls, tasks and team activity.",
    steps: ["Open [Dashboard](/dashboard) and pick the period.", "Click a funnel or source to open the matching leads."],
    keywords: "dashboard home summary funnel trend analytics" },
  { id: "lead-reports", cat: "Reports", icon: "chart", href: "/lead-reports", title: "Lead reports",
    what: "Leads by status, conversion rate (cohort), user performance and won value.",
    steps: ["Open [Lead Reports](/lead-reports), pick period and filters.", "Read **Metric definitions** to understand each number."],
    keywords: "lead report conversion user performance status wise" },
  { id: "reports-360", cat: "Reports", icon: "chart", href: "/reports", access: "reports", title: "360 Reports",
    what: "Created vs converted by day, cohort conversion and won value by source, team and owner.",
    steps: ["Open [360 Reports](/reports) and set filters."],
    keywords: "360 report cohort converted won value" },
  { id: "digest", cat: "Reports", icon: "mail", href: "/nurture/digest", plan: "nurture", title: "Manager digest",
    what: "A daily summary for managers of what needs attention.",
    steps: ["Open [Digest](/nurture/digest) to see the latest and past digests."],
    keywords: "digest daily summary manager email" },

  // ───────── Settings & admin ─────────
  { id: "settings-hub", cat: "Settings & admin", icon: "gear", href: "/settings", access: "admin", title: "Settings hub (all settings on one screen)",
    what: "Every admin setting grouped in cards: Company & team, Leads, Sales & store, WhatsApp, Integrations.",
    steps: [
      "In the menu open **Settings → All settings** (or go to [Settings](/settings)).",
      "Pick a card: e.g. Users, Manage Status, Lead allocation, Quotes & Payments, WhatsApp numbers, Lead sources, API & webhooks.",
      "Inside any settings page, the list on the left lets you jump to another setting.",
      "Tip: type the setting's name in the menu search box to open it directly.",
    ],
    keywords: "settings admin manage configuration setup hub all settings" },
  { id: "lead-settings", cat: "Settings & admin", icon: "list", href: "/settings", access: "admin", title: "Lead settings: statuses, sources, tags, custom fields, forms",
    what: "Masters used across the CRM. All settings are on one screen: menu Settings → All settings.",
    steps: [
      "Open [Settings](/settings) (menu Admin → Settings → All settings) and look under **Leads**.",
      "[Statuses](/settings/statuses): add statuses with colour and sequence (drag to reorder) and sub-statuses (e.g. Not picked, Switched off).",
      "[Sources](/settings/sources): add or switch off lead sources.",
      "[Tags](/settings/tags) and [Departments](/settings/departments): add or edit.",
      "[Custom fields](/settings/custom-fields): add extra fields (text, number, date, choice), optionally required.",
      "[Forms](/settings/forms): make a lead capture form with its own link /f/CODE; submissions become leads.",
    ],
    keywords: "status source tag department custom field form master settings sub status" },
  { id: "products", cat: "Settings & admin", icon: "tag", href: "/admin/catalog", access: "admin", title: "Products and quick replies",
    what: "Products/services used on leads, and quick replies agents use with \"/\" in chat.",
    steps: ["Open [Products · Quick replies](/admin/catalog).", "Add products/services, then add quick replies (shortcut + text)."],
    keywords: "product service quick reply canned shortcut" },
  { id: "alerts", cat: "Settings & admin", icon: "alert", href: "/admin/alerts", access: "admin", title: "Follow-up alerts",
    what: "Alerts to agents when a follow-up is missed, and a daily missed list to admins and team leaders.",
    steps: [
      "Open [Follow-up alerts](/admin/alerts).",
      "Turn on **Missed follow-up alert** and pick channels (in-app always, phone push, WhatsApp template).",
      "Turn on **Daily missed list** and set the morning time; **Save alert settings**.",
    ],
    keywords: "alert missed follow up notification push reminder" },
  { id: "company-settings", cat: "Settings & admin", icon: "gear", href: "/admin/settings", access: "admin", title: "Company settings (automation, AI, SLA)",
    what: "Auto-create leads from chats, auto-allocate, AI features, SLA policy and digests.",
    steps: [
      "Open [Settings](/admin/settings).",
      "Turn on **Auto-create leads** and **Auto-allocate** for new chats.",
      "Enable AI summaries & suggested replies and **Auto AI lead score**.",
      "Set the Nurturing & SLA policy (first reply time, require a next action) and save.",
    ],
    keywords: "company settings automation ai sla auto create" },
  { id: "audit", cat: "Settings & admin", icon: "clock", href: "/admin/audit", access: "admin", title: "Audit log",
    what: "Who did what: admin and sensitive actions. Lead status/owner history is also on each lead.",
    steps: ["Open [Audit log](/admin/audit) and filter by person, action or date."],
    keywords: "audit log history who changed tracking" },
  { id: "billing", cat: "Settings & admin", icon: "rupee", href: "/billing", access: "admin", title: "Plan and billing",
    what: "Your Lead Box plan, trial and payment.",
    steps: ["Open [Billing](/billing) to see your plan and when it ends.", "Pick a plan and pay to extend access."],
    keywords: "billing plan subscription trial upgrade pay renew" },

  // ───────── Integrations ─────────
  { id: "lead-sources", cat: "Integrations", icon: "globe", href: "/admin/lead-sources", access: "admin", title: "Google Ads, IndiaMART, JustDial, website chat widget",
    what: "Leads from other platforms come straight into the CRM with the normal duplicate check and allocation.",
    steps: [
      "Open [Lead sources](/admin/lead-sources).",
      "Pick the source (Google Ads, IndiaMART, JustDial, Website chat widget, Other software) and follow **How to set up**.",
      "Copy the URL/key it gives you into that platform (IndiaMART: paste your CRM key for pull).",
      "For the website widget, set greeting, button text, WhatsApp number and position, then paste the code on your website.",
      "Turn on **Live (receive leads)** and test.",
    ],
    keywords: "google ads indiamart justdial website widget chat webhook zapier pabbly integration source" },
  { id: "api", cat: "Integrations", icon: "code", href: "/admin/api", access: "admin", title: "API keys and webhooks",
    what: "Create and read leads from your own software, and get a call on your URL when a lead changes.",
    steps: [
      "Open [API & webhooks](/admin/api) → **+ New API key**; copy it (shown once).",
      "Call the API with header Authorization: Bearer lbk_… (POST /leads to create, GET /leads to list). See **API guide** on the page.",
      "Click **+ Add webhook**, enter your https URL and events (lead created, assigned, status changed); use **Send test**.",
    ],
    keywords: "api key rest developer webhook integration zapier erp software" },

  // ───────── Platform (super admin) ─────────
  { id: "platform", cat: "Platform", icon: "building", href: "/platform", access: "super", title: "Companies (SaaS console)",
    what: "Every company using Lead Box: plan, access, usage and billing.",
    steps: [
      "Open [Companies](/platform) (menu Admin → Platform). **Add a company** creates the company and its admin login.",
      "Open a company to change plan, set trial, record a payment, suspend, add wallet balance or reset a user's password.",
      "Use the company switcher in the top bar to work inside a company; **Back** returns to yours.",
    ],
    keywords: "saas company tenant client add company suspend trial switch" },
  { id: "plans", cat: "Platform", icon: "list", href: "/platform/plans", access: "super", title: "Plans and pricing",
    what: "What you sell: price per user, free trial, limits and features.",
    steps: ["Open [Plans & pricing](/platform/plans), edit a plan's price, trial days, limits and features.", "Tick **Show on signup & billing pages** to offer it."],
    keywords: "plan pricing package limit feature" },
  { id: "wallet-payments", cat: "Platform", icon: "wallet", href: "/platform/wallet", access: "super", title: "Approve wallet payments",
    what: "Companies pay your UPI ID and submit the UTR; you approve to credit their wallet.",
    steps: ["Set your UPI ID in [Wallet payments](/platform/wallet).", "Match each UTR with your bank statement and click **Approve**."],
    keywords: "wallet payment approve utr upi" },
];

export type Viewer = { admin: boolean; superAdmin: boolean; reports: boolean; features: string[] };

/** Features this person can open (same rules as the sidebar). */
export function visibleFeatures(v: Viewer) {
  return FEATURES.filter((f) => {
    if (f.plan && !v.features.includes(f.plan)) return false;
    const a = f.access ?? "all";
    if (a === "super") return v.superAdmin;
    if (a === "admin") return v.admin;
    if (a === "reports") return v.reports || v.admin;
    return true;
  });
}

const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [];
const STOP = new Set("how do i to the a an in on of for is it can kaise kare karu karna hai ka ki ke me mein se ko kya ya and or my what where".split(" "));

/** Simple keyword match, used for search boxes and when AI is not available. */
export function searchFeatures(list: Feature[], q: string, max = 5) {
  const qs = words(q).filter((w) => !STOP.has(w));
  if (!qs.length) return [];
  const docs = list.map((f) => ({ f, title: words(f.title), kw: words(`${f.keywords ?? ""} ${f.cat}`), body: words(`${f.what} ${f.steps.join(" ")}`) }));
  const has = (ws: string[], w: string) => ws.some((t) => t.startsWith(w));
  // Rare words count more than common ones like "whatsapp" or "lead".
  const weight = new Map(qs.map((w) => {
    const df = docs.filter((d) => has(d.title, w) || has(d.kw, w) || has(d.body, w)).length;
    return [w, df ? Math.log((docs.length + 1) / df) : 0];
  }));
  return docs
    .map(({ f, title, kw, body }) => {
      let score = 0;
      for (const w of qs) {
        const k = weight.get(w) ?? 0;
        if (has(title, w)) score += 5 * k;
        if (has(kw, w)) score += 3 * k;
        if (has(body, w)) score += k;
      }
      return { f, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((x) => x.f);
}

/** The guide as plain text for the AI help bot. */
export function guideText(list: Feature[]) {
  return list
    .map((f) => [
      `### ${f.title} [${f.cat}] page: ${f.href}`,
      f.what,
      ...f.steps.map((s, i) => `${i + 1}. ${s}`),
      ...(f.tips ?? []).map((t) => `Tip: ${t}`),
    ].join("\n"))
    .join("\n\n");
}
