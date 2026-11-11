"use client";

// Moyens de paiement RÉELLEMENT disponibles dans un pays (réponse de /api/payments/methods : identifiants serveur configurés,
// opérateur présent dans le pays, URL publique https). Aucun secret : booléens, devise et parcours uniquement.
import { useEffect, useState } from "react";
import type { PaymentMethodId } from "./payment-methods";

export type MethodInfo = { id: PaymentMethodId; available: boolean; currency: string; requiresPhone: boolean; flow: "push" | "redirect" };
export type PaymentMethodsState = { loading: boolean; error: boolean; enabled: boolean; methods: Partial<Record<PaymentMethodId, MethodInfo>> };

export function usePaymentMethods(country: string, skip = false): PaymentMethodsState {
  const [state, setState] = useState<PaymentMethodsState>({ loading: !skip, error: false, enabled: true, methods: {} });

  useEffect(() => {
    if (skip) return;
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: false }));
    fetch(`/api/payments/methods?country=${encodeURIComponent(country)}`, { signal: ctrl.signal, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { enabled?: boolean; methods?: MethodInfo[] }) => {
        const methods: PaymentMethodsState["methods"] = {};
        for (const m of data.methods ?? []) methods[m.id] = m;
        setState({ loading: false, error: false, enabled: data.enabled !== false, methods });
      })
      .catch((e) => {
        if ((e as Error).name !== "AbortError") setState({ loading: false, error: true, enabled: true, methods: {} });
      });
    return () => ctrl.abort();
  }, [country, skip]);

  return state;
}
