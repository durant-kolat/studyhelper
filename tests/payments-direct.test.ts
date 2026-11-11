// Tests des paiements MTN / Orange (API directes) et PayPal (PayPal + Visa / Mastercard). Sans réseau, sans transaction réelle.
// Lancer : npm run test:payments-direct
import assert from "node:assert/strict";
import { CHECKOUT_METHODS, PAYMENT_METHODS, isPaymentMethodId, methodLabel, methodTraits, providerIdForMethod } from "../lib/payment-methods";
import { buildRequestToPay, isMtnConfigured, mtnConfig, mtnProvider, parseMtnStatus } from "../lib/billing/providers/mtn";
import { buildWebPayment, isOrangeConfigured, isTrustedOrangePaymentUrl, orangeConfig, orangeProvider, parseOrangeStatus } from "../lib/billing/providers/orange";
import { buildOrder, interpretOrder, isPaypalConfigured, isTrustedPaypalUrl, paypalAmountValue, paypalConfig, paypalProvider, refFromPaypalEvent } from "../lib/billing/providers/paypal";

const ctx = { ref: "11111111-2222-4333-8444-555555555555", amount: 1500, currency: "XAF", description: "Study Helper Premium", userId: "u1", customerName: "A", customerEmail: null, phone: "677123456", country: "CM", method: "mtn" as const, urls: { notify: "https://x.test/n", return: "https://x.test/r", cancel: "https://x.test/c" } };

// 1) Registre : 4 moyens, chacun relié à SON prestataire ; anciens moyens retirés mais lisibles dans l'historique
assert.deepEqual(CHECKOUT_METHODS, ["mtn", "orange", "card", "paypal"]);
assert.deepEqual(CHECKOUT_METHODS.map(providerIdForMethod), ["mtn", "orange", "paypal", "paypal"]);
for (const bad of ["mastercard", "visa", "campay", "lygos", "", null, 7]) assert.equal(isPaymentMethodId(bad as unknown), false, `${bad} n'est plus un moyen de paiement valide`);
assert.equal(methodLabel("mastercard"), "Mastercard", "ancien paiement toujours affiché");
assert.equal(methodLabel("visa"), "Carte Visa");
assert.equal(methodLabel(null, "campay"), "Mobile Money");
assert.equal(methodLabel("card"), "Visa / Mastercard");
assert.equal(PAYMENT_METHODS.paypal.label, "PayPal");

// 2) Parcours : MTN = confirmation sur le téléphone (numéro requis) ; les autres = page officielle, AUCUN numéro ni donnée de carte ici
assert.deepEqual(methodTraits("mtn"), { provider: "mtn", requiresPhone: true, flow: "push" });
assert.deepEqual(methodTraits("orange"), { provider: "orange", requiresPhone: false, flow: "redirect" });
assert.deepEqual(methodTraits("card"), { provider: "paypal", requiresPhone: false, flow: "redirect" });
assert.deepEqual(methodTraits("paypal"), { provider: "paypal", requiresPhone: false, flow: "redirect" });

