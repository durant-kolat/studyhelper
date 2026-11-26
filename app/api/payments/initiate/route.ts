import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getAuthenticatedUser } from "@/lib/auth-server";
import {
  PAYMENT_METHODS,
  isPaymentMethodId,
  methodTraits,
  maskPhone,
  validateMobileMoneyPhone,
} from "@/lib/payment-methods";
import { getPremiumState, isTerm, premiumPrice, premiumPriceFor } from "@/lib/premium";
import { DEFAULT_COUNTRY, availableMethods, enabledCountryCodes, getCountry, isCfaCurrency, normalizeCountryCode } from "@/lib/payment-countries";
import { appUrl, appUrlIsPublicHttps, planDurationDays } from "@/lib/billing/config";
import { providerForMethod } from "@/lib/billing/providers";
import type { PaymentProvider } from "@/lib/billing/providers/types";
import { toPaymentView, PAYMENT_COLUMNS, type PaymentRow } from "@/lib/payments-server";
import type { StartPaymentResult } from "@/lib/billing/types";

export const runtime = "nodejs";

const MAX_ATTEMPTS_PER_10_MIN = 8;

const fail = (error: string, status: number, code?: string, extra?: Record<string, unknown>) =>
  NextResponse.json({ error, ...(code ? { code } : {}), ...extra }, { status });

