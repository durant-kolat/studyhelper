"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { DictKey } from "@/lib/i18n/dictionaries";
import { fetchPaymentHistory } from "@/lib/api";
import { formatMoney } from "@/lib/payment-countries";
import type { PaymentView } from "@/lib/billing/types";

const CHIP: Record<string, string> = {
  success: "bg-forest/10 text-forest",
  pending: "bg-gold/20 text-ink",
  failed: "bg-clay/10 text-clay",
  cancelled: "bg-mist2 text-slate",
  expired: "bg-mist2 text-slate",
};

/** Historique des paiements : date, moyen (y compris les anciens prestataires), montant dans sa devise, statut. Aucune donnée sensible. */
export default function PaymentHistory() {
  const { t, lang } = useI18n();
  const [items, setItems] = useState<PaymentView[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetchPaymentHistory().then(setItems).catch(() => setError(true));
  }, []);

  return (
    <section className="mt-6 rounded-card border border-mist bg-white p-5">
      <h2 className="font-display text-lg text-ink">{t("pay.history.title" as DictKey)}</h2>
      {error && <p role="alert" className="mt-2 text-sm text-clay">{t("pay.history.error" as DictKey)}</p>}
      {!error && items === null && <p className="mt-2 text-sm text-slate">{t("common.loading" as DictKey)}</p>}
      {items?.length === 0 && <p className="mt-2 text-sm text-slate">{t("pay.history.empty" as DictKey)}</p>}
      <ul className="mt-3 divide-y divide-mist">
        {items?.map((p) => (
          <li key={p.ref} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
            <div className="min-w-0">
              <p className="text-ink">{p.methodLabel}</p>
              <p className="text-xs text-slate">{new Date(p.paidAt ?? p.createdAt).toLocaleDateString(lang, { year: "numeric", month: "short", day: "numeric" })}</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-ink">{formatMoney(p.paidAmount ?? p.amount, p.currency, lang)}</span>
              <span className={`rounded-full px-2.5 py-0.5 text-xs ${CHIP[p.status] ?? CHIP.failed}`}>{t(`pay.history.status.${p.status}` as DictKey)}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