// 3) Configuration : un moyen n'est « disponible » que si TOUT est renseigné POUR CE PAYS
assert.equal(isMtnConfigured({}), false);
assert.equal(isMtnConfigured({ MTN_MOMO_SUBSCRIPTION_KEY: "k", MTN_MOMO_API_USER: "u", MTN_MOMO_API_KEY: "a" }), true, "bac à sable : target par défaut");
assert.equal(isMtnConfigured({ MTN_MOMO_SUBSCRIPTION_KEY: "k", MTN_MOMO_API_USER: "u", MTN_MOMO_API_KEY: "a", MTN_MOMO_BASE_URL: "https://prod.mtn.example" }), false, "production sans target => non configuré");
assert.equal(isMtnConfigured({ MTN_MOMO_SUBSCRIPTION_KEY: "k", MTN_MOMO_API_USER: "u", MTN_MOMO_API_KEY: "a", MTN_MOMO_BASE_URL: "https://prod.mtn.example", MTN_MOMO_TARGET_ENVIRONMENT: "xx" }), true);
// Par pays : les variables sans suffixe ne valent QUE pour le Cameroun ; les autres pays exigent leurs propres identifiants
const cmOnly = { MTN_MOMO_SUBSCRIPTION_KEY: "k", MTN_MOMO_API_USER: "u", MTN_MOMO_API_KEY: "a" };
assert.equal(isMtnConfigured(cmOnly, "CM"), true);
assert.equal(isMtnConfigured(cmOnly, "GH"), false, "identifiants camerounais jamais utilisés pour le Ghana");
assert.equal(isMtnConfigured({ ...cmOnly, MTN_MOMO_GH_SUBSCRIPTION_KEY: "k2", MTN_MOMO_GH_API_USER: "u2", MTN_MOMO_GH_API_KEY: "a2" }, "GH"), true);
assert.equal(mtnConfig({}, "GH").currency, "GHS", "devise du pays");
assert.equal(mtnConfig({ MTN_MOMO_GH_CURRENCY: "eur" }, "GH").currency, "EUR");
assert.equal(isOrangeConfigured({}), false);
assert.equal(isOrangeConfigured({ ORANGE_MONEY_AUTH_HEADER: "abc", ORANGE_MONEY_MERCHANT_KEY: "mk" }), true);
assert.equal(isOrangeConfigured({ ORANGE_MONEY_AUTH_HEADER: "abc", ORANGE_MONEY_MERCHANT_KEY: "mk" }, "CI"), false, "pas de repli vers les identifiants du Cameroun");
assert.equal(isOrangeConfigured({ ORANGE_MONEY_CI_AUTH_HEADER: "abc", ORANGE_MONEY_CI_MERCHANT_KEY: "mk" }, "CI"), true);
assert.equal(orangeConfig({ ORANGE_MONEY_AUTH_HEADER: "abc", ORANGE_MONEY_MERCHANT_KEY: "mk" }).authHeader, "Basic abc");
assert.equal(orangeConfig({}).currency, "OUV", "bac à sable");
assert.equal(orangeConfig({ ORANGE_MONEY_COUNTRY: "cm" }).currency, "XAF");
assert.equal(orangeConfig({ ORANGE_MONEY_CI_COUNTRY: "ci" }, "CI").currency, "XOF");
assert.equal(isPaypalConfigured({}), false);
assert.equal(isPaypalConfigured({ PAYPAL_CLIENT_ID: "i", PAYPAL_CLIENT_SECRET: "s" }), true);
assert.equal(paypalConfig({}).base, "https://api-m.sandbox.paypal.com", "sandbox par défaut : jamais de vrai paiement par accident");
assert.equal(paypalConfig({ PAYPAL_ENV: "live" }).base, "https://api-m.paypal.com");
assert.equal(paypalConfig({}).currency, "EUR");
assert.equal(paypalConfig({ PAYPAL_CURRENCY: "usd" }).currency, "USD");
assert.equal(paypalConfig({ PAYPAL_CURRENCY: "XAF" }).currency, "EUR", "devise non acceptée par PayPal => EUR");
assert.equal(mtnProvider.isConfigured() || orangeProvider.isConfigured() || paypalProvider.isConfigured(), false, "rien de configuré dans l'environnement de test");

// 4) Corps des requêtes : référence unique, montant, numéro au format MSISDN du BON pays
const rtp = buildRequestToPay(ctx, "XAF");
assert.equal(rtp.externalId, ctx.ref);
assert.equal(rtp.amount, "1500");
assert.deepEqual(rtp.payer, { partyIdType: "MSISDN", partyId: "237677123456" });
assert.deepEqual(buildRequestToPay({ ...ctx, country: "GH", phone: "241234567" }, "GHS").payer, { partyIdType: "MSISDN", partyId: "233241234567" });
const wp = buildWebPayment(ctx, "mk", "XAF");
assert.equal(wp.order_id, ctx.ref);
assert.equal(wp.amount, 1500);
assert.ok(!JSON.stringify(wp).includes("677123456"), "aucun numéro envoyé à Orange");
const order = buildOrder({ ...ctx, method: "card", amount: 4 }, "EUR");
assert.equal(order.purchase_units[0].custom_id, ctx.ref);
assert.deepEqual(order.purchase_units[0].amount, { currency_code: "EUR", value: "4.00" });
assert.equal(order.payment_source.paypal.experience_context.landing_page, "GUEST_CHECKOUT", "Visa / Mastercard : formulaire carte");
assert.equal(buildOrder({ ...ctx, method: "paypal", amount: 4 }, "EUR").payment_source.paypal.experience_context.landing_page, "LOGIN");
assert.equal(order.payment_source.paypal.experience_context.return_url, "https://x.test/r");
assert.ok(!JSON.stringify(order).includes("677123456") && !/cvv|card_number|expiry/i.test(JSON.stringify(order)), "aucune donnée de carte ni numéro");
assert.equal(paypalAmountValue(400, "JPY"), "400");
assert.equal(paypalAmountValue(11, "EUR"), "11.00");

