import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getAuthenticatedUserId } from "@/lib/auth-server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) {
    return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  }

  const { endpoint, p256dh, authKey } = await req.json();
  if (!endpoint || !p256dh || !authKey) {
    return NextResponse.json({ error: "Abonnement incomplet." }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from("push_subscriptions").upsert(
    { user_id: ownerId, endpoint, p256dh, auth: authKey },
    { onConflict: "endpoint" }
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
