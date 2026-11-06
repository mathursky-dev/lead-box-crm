import type { Metadata } from "next";
import { SUPPORT_EMAIL } from "@/lib/support";

export const metadata: Metadata = { title: "Privacy policy" };

export default function PrivacyPage() {
  return (
    <>
      <h1>Privacy policy</h1>
      <p className="text-xs text-slate-400">Last updated: 2 November 2026</p>
      <p>
        Lead Box (&quot;we&quot;, &quot;us&quot;) provides the Lead Box WhatsApp CRM, available at wacrm.leadboxs.in and as the
        Lead Box Android app. This policy explains what data the service handles and how. The Android app is a window to the
        same web service, so this policy covers both.
      </p>

      <h2>Who uses Lead Box</h2>
      <p>
        Lead Box is a business tool. Companies sign up and add their team members. Each company decides which leads,
        customers and chats it stores in Lead Box. For that data, the company is the data controller and Lead Box processes it
        on the company&apos;s behalf.
      </p>

      <h2>Data we collect</h2>
      <ul>
        <li><b>Account data:</b> name, email or user ID, phone number, role and company of each user, and a hashed password.</li>
        <li><b>Business data your company adds:</b> leads and customers (names, phone numbers, emails, notes, status, follow-ups),
          WhatsApp conversations and media, documents, templates, chatbot flows and campaign data.</li>
        <li><b>Connected services:</b> when a company connects WhatsApp Business (Meta Cloud API) or Facebook Lead Ads, we receive
          messages and leads from Meta for that company.</li>
        <li><b>Payments:</b> plan and payment records. Card and UPI details are handled by our payment provider (Razorpay); we do not
          store them.</li>
        <li><b>Usage and device data:</b> sign-in times, activity logs (audit trail) and basic technical data such as browser type and
          IP address, used for security and troubleshooting.</li>
      </ul>
      <p>We do not use advertising trackers in the app, and we do not sell personal data.</p>

      <h2>How we use data</h2>
      <ul>
        <li>To run the CRM: show leads and chats, send and receive WhatsApp messages, assign leads, remind about follow-ups and
          produce reports.</li>
        <li>To secure accounts, prevent abuse and fix problems.</li>
        <li>To bill companies for their plan and to contact account owners about the service.</li>
        <li>Optional AI features (such as reply suggestions and summaries) send the relevant text to an AI provider to produce the
          result. The provider does not use it to train its models.</li>
      </ul>

      <h2>Who we share data with</h2>
      <p>Only with service providers that run Lead Box for us, under contract:</p>
      <ul>
        <li>Supabase (database, file storage and sign-in) and Vercel (hosting)</li>
        <li>Meta Platforms (WhatsApp Business and Facebook Lead Ads, when a company connects them)</li>
        <li>Razorpay (payments)</li>
        <li>Anthropic (optional AI features)</li>
      </ul>
      <p>We may also disclose data when the law requires it.</p>

      <h2>Security</h2>
      <p>
        All data is sent over encrypted connections (HTTPS). Access inside a company is limited by role, and each company can only
        see its own data. Access tokens for connected services are stored encrypted.
      </p>

      <h2>Retention and deletion</h2>
      <p>
        We keep data while the company&apos;s account is active. A company admin can delete leads, chats and users at any time. To
        delete your account or your whole company&apos;s data, follow the steps on our{" "}
        <a href="/delete-account">account deletion page</a>. We delete it within 30 days, except records we must keep by law
        (such as invoices).
      </p>

      <h2>Your rights</h2>
      <p>
        You can ask to see, correct or delete your personal data. If your data was added by a company that uses Lead Box (for
        example, you are a lead of that company), please contact that company first; we will help them answer you.
      </p>

      <h2>Children</h2>
      <p>Lead Box is for businesses and is not meant for anyone under 18.</p>

      <h2>Changes</h2>
      <p>We will update the date above when this policy changes, and tell account owners about important changes.</p>

      <h2>Contact</h2>
      <p>Email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> for any privacy question.</p>
    </>
  );
}