// 5) Références uniques et au bon format
const a = mtnProvider.newReference(), b = mtnProvider.newReference();
assert.notEqual(a, b);
assert.match(a, /^[0-9a-f-]{36}$/);
assert.match(orangeProvider.newReference(), /^[0-9a-f]{32}$/);
assert.notEqual(paypalProvider.newReference(), paypalProvider.newReference());

// 6) Statuts MTN : SUCCESSFUL seul = payé
assert.equal(parseMtnStatus({ status: "SUCCESSFUL", amount: "1500", currency: "XAF", externalId: ctx.ref, financialTransactionId: "123" }).outcome, "success");
assert.equal(parseMtnStatus({ status: "PENDING" }).outcome, "pending");
assert.equal(parseMtnStatus({ status: "N_IMPORTE_QUOI" }).outcome, "pending");
assert.equal(parseMtnStatus({ status: "FAILED", reason: "APPROVAL_REJECTED" }).outcome, "cancelled");
assert.equal(parseMtnStatus({ status: "FAILED", reason: { code: "EXPIRED" } }).outcome, "expired");
assert.equal(parseMtnStatus({ status: "FAILED", reason: "PAYER_NOT_FOUND" }).outcome, "failed");

// 7) Statuts Orange
assert.equal(parseOrangeStatus({ status: "SUCCESS", order_id: "o", txnid: "MP1" }).outcome, "success");
for (const s of ["INITIATED", "PENDING", "???", ""]) assert.equal(parseOrangeStatus({ status: s }).outcome, "pending", s);
assert.equal(parseOrangeStatus({ status: "FAILED" }).outcome, "failed");
assert.equal(parseOrangeStatus({ status: "EXPIRED" }).outcome, "expired");
for (const bad of ["http://webpayment.orange-money.com/x", "https://evil.example/orange-money.com", "https://orange-money.com.evil.example/x", "javascript:alert(1)", "", null, 42]) assert.equal(isTrustedOrangePaymentUrl(bad as unknown), false, String(bad));
assert.equal(isTrustedOrangePaymentUrl("https://webpayment.orange-money.com/cm/x"), true);

// 8) Commandes PayPal : seule une capture « COMPLETED » vaut paiement ; approuvé ⇒ il faut capturer ; inconnu ⇒ en attente
const unit = (cap: object | null, custom = ctx.ref) => ({ custom_id: custom, payments: cap ? { captures: [cap] } : undefined });
assert.deepEqual(interpretOrder({ status: "APPROVED", purchase_units: [unit(null)] }), { capture: true });
const done = interpretOrder({ status: "COMPLETED", purchase_units: [unit({ id: "CAP1", status: "COMPLETED", amount: { value: "4.00", currency_code: "eur" } })] });
assert.ok("check" in done && done.check.outcome === "success");
assert.ok("check" in done && done.check.amount === 4 && done.check.currency === "EUR" && done.check.providerTxnId === "CAP1" && done.check.echoRef === ctx.ref);
const outcome = (o: object) => { const r = interpretOrder(o as never); return "check" in r ? r.check.outcome : "capture"; };
assert.equal(outcome({ status: "COMPLETED", purchase_units: [unit({ id: "C", status: "PENDING", amount: { value: "4.00", currency_code: "EUR" } })] }), "pending", "capture en attente de revue : on n'active rien");
assert.equal(outcome({ status: "COMPLETED", purchase_units: [unit({ id: "C", status: "DECLINED" })] }), "failed");
assert.equal(outcome({ status: "COMPLETED", purchase_units: [unit(null)] }), "pending", "COMPLETED sans capture : jamais « payé »");
assert.equal(outcome({ status: "VOIDED" }), "cancelled");
for (const s of ["CREATED", "SAVED", "PAYER_ACTION_REQUIRED", "N_IMPORTE_QUOI", ""]) assert.equal(outcome({ status: s }), "pending", s);
assert.equal(outcome({}), "pending");