function urlsFor(provider: PaymentProvider, ref: string) {
  const base = appUrl();
  const status = `${base}/payments/return?ref=${encodeURIComponent(ref)}`;
  return {
    notify: `${base}/api/payments/${provider.id}/webhook`,
    return: status,
    cancel: status,
  };
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!user) return fail("Non authentifié.", 401);
  const userId = user.id;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail("Requête invalide.", 400);
  }

  const type = typeof body.type === "string" ? body.type : "premium";

  if (type === "group_access") {
    return fail(
      "Le paiement individuel des groupes n'existe plus : l'accès aux groupes est inclus dans l'abonnement Premium.",
      410,
      "group_payment_removed"
    );
  }
  if (type !== "premium" && type !== "tutoring") return fail("Type de paiement inconnu.", 400);

  if (!isPaymentMethodId(body.method)) {
    return fail("Choisis un moyen de paiement.", 400, "method_required");
  }
  const method = PAYMENT_METHODS[body.method];
  const country = normalizeCountryCode(body.country ?? DEFAULT_COUNTRY);
  if (!country || !getCountry(country) || !enabledCountryCodes().includes(country)) {
    return fail("Le paiement n'est pas disponible dans ce pays.", 400, "country_invalid");
  }
  if (!availableMethods(country)[method.id]) {
    return fail("Ce moyen de paiement n'est pas disponible dans ce pays.", 400, "method_unavailable_country");
  }
  const provider = providerForMethod(method.id);
  const currency = provider.currency(country);

  let phoneNational: string | null = null;
  if (methodTraits(method.id).requiresPhone) {
    const phone = validateMobileMoneyPhone(typeof body.phone === "string" ? body.phone : "", country);
    if (!phone.ok) return fail(phone.error, 400, "phone_invalid");
    phoneNational = phone.national;
  }

  if (!provider.isConfigured(country) || !appUrlIsPublicHttps()) {
    if (!appUrlIsPublicHttps()) console.error("[payments/initiate] NEXT_PUBLIC_APP_URL doit être une URL https publique en production.");
    return fail(provider.unavailableMessage, 503, "payment_unavailable");
  }

  let { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("account_type, full_name, subscription_status, subscription_expires_at")
    .eq("id", userId)
    .single();

  if (!profile) {
    const { data: created, error: createError } = await supabaseAdmin
      .from("profiles")
      .insert({
        id: userId,
        full_name: (user as any).user_metadata?.full_name || (user as any).user_metadata?.name || user.email?.split("@")[0] || "Utilisateur",
        account_type: "etudiant",
        role: "etudiant",
        subscription_status: "free",
        xp: 0,
        timezone: "Africa/Douala",
        preferred_language: "fr",
      })
      .select("account_type, full_name, subscription_status, subscription_expires_at")
      .single();
    if (createError) {
      console.error("[payments/initiate] création profil:", createError.message);
      return fail("Impossible de créer le profil: " + createError.message, 500);
    }
    profile = created;
  }
  if (!profile) return fail("Profil introuvable.", 404);

  await supabaseAdmin.rpc("expire_stale_payments", { p_user_id: userId });

  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { count: recent } = await supabaseAdmin
    .from("payments")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", since);
  if ((recent ?? 0) >= MAX_ATTEMPTS_PER_10_MIN) {
    return fail("Trop de tentatives de paiement. Patiente quelques minutes avant de réessayer.", 429, "too_many_attempts");
  }

  let amount: number;
  let description: string;
  let plan: string | null = null;
  let durationDays: number | null = null;
  let meta: Record<string, unknown> = {};
  let bookingId: string | null = null;

  if (type === "premium") {
    if (profile.account_type === "entreprise") {
      return fail("L'offre Entreprise se négocie sur devis, pas d'auto-souscription.", 400);
    }
    const requestedPlan = body.plan ?? body.term;
    if (!isTerm(requestedPlan)) return fail("Choisis une durée d'abonnement valide.", 400, "plan_invalid");
    const price = premiumPriceFor(profile.account_type, requestedPlan, currency);
    if (!price) {
      return premiumPrice(profile.account_type, requestedPlan)
        ? fail("Le tarif n'est pas encore défini pour la devise de ce pays.", 400, "currency_unavailable")
        : fail("Cette durée n'est pas proposée pour ton profil.", 400, "plan_invalid");
    }

    const state = getPremiumState({
      status: profile.subscription_status,
      expiresAt: profile.subscription_expires_at,
    });
    if (state.isUnlimited) return fail("Ton Premium est illimité : aucun paiement n'est nécessaire.", 400, "premium_unlimited");

    const { data: pendingRow } = await supabaseAdmin
      .from("payments")
      .select(PAYMENT_COLUMNS)
      .eq("user_id", userId)
      .eq("type", "premium")
      .eq("status", "pending")
      .maybeSingle();
    if (pendingRow) {
      return fail(
        "Un paiement Premium est déjà en cours de vérification. Termine-le ou annule-le avant d'en lancer un autre.",
        409,
        "payment_pending",
        { ref: (pendingRow as PaymentRow).provider_ref, payment: toPaymentView(pendingRow as PaymentRow) }
      );
    }

    amount = price;
    plan = requestedPlan;
    durationDays = planDurationDays(requestedPlan);
    description = `Study Helper Premium - ${durationDays} jours`;
    meta = { term: requestedPlan, renewal: state.isActive };
  } else {
    const offerId = typeof body.offerId === "string" ? body.offerId : "";
    if (!offerId) return fail("offerId manquant.", 400);

    const { data: offer } = await supabaseAdmin
      .from("tutoring_offers")
      .select("id, title, price, active, teacher_id")
      .eq("id", offerId)
      .single();
    if (!offer || !offer.active) return fail("Offre introuvable ou inactive.", 404);
    if (offer.teacher_id === userId) return fail("Tu ne peux pas réserver ta propre offre.", 400);
    if (!isCfaCurrency(currency)) return fail("Le tarif n'est pas encore défini pour la devise de ce pays.", 400, "currency_unavailable");

    const { data: booking, error: bookingError } = await supabaseAdmin
      .from("tutoring_bookings")
      .insert({ offer_id: offerId, student_id: userId, status: "pending_payment" })
      .select("id")
      .single();
    if (bookingError || !booking) {
      console.error("[payments/initiate] réservation :", bookingError?.message);
      return fail("Échec de la réservation.", 500);
    }
    bookingId = booking.id;
    amount = offer.price;
    description = `Cours de repetition - ${offer.title}`;
    meta = { booking_id: booking.id };
  }

  const cleanupBooking = async () => {
    if (bookingId) await supabaseAdmin.from("tutoring_bookings").update({ status: "cancelled" }).eq("id", bookingId);
  };

  const ref = provider.newReference();
  const expiresAt = new Date(Date.now() + provider.pendingTtlMinutes * 60_000).toISOString();

  const { error: insertError } = await supabaseAdmin.from("payments").insert({
    user_id: userId,
    provider: provider.id,
    provider_ref: ref,
    method: method.id,
    type,
    plan,
    amount,
    currency,
    duration_days: durationDays,
    status: "pending",
    expires_at: expiresAt,
    meta: { ...meta, method: method.id, country, ...(phoneNational ? { phone_masked: maskPhone(phoneNational) } : {}) },
  });
  if (insertError) {
    await cleanupBooking();
    if (insertError.code === "23505" && type === "premium") {
      return fail("Un paiement Premium est déjà en cours de vérification.", 409, "payment_pending");
    }
    console.error(`[payments/initiate] insertion (${type}) :`, insertError.message);
    return fail("Impossible de créer le paiement pour le moment. Réessaie dans un instant.", 500);
  }

  const result = await provider.initiate({
    ref,
    amount,
    currency,
    description,
    userId,
    customerName: profile.full_name ?? "",
    customerEmail: user.email,
    phone: phoneNational,
    country,
    method: method.id,
    urls: urlsFor(provider, ref),
  });

  if (!result.ok) {
    await supabaseAdmin
      .from("payments")
      .update({ status: "failed" })
      .eq("provider_ref", ref);
    await cleanupBooking();
    return fail(result.error || "Le prestataire a refusé le paiement.", 502, "provider_error");
  }

  if (result.meta) {
    const { error: metaError } = await supabaseAdmin
      .from("payments")
      .update({ meta: { ...meta, method: method.id, country, ...(phoneNational ? { phone_masked: maskPhone(phoneNational) } : {}), ...result.meta } })
      .eq("provider_ref", ref);
    if (metaError) console.error("[payments/initiate] enregistrement de la référence prestataire :", metaError.message);
  }

  const response: StartPaymentResult = {
    ref,
    flow: result.flow,
    paymentUrl: result.flow === "redirect" ? result.url : null,
    provider: provider.id,
    method: method.id,
    amount,
    durationDays,
    expiresAt,
  };
  return NextResponse.json(response);
}
