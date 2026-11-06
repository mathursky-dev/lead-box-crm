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
  Leaderboard: "लीडरबोर्ड", Targets: "टारगेट", "Login hours": "लॉगिन समय", "Customers 360": "ग्राहक 360", Import: "इम्पोर्ट", Tasks: "टास्क", Conversations: "बातचीत",
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
  // ------------------------------------------------------- download app
  "Download app": "ऐप डाउनलोड करें",
  "Get app": "ऐप पाएँ",
  "Download the mobile app": "मोबाइल ऐप डाउनलोड करें",
  "Get the Lead Box app": "Lead Box ऐप पाएँ",
  "Add Lead Box to your iPhone home screen. Opens full screen, like an app.": "Lead Box को iPhone की होम स्क्रीन पर जोड़ें। ऐप की तरह फ़ुल स्क्रीन खुलेगा।",
  "Leads, chats and follow-ups in one tap. Free.": "लीड, चैट और फ़ॉलो-अप एक टैप में। मुफ़्त।",
  "Close": "बंद करें",
  "Install on iPhone": "iPhone पर इंस्टॉल करें",
  "How to install": "कैसे इंस्टॉल करें",
  "Later": "बाद में",
  "Android phone": "Android फ़ोन",
  "Install from Chrome": "Chrome से इंस्टॉल करें",
  "Version": "वर्ज़न",
  "Your phone": "आपका फ़ोन",
  "Open this page in Chrome on your Android phone.": "यह पेज अपने Android फ़ोन में Chrome में खोलें।",
  "Tap the ⋮ menu (top right).": "ऊपर दाईं ओर ⋮ मेन्यू दबाएँ।",
  "Tap “Install app” or “Add to Home screen”, then Install.": "“Install app” या “Add to Home screen” दबाएँ, फिर Install।",
  "Download APK": "APK डाउनलोड करें",
  "Tap Download APK. The file (leadbox.apk) saves to your phone.": "“APK डाउनलोड करें” दबाएँ। फ़ाइल (leadbox.apk) फ़ोन में सेव हो जाएगी।",
  "Open it from the notification bar or the Downloads folder.": "नोटिफ़िकेशन बार या Downloads फ़ोल्डर से फ़ाइल खोलें।",
  "If the phone asks, allow “Install unknown apps” for Chrome / Files, then go back.": "फ़ोन पूछे तो Chrome / Files के लिए “Install unknown apps” की अनुमति दें, फिर वापस आएँ।",
  "Tap Install, open Lead Box and log in with the same ID and password.": "Install दबाएँ, Lead Box खोलें और उसी ID-पासवर्ड से लॉगिन करें।",
  "If Google Play Protect shows a warning, tap “More details” → “Install anyway”. It shows for every app that is not from the Play Store.": "Google Play Protect चेतावनी दिखाए तो “More details” → “Install anyway” दबाएँ। यह Play Store के बाहर की हर ऐप पर दिखती है।",
  "iPhone / iPad": "iPhone / iPad",
  "Add to Home Screen · no download needed": "होम स्क्रीन पर जोड़ें · डाउनलोड की ज़रूरत नहीं",
  "Open in App Store": "App Store में खोलें",
  "Open this page in Safari first: copy the link below and paste it in Safari.": "पहले यह पेज Safari में खोलें: नीचे का लिंक कॉपी करके Safari में पेस्ट करें।",
  "Open": "खोलें",
  "in Safari and log in.": "Safari में खोलें और लॉगिन करें।",
  "Tap the Share button": "शेयर बटन दबाएँ",
  "at the bottom of Safari.": "(Safari में नीचे)।",
  "Scroll down and tap": "नीचे स्क्रॉल करके दबाएँ",
  "Add to Home Screen": "Add to Home Screen",
  "Tap Add. The": "Add दबाएँ।",
  "icon comes on your home screen and opens full screen, like an app.": "आइकन होम स्क्रीन पर आ जाएगा और ऐप की तरह फ़ुल स्क्रीन खुलेगा।",
  "Link copied": "लिंक कॉपी हो गया",
  "Copy link": "लिंक कॉपी करें",
  "on your phone": "आपके फ़ोन पर",
  "Leads, WhatsApp chats, follow-ups and calls, always in your pocket. Free for your team.": "लीड, व्हाट्सऐप चैट, फ़ॉलो-अप और कॉल, हमेशा आपकी जेब में। आपकी टीम के लिए मुफ़्त।",
  "You are already using the app on this phone.": "आप इस फ़ोन पर पहले से ऐप चला रहे हैं।",
  "QR code to open this page on your phone": "यह पेज फ़ोन पर खोलने का QR कोड",
  "On a computer? Scan with your phone": "कंप्यूटर पर हैं? फ़ोन से स्कैन करें",
  "Open the phone camera and point it at this code. This page opens on the phone, with the right button for Android or iPhone.": "फ़ोन का कैमरा खोलकर इस कोड पर रखें। यह पेज फ़ोन पर खुलेगा, Android या iPhone के सही बटन के साथ।",
  "Install the CRM on Android or iPhone and open it with one tap.": "CRM को Android या iPhone पर इंस्टॉल करें और एक टैप में खोलें।",
};

export function tr(lang: Lang, s: string): string {
  return lang === "hi" ? HI[s] ?? s : s;
}
