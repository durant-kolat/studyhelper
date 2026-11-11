// Limites de quota CONFIGURABLES sans redéploiement de code : variables d'environnement serveur.
//   QUOTA_FREE_<FONCTION>     (gratuit)   ex. QUOTA_FREE_ASSISTANT=8,  QUOTA_FREE_EXAM_ANALYSIS=2
//   QUOTA_PREMIUM_<FONCTION>  (Premium)   ex. QUOTA_PREMIUM_VISION=100
// <FONCTION> = nom de la fonction en MAJUSCULES, tirets → « _ » (voir lib/quota-limits.ts : assistant, vision, exam-chat, …).
// Valeur absente ou invalide → limite par défaut de lib/quota-limits.ts. 0 = fonction désactivée pour cette catégorie.
// SERVEUR UNIQUEMENT : le décompte est toujours décidé côté serveur (check_and_log_usage).

import { FREE_LIMITS, PREMIUM_LIMITS, type UsageKind } from "./quota-limits";

type Env = Record<string, string | undefined>;

export const quotaEnvName = (prefix: "QUOTA_FREE" | "QUOTA_PREMIUM", kind: UsageKind) =>
  `${prefix}_${kind.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;

function read(env: Env, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 100_000 ? n : fallback;
}

export const freeLimit = (kind: UsageKind, env: Env = process.env) => read(env, quotaEnvName("QUOTA_FREE", kind), FREE_LIMITS[kind]);
export const premiumLimit = (kind: UsageKind, env: Env = process.env) => read(env, quotaEnvName("QUOTA_PREMIUM", kind), PREMIUM_LIMITS[kind]);