// 9) Adresse de paiement PayPal : https sur un domaine PayPal seulement ; événements : NOTRE référence
assert.equal(isTrustedPaypalUrl("https://www.sandbox.paypal.com/checkoutnow?token=X"), true);
assert.equal(isTrustedPaypalUrl("https://www.paypal.com/checkoutnow?token=X"), true);
for (const bad of ["http://www.paypal.com/x", "https://paypal.com.evil.example/x", "https://evil.example/www.paypal.com", "javascript:alert(1)", "", null]) assert.equal(isTrustedPaypalUrl(bad as unknown), false, String(bad));
assert.equal(refFromPaypalEvent({ resource: { custom_id: ctx.ref } }), ctx.ref);
assert.equal(refFromPaypalEvent({ resource: { purchase_units: [{ custom_id: ctx.ref }] } }), ctx.ref);
assert.equal(refFromPaypalEvent({ resource: {} }), null);
assert.equal(refFromPaypalEvent(null), null);

// 10) Simulation réseau MTN : demande acceptée (202) ≠ paiement confirmé ; erreur réseau jamais « payé »
const calls: { url: string; init: RequestInit }[] = [];
process.env.MTN_MOMO_SUBSCRIPTION_KEY = "k"; process.env.MTN_MOMO_API_USER = "u"; process.env.MTN_MOMO_API_KEY = "a";
globalThis.fetch = (async (url: string, init: RequestInit) => {
  calls.push({ url, init });
  if (url.endsWith("/collection/token/")) return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
  if (url.endsWith("/requesttopay")) return new Response(null, { status: 202 });
  if (url.includes("/requesttopay/")) return new Response(JSON.stringify({ status: "PENDING" }), { status: 200 });
  return new Response("", { status: 500 });
}) as typeof fetch;
const init = await mtnProvider.initiate(ctx);
assert.equal(init.ok, true);
assert.equal(init.ok && init.flow, "push");
assert.equal(init.ok && init.meta?.country, "CM");
const h = calls.find((c) => c.url.endsWith("/requesttopay"))!.init.headers as Record<string, string>;
assert.equal(h["X-Reference-Id"], ctx.ref);
assert.equal(h.Authorization, "Bearer tok");
assert.equal((await mtnProvider.check({ provider_ref: ctx.ref, amount: 1500, currency: "XAF", meta: { mtn_reference: ctx.ref } })).outcome, "pending");
const noGh = await mtnProvider.initiate({ ...ctx, country: "GH" });
assert.equal(noGh.ok, false, "Ghana non configuré : jamais de repli sur les identifiants du Cameroun");
globalThis.fetch = (async (url: string) => (url.endsWith("/collection/token/") ? new Response(JSON.stringify({ access_token: "tok" }), { status: 200 }) : new Response("", { status: 503 }))) as typeof fetch;
await assert.rejects(() => mtnProvider.check({ provider_ref: ctx.ref, amount: 1500, currency: "XAF", meta: null }), /mtn status HTTP 503/);

