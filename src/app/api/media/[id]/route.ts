import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Attachment access: the message row and the storage object are both read
// with the caller's RLS, so only users who can see the chat get a URL.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await createClient();
  const { data: m } = await sb.from("lb_messages").select("media_path").eq("id", id).maybeSingle();
  if (!m?.media_path) return new NextResponse("Not found", { status: 404 });
  const download = req.nextUrl.searchParams.get("download") === "1";
  const { data, error } = await sb.storage.from("lb-media").createSignedUrl(m.media_path, 300, download ? { download: true } : undefined);
  if (error || !data) return new NextResponse("Not found", { status: 404 });
  return NextResponse.redirect(data.signedUrl, { headers: { "Cache-Control": "private, no-store" } });
}
