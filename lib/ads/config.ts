// Publicités — configuration et règles d'affichage. MODULE PUR (aucune dépendance, aucun accès navigateur) :
// partagé par le composant <AdSlot>, la page d'administration et les tests (tests/ads.test.ts).
// Ne contient AUCUN secret ni identifiant publicitaire : ceux-ci viennent uniquement des variables d'environnement.

/** Pages où une publicité peut exister. Toute autre page (examens, quiz, pratique, assistant, carrière,
 *  planning, paiement, profil, connexion…) est exclue PAR CONSTRUCTION : elle n'a pas de clé ici. */
export const AD_PAGES = [
  { key: "home", label: "Page d'accueil", path: "/" },
  { key: "dashboard", label: "Tableau de bord", path: "/dashboard" },
  { key: "courses", label: "Mes cours", path: "/courses" },
  { key: "library", label: "Bibliothèque", path: "/library" },
  { key: "marketplace", label: "Marketplace", path: "/marketplace" },
  { key: "groups", label: "Groupes d'étude", path: "/groups" },
  { key: "opportunities", label: "Opportunités", path: "/opportunities" },
  { key: "activities", label: "Activités", path: "/activities" },
] as const;
export type AdPageKey = (typeof AD_PAGES)[number]["key"];

/** Formats AdSense pris en charge : « auto » (responsive), « horizontal » (bannière), « rectangle », « fluid » (publicité dans le contenu / in-article). */
export const AD_FORMATS = ["auto", "horizontal", "rectangle", "fluid"] as const;
export type AdFormat = (typeof AD_FORMATS)[number];

export const AD_FORMAT_LABELS: Record<AdFormat, string> = {
  auto: "Responsive (auto)",
  horizontal: "Bannière horizontale",
  rectangle: "Rectangle",
  fluid: "Dans le contenu (in-article)",
};

/** Hauteur minimale réservée (px) pendant le chargement, pour limiter les déplacements de page, et hauteur maximale. */
export const AD_FORMAT_BOX: Record<AdFormat, { min: number; max: number }> = {
  auto: { min: 100, max: 320 },
  horizontal: { min: 90, max: 120 },
  rectangle: { min: 250, max: 300 },
  fluid: { min: 120, max: 320 },
};

export type AdSlotDef = {
  id: string;
  label: string;
  page: AdPageKey;
  defaultFormat: AdFormat;
  /** Emplacement (aide pour l'administrateur). */
  where: string;
};

export const AD_SLOTS = [
  { id: "home_banner", label: "Accueil — bannière", page: "home", defaultFormat: "horizontal", where: "Entre le bandeau de confiance et le pied de page" },
  { id: "dashboard_inline", label: "Tableau de bord — discret", page: "dashboard", defaultFormat: "horizontal", where: "Sous les cartes principales (jamais au-dessus du message de bienvenue ni des statistiques)" },
  { id: "courses_between", label: "Mes cours — entre deux documents", page: "courses", defaultFormat: "fluid", where: "Après le 2e document, uniquement si la liste en compte au moins 3" },
  { id: "library_between", label: "Bibliothèque — entre deux documents", page: "library", defaultFormat: "fluid", where: "Après le 3e document ; jamais pendant la lecture ni une séance du professeur IA" },
  { id: "marketplace_inline", label: "Marketplace — hors offres", page: "marketplace", defaultFormat: "horizontal", where: "En haut de page, visuellement distinct des offres (libellé « Publicité »)" },
  { id: "groups_inline", label: "Groupes — liste", page: "groups", defaultFormat: "horizontal", where: "En haut de la liste des groupes" },
  { id: "opportunities_inline", label: "Opportunités — liste", page: "opportunities", defaultFormat: "horizontal", where: "En haut de la liste" },
  { id: "activities_inline", label: "Activités — liste", page: "activities", defaultFormat: "horizontal", where: "En haut de la liste" },
] as const satisfies readonly AdSlotDef[];
export type AdSlotId = (typeof AD_SLOTS)[number]["id"];

const SLOT_BY_ID: Record<string, AdSlotDef> = Object.fromEntries(AD_SLOTS.map((s) => [s.id, s]));
export function slotDef(id: string): AdSlotDef | null {
  return SLOT_BY_ID[id] ?? null;
}

