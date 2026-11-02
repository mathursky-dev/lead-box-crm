import type { Metadata } from "next";
import { SUPPORT_EMAIL } from "@/lib/support";

export const metadata: Metadata = { title: "Delete your account" };

const subject = encodeURIComponent("Delete my Lead Box account");
const body = encodeURIComponent("Please delete my Lead Box account.\n\nUser ID or email:\nCompany name:\nDelete whole company data too? (yes/no):\n");

export default function DeleteAccountPage() {
  return (
    <>
      <h1>Delete your Lead Box account</h1>
      <p>
        This page explains how to delete your Lead Box WhatsApp CRM account (web and Android app) and the data linked to it.
      </p>

      <h2>If you are a team member</h2>
      <p>Ask your company admin to remove you in <b>Admin → Users</b>. Your login stops working at once.</p>

      <h2>If you are the company admin or want to delete it yourself</h2>
      <ul>
        <li>
          Send an email to <a href={`mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`}>{SUPPORT_EMAIL}</a> from the email
          linked to your account, with the subject &quot;Delete my Lead Box account&quot;.
        </li>
        <li>Write your user ID or email, your company name, and whether the whole company&apos;s data should be deleted.</li>
        <li>We confirm by email and finish the deletion within 30 days.</li>
      </ul>

      <h2>What gets deleted</h2>
      <ul>
        <li>Your login, name, phone number and profile.</li>
        <li>If the whole company is deleted: all leads, customers, WhatsApp chats and media, documents, templates, chatbot flows,
          campaigns, reports and connected WhatsApp / Facebook settings.</li>
      </ul>

      <h2>What we keep</h2>
      <p>
        Payment and invoice records are kept for up to 8 years because Indian tax law requires it. Backups are cleared within 30
        days. Nothing else is kept.
      </p>
    </>
  );
}
