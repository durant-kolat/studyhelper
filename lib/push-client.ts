import { supabase } from "./supabase";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export async function isPushSupported() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

export async function getPushSubscriptionStatus(): Promise<
  "unsupported" | "not-subscribed" | "subscribed"
> {
  if (!(await isPushSupported())) return "unsupported";
  const registration = await navigator.serviceWorker.getRegistration();
  const sub = await registration?.pushManager.getSubscription();
  return sub ? "subscribed" : "not-subscribed";
}

export async function subscribeToPush(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  if (!(await isPushSupported())) {
    return { ok: false, error: "Les notifications push ne sont pas prises en charge par ce navigateur." };
  }
  if (!VAPID_PUBLIC_KEY) {
    return { ok: false, error: "Les notifications push ne sont pas configurées côté serveur." };
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return { ok: false, error: "Permission refusée." };
  }

  const registration = await navigator.serviceWorker.register("/sw.js");
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });

  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  const json = subscription.toJSON();
  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      endpoint: json.endpoint,
      p256dh: json.keys?.p256dh,
      authKey: json.keys?.auth,
    }),
  });

  if (!res.ok) {
    const data = await res.json();
    return { ok: false, error: data.error ?? "Échec de l'abonnement." };
  }

  return { ok: true };
}

export async function unsubscribeFromPush() {
  const registration = await navigator.serviceWorker.getRegistration();
  const sub = await registration?.pushManager.getSubscription();
  if (sub) {
    await sub.unsubscribe();
  }
}
