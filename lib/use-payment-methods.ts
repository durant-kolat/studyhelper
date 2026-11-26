"use client";

// Notch Pay est toujours disponible. On ne demande plus au serveur si MTN / Orange marchent.
import { useEffect, useState } from "react";
import type { PaymentMethodId } from "./payment-methods";

export type MethodInfo = { id: PaymentMethodId; available: boolean; currency: string; requiresPhone: boolean; flow: "push" | "redirect" };
export type PaymentMethodsState = { loading: boolean; error: boolean; enabled: boolean; methods: Partial<Record<PaymentMethodId, MethodInfo>> };

export function usePaymentMethods(country: string, skip = false): PaymentMethodsState {
  const [state, setState] = useState<PaymentMethodsState>({ loading: !skip, error: false, enabled: true, methods: {} });

  useEffect(() => {
    if (skip) return;
    // Pas de fetch, Notch Pay est toujours là
    setState({
      loading: false,
      error: false,
      enabled: true,
      methods: {
        notchpay: { id: "notchpay", available: true, currency: "XAF", requiresPhone: true, flow: "push" }
      }
    });
  }, [country, skip]);

  return state;
}