// 11) Simulation réseau PayPal : création → redirection ; approuvé → capture idempotente → payé ; refus / panne → jamais payé
process.env.PAYPAL_CLIENT_ID = "i"; process.env.PAYPAL_CLIENT_SECRET = "s";
const pcalls: { url: string; init: RequestInit }[] = [];
const pp = (handler: (url: string, init: RequestInit) => Response) => {
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    pcalls.push({ url, init });
    if (url.endsWith("/v1/oauth2/token")) return new Response(JSON.stringify({ access_token: "ptok", expires_in: 3000 }), { status: 200 });
    return handler(url, init);
  }) as typeof fetch;
};
pp(() => new Response(JSON.stringify({ id: "ORDER1", status: "PAYER_ACTION_REQUIRED", links: [{ rel: "self", href: "https://api" }, { rel: "payer-action", href: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER1" }] }), { status: 201 }));
const pinit = await paypalProvider.initiate({ ...ctx, method: "card", amount: 4, currency: "EUR" });
assert.equal(pinit.ok, true);
assert.equal(pinit.ok && pinit.flow === "redirect" && pinit.url, "https://www.sandbox.paypal.com/checkoutnow?token=ORDER1");
assert.equal(pinit.ok && pinit.meta?.paypal_order_id, "ORDER1");
const oc = pcalls.find((c) => c.url.endsWith("/v2/checkout/orders"))!;
assert.equal((oc.init.headers as Record<string, string>)["PayPal-Request-Id"], ctx.ref, "idempotence : un seul ordre par référence");
pp(() => new Response(JSON.stringify({ id: "O", links: [{ rel: "payer-action", href: "https://evil.example/pay" }] }), { status: 201 }));
assert.equal((await paypalProvider.initiate({ ...ctx, method: "paypal", amount: 4, currency: "EUR" })).ok, false, "adresse de paiement non fiable refusée");
pp(() => new Response("{}", { status: 422 }));
assert.equal((await paypalProvider.initiate({ ...ctx, method: "paypal", amount: 4, currency: "EUR" })).ok, false);

const pay = { provider_ref: ctx.ref, amount: 4, currency: "EUR", meta: { paypal_order_id: "ORDER1" } };
let captured = 0;
pp((url, init) => {
  if (url.endsWith("/capture")) { captured++; assert.equal((init.headers as Record<string, string>)["PayPal-Request-Id"], `${ctx.ref}-capture`); return new Response(JSON.stringify({ status: "COMPLETED", purchase_units: [unit({ id: "CAP1", status: "COMPLETED", amount: { value: "4.00", currency_code: "EUR" } })] }), { status: 201 }); }
  return new Response(JSON.stringify({ status: "APPROVED", purchase_units: [unit(null)] }), { status: 200 });
});
const paid = await paypalProvider.check(pay);
assert.deepEqual([paid.outcome, paid.amount, paid.currency, paid.providerTxnId, paid.echoRef], ["success", 4, "EUR", "CAP1", ctx.ref]);
assert.equal(captured, 1);
pp((url) => (url.endsWith("/capture") ? new Response(JSON.stringify({ details: [{ issue: "INSTRUMENT_DECLINED" }] }), { status: 422 }) : new Response(JSON.stringify({ status: "APPROVED", purchase_units: [unit(null)] }), { status: 200 })));
assert.equal((await paypalProvider.check(pay)).outcome, "failed");
let gets = 0;
pp((url) => (url.endsWith("/capture") ? new Response(JSON.stringify({ details: [{ issue: "ORDER_ALREADY_CAPTURED" }] }), { status: 422 }) : (gets++, gets === 1 ? new Response(JSON.stringify({ status: "APPROVED", purchase_units: [unit(null)] }), { status: 200 }) : new Response(JSON.stringify({ status: "COMPLETED", purchase_units: [unit({ id: "CAP1", status: "COMPLETED", amount: { value: "4.00", currency_code: "EUR" } })] }), { status: 200 }))));
assert.equal((await paypalProvider.check(pay)).outcome, "success", "déjà capturée : relue, jamais recapturée");
pp((url) => (url.endsWith("/capture") ? new Response("", { status: 500 }) : new Response(JSON.stringify({ status: "APPROVED", purchase_units: [unit(null)] }), { status: 200 })));
await assert.rejects(() => paypalProvider.check(pay), /paypal capture HTTP 500/, "panne de capture : réessai, jamais « payé »");
pp(() => new Response("", { status: 503 }));
await assert.rejects(() => paypalProvider.check(pay), /paypal status HTTP 503/);
assert.equal((await paypalProvider.check({ ...pay, meta: null })).outcome, "pending", "sans identifiant de commande : en attente");

console.log("payments-direct (MTN, Orange, PayPal) : tous les tests passent");
