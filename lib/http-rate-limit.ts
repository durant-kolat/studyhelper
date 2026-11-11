// Limiteur de débit en mémoire (fenêtre glissante) pour les routes sensibles : webhooks de
// paiement, IA de pratique, explications visuelles. SERVEUR UNIQUEMENT.
//
// Limite : par instance serveur (en serverless, chaque instance a son propre compteur). C'est une
// protection contre les rafales et les abus simples ; les quotas quotidiens par utilisateur
// (lib/rate-limit.ts, en base) restent la barrière de fond pour les fonctions IA.

type Bucket = { hits: number[] };
const buckets = new Map<string, Bucket>();
const MAX_KEYS = 5000;

export function hitRateLimit(key: string, max: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((t) => now - t < windowMs);
  if (bucket.hits.length >= max) {
    const retryAfterSec = Math.max(1, Math.ceil((windowMs - (now - bucket.hits[0])) / 1000));
    buckets.set(key, bucket);
    return { ok: false, retryAfterSec };
  }
  bucket.hits.push(now);
  buckets.set(key, bucket);
  if (buckets.size > MAX_KEYS) {
    // Nettoyage : on retire les clés sans activité récente.
    buckets.forEach((b, k) => {
      if (b.hits.length === 0 || now - b.hits[b.hits.length - 1] > windowMs) buckets.delete(k);
    });
  }
  return { ok: true, retryAfterSec: 0 };
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip")) || "unknown";
}