export type AdConfig = {
  version: 1;
  /** Interrupteur général. */
  globalEnabled: boolean;
  /** Promotion Study Helper (Premium) affichée à la place d'une publicité tierce — comportement historique. */
  houseFallback: boolean;
  pages: Record<AdPageKey, boolean>;
  formats: Record<AdFormat, boolean>;
  slots: Record<AdSlotId, { enabled: boolean; format: AdFormat }>;
};

export function defaultConfig(): AdConfig {
  return {
    version: 1,
    globalEnabled: true,
    houseFallback: true,
    pages: Object.fromEntries(AD_PAGES.map((p) => [p.key, true])) as Record<AdPageKey, boolean>,
    formats: Object.fromEntries(AD_FORMATS.map((f) => [f, true])) as Record<AdFormat, boolean>,
    slots: Object.fromEntries(AD_SLOTS.map((s) => [s.id, { enabled: true, format: s.defaultFormat }])) as AdConfig["slots"],
  };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

/**
 * Normalise une configuration quelconque (lue en base ou envoyée par l'administration) :
 * clés inconnues ignorées, types vérifiés, valeurs manquantes = valeurs par défaut. Ne lève jamais d'erreur.
 * Un format qui n'est pas pris en charge globalement ne peut pas rester sélectionné sur un emplacement.
 */
export function sanitizeConfig(raw: unknown): AdConfig {
  const d = defaultConfig();
  if (!isObj(raw)) return d;
  const out = defaultConfig();
  out.globalEnabled = bool(raw.globalEnabled, d.globalEnabled);
  out.houseFallback = bool(raw.houseFallback, d.houseFallback);
  if (isObj(raw.pages)) for (const p of AD_PAGES) out.pages[p.key] = bool(raw.pages[p.key], d.pages[p.key]);
  if (isObj(raw.formats)) for (const f of AD_FORMATS) out.formats[f] = bool(raw.formats[f], d.formats[f]);
  if (isObj(raw.slots)) {
    for (const s of AD_SLOTS) {
      const r = raw.slots[s.id];
      if (!isObj(r)) continue;
      const fmt = typeof r.format === "string" && (AD_FORMATS as readonly string[]).includes(r.format) ? (r.format as AdFormat) : s.defaultFormat;
      out.slots[s.id] = { enabled: bool(r.enabled, true), format: fmt };
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Fournisseur (AdSense) : identifiants fournis UNIQUEMENT par l'environnement. Jamais inventés ici.
// ---------------------------------------------------------------------------

/** Identifiant d'éditeur AdSense : « ca-pub- » + 16 chiffres. Public par nature (visible dans le code des pages). */
export function validAdSenseClient(v: string | undefined | null): string | null {
  const s = (v ?? "").trim();
  return /^ca-pub-\d{16}$/.test(s) ? s : null;
}
/** Identifiant de bloc publicitaire : chiffres uniquement (en pratique 10). */
export function validAdSenseUnit(v: string | undefined | null): string | null {
  const s = (v ?? "").trim();
  return /^\d{8,12}$/.test(s) ? s : null;
}

export type ProviderEnv = {
  client: string | undefined;
  /** Identifiant de bloc par emplacement (variables NEXT_PUBLIC_ADSENSE_SLOT_*). */
  units: Partial<Record<AdSlotId, string | undefined>>;
};

export type ProviderStatus = {
  clientConfigured: boolean;
  unitsConfigured: Record<AdSlotId, boolean>;
  /** Au moins l'identifiant d'éditeur est valide. */
  ready: boolean;
};

export function providerStatus(env: ProviderEnv): ProviderStatus {
  const clientConfigured = validAdSenseClient(env.client) !== null;
  const unitsConfigured = Object.fromEntries(AD_SLOTS.map((s) => [s.id, validAdSenseUnit(env.units[s.id]) !== null])) as Record<AdSlotId, boolean>;
  return { clientConfigured, unitsConfigured, ready: clientConfigured };
}

// ---------------------------------------------------------------------------
// Décision d'affichage
// ---------------------------------------------------------------------------

export type PremiumState = "premium" | "free" | "unknown";
export type ConsentState = "granted" | "denied" | "unknown";

export type AdDecision =
  | { kind: "none"; reason: string }
  | { kind: "consent" }
  | { kind: "network"; client: string; unit: string; format: AdFormat }
  | { kind: "house" }
  | { kind: "placeholder" };

export type DecisionInput = {
  slotId: string;
  /** Chemin courant (usePathname) : doit correspondre à la page de l'emplacement. */
  pathname: string;
  premium: PremiumState;
  /** La configuration vient-elle réellement de la base (ligne ad_settings lue) ? Sinon : valeurs par défaut. */
  configSource: "db" | "default";
  config: AdConfig;
  consent: ConsentState;
  provider: ProviderEnv;
  /** Aperçu de développement (NODE_ENV !== "production") ou NEXT_PUBLIC_ADS_PLACEHOLDER=true. */
  placeholderAllowed: boolean;
  /** Contexte qui interdit toute publicité (lecture plein écran, séance IA, examen en cours…). */
  blocked?: boolean;
};

function normalizePath(p: string): string {
  const s = p.split("?")[0].split("#")[0];
  return s.length > 1 ? s.replace(/\/+$/, "") : s || "/";
}

/** Chemin autorisé pour une page : correspondance EXACTE (pas de sous-page : /library/xyz n'est pas /library). */
export function pathMatchesPage(pathname: string, page: AdPageKey): boolean {
  const def = AD_PAGES.find((p) => p.key === page);
  return !!def && normalizePath(pathname) === def.path;
}

export function decideAd(i: DecisionInput): AdDecision {
  const slot = slotDef(i.slotId);
  if (!slot) return { kind: "none", reason: "emplacement inconnu" };
  if (i.blocked) return { kind: "none", reason: "contexte protégé" };
  if (!pathMatchesPage(i.pathname, slot.page)) return { kind: "none", reason: "page non autorisée" };
  // Statut Premium inconnu (lecture en cours ou échec) : on n'affiche RIEN, et aucun script n'est chargé.
  if (i.premium !== "free") return { kind: "none", reason: i.premium === "premium" ? "compte Premium" : "statut Premium inconnu" };

  const c = i.config;
  if (!c.globalEnabled) return { kind: "none", reason: "publicités désactivées" };
  if (!c.pages[slot.page]) return { kind: "none", reason: "page désactivée" };
  const s = c.slots[slot.id as AdSlotId];
  if (!s?.enabled) return { kind: "none", reason: "emplacement désactivé" };
  if (!c.formats[s.format]) return { kind: "none", reason: "format non pris en charge" };

  const client = validAdSenseClient(i.provider.client);
  const unit = validAdSenseUnit(i.provider.units[slot.id as AdSlotId]);
  // Réseau tiers : exige une configuration lue en base (réglée par l'administrateur), des identifiants valides et le consentement.
  if (client && unit && i.configSource === "db") {
    if (i.consent === "granted") return { kind: "network", client, unit, format: s.format };
    if (i.consent === "unknown") return { kind: "consent" };
    // « denied » : aucun script tiers ; on retombe sur la promotion maison si elle est activée.
  }
  if (c.houseFallback) return { kind: "house" };
  if (i.placeholderAllowed) return { kind: "placeholder" };
  return { kind: "none", reason: "aucune publicité disponible" };
}

// ---------------------------------------------------------------------------
// Consentement (valeur stockée sur l'appareil — c'est une préférence, pas un droit d'accès)
// ---------------------------------------------------------------------------

export const CONSENT_STORAGE_KEY = "sh_ads_consent_v1";

export function parseConsent(raw: string | null | undefined): ConsentState {
  if (!raw) return "unknown";
  try {
    const v = JSON.parse(raw) as { v?: unknown };
    return v?.v === "granted" ? "granted" : v?.v === "denied" ? "denied" : "unknown";
  } catch {
    return "unknown";
  }
}
export function serializeConsent(v: "granted" | "denied", now: Date = new Date()): string {
  return JSON.stringify({ v, at: now.toISOString() });
}
