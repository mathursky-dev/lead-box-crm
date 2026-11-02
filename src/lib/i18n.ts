// Hindi / English interface. English text is the key; a missing Hindi entry
// simply shows the English text, so nothing breaks when new screens are added.
// Only fixed interface text is translated: user data (lead names, statuses,
// sources, tags…) stays exactly as the company typed it.

export type Lang = "en" | "hi";
export const LANG_COOKIE = "lb_lang";
export const parseLang = (v: string | undefined | null): Lang => (v === "hi" ? "hi" : "en");

const HI: Record<string, string> = {
  // ---------------------------------------------------------------- menu
  Dashboard: "डैशबोर्ड", "Lead Reports": "लीड रिपोर्ट", "Profit & Loss": "लाभ और हानि", "Win / Loss": "जीत / हार",
  "Report Builder": "रिपोर्ट बिल्डर", Sales: "सेल्स", Leads: "लीड्स", "Follow-ups": "फ़ॉलो-अप", Calls: "कॉल",
  Leaderboard: "लीडरबोर्ड", "Customers 360": "ग्राहक 360", Import: "इम्पोर्ट", Tasks: "टास्क", Conversations: "बातचीत",
  Inbox: "इनबॉक्स", "Live chat": "लाइव चैट", Contacts: "संपर्क", Documents: "दस्तावेज़", Store: "स्टोर", Orders: "ऑर्डर",
  "Store products": "स्टोर प्रोडक्ट", "Store settings": "स्टोर सेटिंग्स", "Quotes & Invoices": "कोटेशन और इनवॉइस",
  WhatsApp: "व्हाट्सऐप", Overview: "ओवरव्यू", Connections: "कनेक्शन", Templates: "टेम्पलेट", Send: "भेजें",
  Campaigns: "कैंपेन", Commerce: "कॉमर्स", Reports: "रिपोर्ट", Settings: "सेटिंग्स", Marketing: "मार्केटिंग",
  "Action queues": "एक्शन सूची", Segments: "सेगमेंट", Offers: "ऑफ़र", "Consent & suppression": "सहमति और रोक",
  Performance: "परफ़ॉर्मेंस", Digest: "डाइजेस्ट", "Automation & AI": "ऑटोमेशन और AI", Chatbots: "चैटबॉट", Flows: "फ़्लो",
  "Flow builder": "फ़्लो बिल्डर", Journeys: "जर्नी", "Execution log": "एक्ज़िक्यूशन लॉग", "AI knowledge": "AI जानकारी",
  "360 Reports": "360 रिपोर्ट", Manage: "मैनेज", "Quick Setup": "क्विक सेटअप", Users: "यूज़र", "Roles & permissions": "रोल और अनुमतियाँ",
  Organisation: "संगठन", "WhatsApp numbers": "व्हाट्सऐप नंबर", Allocation: "अलॉकेशन", "Duplicate leads": "डुप्लिकेट लीड",
  "Lead settings": "लीड सेटिंग्स", "Products · Quick replies": "प्रोडक्ट · क्विक रिप्लाई", "Follow-up alerts": "फ़ॉलो-अप अलर्ट",
  "Audit log": "ऑडिट लॉग", Integrations: "इंटीग्रेशन", "WhatsApp Cloud API": "व्हाट्सऐप क्लाउड API",
  "Facebook Lead Ads": "फ़ेसबुक लीड ऐड्स", Platform: "प्लेटफ़ॉर्म", Companies: "कंपनियाँ", "Plans & pricing": "प्लान और कीमत",
  "Wallet payments": "वॉलेट भुगतान", Wallet: "वॉलेट",
  Work: "काम", Grow: "बढ़ाएँ", Insights: "रिपोर्ट व जानकारी", Admin: "एडमिन", "All settings": "सभी सेटिंग्स",
  "Field Force": "फ़ील्ड टीम", "Field app": "फ़ील्ड ऐप", Attendance: "हाज़िरी", "Field visits": "फ़ील्ड विज़िट", Expenses: "खर्च",
  "Customer care": "ग्राहक सेवा", Appointments: "अपॉइंटमेंट", "Feedback & NPS": "फ़ीडबैक और NPS", Referrals: "रेफ़रल",
  "Care settings": "सेवा सेटिंग्स", "Import leads (Excel / CSV)": "लीड इम्पोर्ट (Excel / CSV)", "Check in / field visit": "चेक-इन / फ़ील्ड विज़िट",
  "Add expense claim": "खर्च का दावा जोड़ें", "Lead sources": "लीड सोर्स", "API & webhooks": "API और वेबहुक", "Billing & plan": "बिलिंग और प्लान",
  // ---------------------------------------------------------- quick create
  "New lead": "नई लीड", "Import leads (CSV)": "लीड इम्पोर्ट (CSV)", "Send WhatsApp message": "व्हाट्सऐप मैसेज भेजें",
  "New task": "नया टास्क", "Upload document": "दस्तावेज़ अपलोड करें", "New campaign": "नया कैंपेन", "New journey": "नई जर्नी",
  "New chatbot": "नया चैटबॉट", "New chatbot flow": "नया चैटबॉट फ़्लो", "Add user": "यूज़र जोड़ें",
  // -------------------------------------------------------------- top bar
  "Search menu…": "मेन्यू खोजें…", "Search pages, leads…": "पेज, लीड खोजें…", "Help & Guides": "मदद और गाइड",
  "Quick Create": "जल्दी बनाएँ", Security: "सुरक्षा", "Login history": "लॉगिन इतिहास", "Setup wizard": "सेटअप विज़ार्ड", "Security & logins": "सुरक्षा और लॉगिन", "Data export / backup": "डेटा एक्सपोर्ट / बैकअप", "Sign out": "साइन आउट", "Search pages, or leads by name / phone / LB-123": "पेज खोजें, या लीड नाम / फ़ोन / LB-123 से",
  Notifications: "सूचनाएँ", "Mark all read": "सब पढ़ा हुआ करें", Available: "उपलब्ध", Busy: "व्यस्त", Away: "बाहर", Offline: "ऑफ़लाइन",
  Language: "भाषा",
  // ----------------------------------------------------------- page titles
  "My Dashboard": "मेरा डैशबोर्ड", "My dashboard": "मेरा डैशबोर्ड", "Team dashboard": "टीम डैशबोर्ड", "Team Dashboard": "टीम डैशबोर्ड", Calendar: "कैलेंडर", "Customer 360": "ग्राहक 360",
  "Import leads": "लीड इम्पोर्ट", "Lead allocation": "लीड अलॉकेशन", "Company settings": "कंपनी सेटिंग्स",
  "Message templates": "मैसेज टेम्पलेट", "Products & quick replies": "प्रोडक्ट और क्विक रिप्लाई", "WhatsApp store": "व्हाट्सऐप स्टोर",
  "Lost reasons": "हार के कारण", "Lost Reasons": "हार के कारण", "Win / Loss report": "जीत / हार रिपोर्ट",
  "Custom report builder": "कस्टम रिपोर्ट बिल्डर", "Nurture & Recovery": "नर्चर और रिकवरी", "Customer segments": "ग्राहक सेगमेंट",
  "Manager digest": "मैनेजर डाइजेस्ट", "Nurturing journeys": "नर्चरिंग जर्नी", "WhatsApp Business numbers": "व्हाट्सऐप बिज़नेस नंबर",
  "Integration master": "इंटीग्रेशन मास्टर",
  "Times shown in IST. Reminder 15 minutes before due; a missed follow-up alerts you again (bell, phone push, WhatsApp).":
    "समय IST में है। तय समय से 15 मिनट पहले याद दिलाया जाएगा; छूटा हुआ फ़ॉलो-अप फिर से अलर्ट करेगा (घंटी, फ़ोन पुश, व्हाट्सऐप)।",
  "Calls made and received on the Lead Box mobile app, saved on the lead automatically.":
    "Lead Box मोबाइल ऐप से किए और आए कॉल, लीड पर अपने-आप सेव होते हैं।",
  "Every customer you can access. Open one to see chats, leads, notes, follow-ups and the full timeline.":
    "आपके सभी ग्राहक। किसी को खोलकर चैट, लीड, नोट्स, फ़ॉलो-अप और पूरी टाइमलाइन देखें।",
  "Quotations, invoices and payment links of your leads. Create one from a lead's page.":
    "आपकी लीड्स के कोटेशन, इनवॉइस और पेमेंट लिंक। लीड के पेज से नया बनाएँ।",
  "Create users, set role, placement, scoped permissions and allocation limits.":
    "यूज़र बनाएँ, रोल, टीम, अनुमतियाँ और अलॉकेशन सीमा तय करें।",
  "Who changed what, and when. Lead edits, status and owner changes, user changes and admin actions.":
    "किसने क्या बदला और कब। लीड बदलाव, स्टेटस और ओनर बदलाव, यूज़र बदलाव और एडमिन काम।",
  "Why deals are won or lost: reasons, sources, team members and products for leads closed in the period.":
    "डील क्यों जीती या हारी: इस अवधि में बंद लीड्स के कारण, सोर्स, टीम और प्रोडक्ट।",
  "Pick what to group by, which numbers to show and a chart. Save it, or download it as Excel.":
    "किस आधार पर ग्रुप करना है, कौन-से आँकड़े और चार्ट चुनें। सेव करें या Excel में डाउनलोड करें।",
  // -------------------------------------------------------------- KPIs etc
  "New leads": "नई लीड", "Messages sent": "भेजे गए मैसेज", Delivered: "डिलीवर", Read: "पढ़े गए", Received: "मिले",
  Failed: "फ़ेल", Sent: "भेजे", Unread: "बिना पढ़े", Unassigned: "बिना असाइन", "Open pipeline": "खुली पाइपलाइन",
  Conversion: "कन्वर्ज़न", Revenue: "आय", "Revenue (30 days)": "आय (30 दिन)", "Leads this month": "इस महीने की लीड",
  "Sales this month": "इस महीने की बिक्री", "Lost / Invalid": "हारी / अमान्य", "Open chats": "खुली चैट", "Total calls": "कुल कॉल",
  "Talk time": "बात का समय", Missed: "छूटे", Completed: "पूरे", Running: "चल रहे", Approved: "स्वीकृत", Rejected: "अस्वीकृत",
  "Pending review": "समीक्षा बाकी", Paid: "भुगतान हुआ", "Payments due": "बकाया भुगतान", "Total ad cost": "कुल विज्ञापन खर्च",
  "Sales value": "बिक्री मूल्य", "Return on ad spend": "विज्ञापन खर्च पर रिटर्न", "Active users": "सक्रिय यूज़र",
  Won: "जीती", Lost: "हारी", Invalid: "अमान्य", "Win rate": "जीत दर", "Won value": "जीती राशि", "Lost value": "हारी राशि",
  "Avg. days to win": "जीतने में औसत दिन", "Avg. days to lose": "हारने में औसत दिन", "Still open": "अभी खुली",
  Summary: "सारांश", "Lead Funnel": "लीड फ़नल", "Lead Trend": "लीड ट्रेंड", "Lead Source": "लीड सोर्स", "Opportunity Funnel": "अवसर फ़नल",
  "Activity Trend": "गतिविधि ट्रेंड", "Team Activity": "टीम गतिविधि", "Calls made": "किए गए कॉल", "Leads by Source": "सोर्स अनुसार लीड",
  "WhatsApp Messages": "व्हाट्सऐप मैसेज", "Delivery Funnel": "डिलीवरी फ़नल", "Who Sent It": "किसने भेजा",
  "Reasons for lost leads": "लीड हारने के कारण", "By source": "सोर्स अनुसार", "By team member": "टीम सदस्य अनुसार",
  "By product": "प्रोडक्ट अनुसार", "Month by month": "महीने अनुसार", "Recent admin actions": "हाल के एडमिन काम",
  Filters: "फ़िल्टर", Team: "टीम", Agents: "एजेंट", Products: "प्रोडक्ट", Tags: "टैग", Payments: "भुगतान",
  "Quick actions": "जल्दी के काम", "Recent activity": "हाल की गतिविधि", "Getting started": "शुरुआत करें",
  // ---------------------------------------------------------- form labels
  Name: "नाम", Email: "ईमेल", Password: "पासवर्ड", Description: "विवरण", Department: "विभाग", Status: "स्टेटस", Source: "सोर्स",
  "Sort order": "क्रम", "Product / Service": "प्रोडक्ट / सर्विस", Priority: "प्राथमिकता", Phone: "फ़ोन", "Company name": "कंपनी का नाम",
  Branch: "ब्रांच", Title: "शीर्षक", "Sub-status": "सब-स्टेटस", Reason: "कारण", "Reason (required)": "कारण (ज़रूरी)", Plan: "प्लान",
  Notes: "नोट्स", Message: "मैसेज", Location: "जगह", "Won value (₹)": "जीती राशि (₹)", "Expected value (₹)": "अपेक्षित राशि (₹)",
  "Due (IST)": "तारीख/समय (IST)", "Customer name": "ग्राहक का नाम", "Comment (optional)": "टिप्पणी (वैकल्पिक)", Category: "श्रेणी",
  "Assign to": "असाइन करें", Owner: "ओनर", Lead: "लीड", Note: "नोट", Due: "तय समय", Total: "कुल", User: "यूज़र",
  When: "कब", Who: "किसने", Action: "काम", Details: "विवरण", What: "क्या", From: "से", To: "तक", Period: "अवधि",
  "Group by": "ग्रुप करें", Show: "दिखाएँ", Chart: "चार्ट", "Date based on": "तारीख किस पर",
  "Next action (required)": "अगला काम (ज़रूरी)", "What to do": "क्या करना है", Comment: "टिप्पणी",
  "Sales status & next action": "सेल्स स्टेटस और अगला काम",
  // ------------------------------------------------------------- empties
  "No data for this period": "इस अवधि में कोई डेटा नहीं", "No leads found": "कोई लीड नहीं मिली", "Nothing here": "यहाँ कुछ नहीं",
  "No audit entries": "कोई ऑडिट रिकॉर्ड नहीं", "No activity in this period": "इस अवधि में कोई गतिविधि नहीं",
  "No closed leads in this period": "इस अवधि में कोई बंद लीड नहीं", "No Tasks Available": "कोई टास्क नहीं",
  "No data for these filters": "इन फ़िल्टर पर कोई डेटा नहीं", "No access": "अनुमति नहीं",
  // ------------------------------------------------------------- tabs
  "Custom Fields": "कस्टम फ़ील्ड", Forms: "फ़ॉर्म", "Manage Status": "स्टेटस मैनेज", "Manage Source": "सोर्स मैनेज",
  Departments: "विभाग", "Lead Allocations": "लीड अलॉकेशन", "Quotes & Payments": "कोटेशन और भुगतान",
  Sources: "सोर्स", "Daily trend": "रोज़ का ट्रेंड", "WhatsApp activity": "व्हाट्सऐप गतिविधि", Statuses: "स्टेटस", Teams: "टीमें",
  Branches: "ब्रांच",
};

export function tr(lang: Lang, s: string): string {
  return lang === "hi" ? HI[s] ?? s : s;
}
