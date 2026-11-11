import Link from "next/link";
import { FREE_LIMITS } from "@/lib/quota-limits";
import AdSlot from "@/components/ads/AdSlot";
import {
  BookOpen,
  CheckSquare,
  CalendarDays,
  Users,
  Bot,
  GraduationCap,
  Crown,
  ShieldCheck,
  Smartphone,
  Headphones,
  Briefcase,
  PartyPopper,
} from "lucide-react";

// Image du hero. Pour la remplacer (par ex. par une illustration éducation /
// technologie sans personne) : dépose le fichier dans /public et change ce
// chemin — ou définis NEXT_PUBLIC_HERO_IMAGE. Rien d'autre à modifier ; le
// cadrage (`cover`) et le voile s'adaptent tout seuls.
const HERO_IMAGE = process.env.NEXT_PUBLIC_HERO_IMAGE || "/hero-background.jpg";

const boucle = [
  { mot: "Importer", detail: "un cours, un PDF, une photo de notes" },
  { mot: "Comprendre", detail: "résumé et notions clés en un instant" },
  { mot: "Réviser", detail: "1 heure par matière, à ton rythme" },
  { mot: "Passer l'examen", detail: "30 minutes, conditions réelles" },
  { mot: "Corriger", detail: "chaque erreur expliquée, pas juste notée" },
  { mot: "Ajuster le planning", detail: "selon tes résultats de la semaine" },
  { mot: "Faire le quiz du dimanche", detail: "toutes les matières, 1 heure" },
  { mot: "Progresser", detail: "voir la courbe monter, semaine après semaine" },
];

const features = [
  {
    icon: BookOpen,
    color: "bg-clay/10 text-clay",
    title: "Étudier",
    text: "Importe tes cours, résume-les avec l'IA et génère des questions pour vérifier ta compréhension.",
  },
  {
    icon: CheckSquare,
    color: "bg-forest/10 text-forest",
    title: "T'évaluer",
    text: "Passe des examens de 30 minutes générés à partir de tes cours, et un Grand Quiz hebdomadaire de 1 heure.",
  },
  {
    icon: CalendarDays,
    color: "bg-gold/20 text-ink",
    title: "T'organiser",
    text: "Un planning généré selon ton réveil, ton départ pour l'école et tes matières les plus faibles.",
  },
  {
    icon: Users,
    color: "bg-ink/10 text-ink",
    title: "Collaborer",
    text: "Rejoins ou crée des groupes d'étude, discute avec tes camarades en temps réel.",
  },
  {
    icon: Bot,
    color: "bg-clay/10 text-clay",
    title: "Avec l'IA",
    text: "Un assistant qui explique et guide plutôt que de donner directement la réponse d'un exercice.",
  },
  {
    icon: Briefcase,
    color: "bg-forest/10 text-forest",
    title: "Opportunités",
    text: "Bourses, stages, jobs étudiants et freelance — vérifiés avant publication, gratuits pour tous.",
  },
  {
    icon: PartyPopper,
    color: "bg-gold/20 text-ink",
    title: "Activités",
    text: "Hackathons, concours, olympiades et ateliers proposés par la communauté.",
  },
];

const subjects = [
  "Mathématiques",
  "Physique",
  "Chimie",
  "SVT",
  "Français",
  "Anglais",
  "Histoire-Géo",
  "Informatique",
  "Philosophie",
  "Économie",
  "Espagnol",
  "+ Autres",
];

export default function Home() {
  return (
    <main className="min-h-screen bg-paper">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-mist px-6 py-4 sm:px-10">
        <Link href="/" className="flex items-center gap-2">
          <GraduationCap className="text-clay" size={26} />
          <div>
            <p className="font-display text-lg leading-none text-ink">
              Study Helper
            </p>
            <p className="text-[11px] text-slate">
              Apprends · Entraîne-toi · Progresse
            </p>
          </div>
        </Link>
        <nav className="hidden items-center gap-6 text-sm text-slate sm:flex">
          <a href="#fonctionnalites" className="hover:text-ink">
            Fonctionnalités
          </a>
          <a href="#tarifs" className="hover:text-ink">
            Tarifs
          </a>
          <Link href="/opportunities" className="hover:text-ink">
            Opportunités
          </Link>
          <Link href="/activities" className="hover:text-ink">
            Activités
          </Link>
          <Link href="/groups" className="hover:text-ink">
            Groupes
          </Link>
        </nav>
        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="rounded-card border border-mist px-4 py-2 text-sm text-ink hover:border-ink"
          >
            Se connecter
          </Link>
          <Link
            href="/register"
            className="rounded-card bg-ink px-4 py-2 text-sm text-paper hover:bg-ink/90"
          >
            Créer un compte
          </Link>
        </div>
      </header>

      {/* Hero
          La photo est un vrai élément visuel : affichée en `cover`, cadrée sur
          le sujet, avec un voile LÉGER (plus foncé à gauche, là où est le texte,
          presque transparent à droite). Sur mobile, le texte occupe toute la
          largeur : voile uniforme un peu plus marqué. */}
      <section className="relative overflow-hidden border-b border-mist">
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-no-repeat bg-[position:47%_40%] lg:bg-[position:50%_32%]"
          style={{
            backgroundImage: `url('${HERO_IMAGE}')`,
            backgroundSize: "cover",
          }}
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-b from-ink/5 via-ink/45 to-ink/80 lg:hidden"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 hidden bg-gradient-to-r from-ink/80 via-ink/45 to-transparent lg:block"
        />

        <div className="relative mx-auto flex min-h-[32rem] max-w-6xl flex-col justify-between gap-10 px-6 pb-10 pt-72 sm:px-10 sm:py-14 lg:min-h-[38rem]">
          <div className="max-w-md [text-shadow:0_1px_14px_rgba(11,14,36,0.6)]">
            <span className="inline-block rounded-full bg-ink/60 px-3 py-1 text-xs text-gold backdrop-blur-sm">
              🎓 Ton allié pour réussir tes études
            </span>
            <h1 className="mt-4 font-display text-4xl leading-tight text-paper sm:text-5xl">
              L'intelligence artificielle
              <br />
              <span className="text-gold">au service de tes études</span>
            </h1>
            <p className="mt-5 max-w-lg text-sm leading-relaxed text-paper sm:text-base">
              Organise ton temps, révise efficacement, passe tes examens,
              travaille en groupe et progresse avec l'IA. Tout ce dont tu as
              besoin, dans une seule application.
            </p>
            <div className="mt-8 flex flex-wrap gap-3 [text-shadow:none]">
              <Link
                href="/register"
                className="rounded-card bg-clay px-5 py-3 text-sm font-medium text-paper hover:bg-clay/90"
              >
                Commencer maintenant →
              </Link>
              <a
                href="#fonctionnalites"
                className="rounded-card border border-white/40 bg-ink/40 px-5 py-3 text-sm font-medium text-paper backdrop-blur-sm hover:border-white/70"
              >
                Découvrir les fonctionnalités
              </a>
            </div>
          </div>

          {/* Cartes en bas : elles ne recouvrent plus le visage ni le bureau de la photo */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex items-center gap-3 rounded-card bg-white/90 p-4 backdrop-blur">
              <div className="rounded-card bg-clay/10 p-2 text-clay">
                <Bot size={18} />
              </div>
              <div>
                <p className="text-sm font-medium text-ink">Assistant IA</p>
                <p className="text-xs text-slate">
                  Explique, résume, génère des exercices…
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-card bg-white/90 p-4 backdrop-blur">
              <div className="rounded-card bg-gold/20 p-2 text-ink">
                <CalendarDays size={18} />
              </div>
              <div>
                <p className="text-sm font-medium text-ink">
                  Planning intelligent
                </p>
                <p className="text-xs text-slate">Ton temps, bien géré</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-card bg-white/90 p-4 backdrop-blur">
              <div className="rounded-card bg-ink/10 p-2 text-ink">
                <Users size={18} />
              </div>
              <div>
                <p className="text-sm font-medium text-ink">
                  Groupes d'étude
                </p>
                <p className="text-xs text-slate">Chat en temps réel</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Fonctionnalités */}
      <section id="fonctionnalites" className="px-6 py-16 sm:px-10">
        <div className="mx-auto max-w-6xl">
          <p className="text-center text-xs uppercase tracking-wide text-clay">
            Tout ce dont tu as besoin
          </p>
          <h2 className="mt-2 text-center font-display text-2xl text-ink sm:text-3xl">
            Une seule application, toutes tes solutions
          </h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {features.map((f) => (
              <div
                key={f.title}
                className="rounded-card border border-mist bg-white p-5"
              >
                <div className={`inline-flex rounded-card p-2 ${f.color}`}>
                  <f.icon size={18} />
                </div>
                <p className="mt-3 font-display text-base text-ink">
                  {f.title}
                </p>
                <p className="mt-1 text-sm text-slate">{f.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* La boucle */}
      <section className="border-y border-mist bg-ink px-6 py-14 sm:px-10">
        <div className="mx-auto max-w-6xl">
          <p className="font-display text-sm italic text-gold">La boucle</p>
          <h2 className="mt-2 font-display text-2xl text-paper">
            Ce qui reste au centre de l'application
          </h2>
          <ol className="mt-8 grid gap-0 sm:grid-cols-2">
            {boucle.map((etape, i) => (
              <li
                key={etape.mot}
                className="flex gap-4 border-b border-white/10 py-4 sm:border-r sm:pr-6"
              >
                <span className="font-display text-lg text-gold">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <p className="font-medium text-paper">{etape.mot}</p>
                  <p className="text-sm text-paper/60">{etape.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Matières */}
      <section className="px-6 py-16 sm:px-10">
        <div className="mx-auto max-w-6xl">
          <h2 className="font-display text-2xl text-ink">
            Toutes les matières, un seul endroit
          </h2>
          <p className="mt-1 text-sm text-slate">
            Du collège à l'université, importe tes cours dans la matière de
            ton choix.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            {subjects.map((s) => (
              <span
                key={s}
                className="rounded-full border border-mist bg-white px-4 py-2 text-sm text-ink"
              >
                {s}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Tarifs */}
      <section id="tarifs" className="border-t border-mist bg-mist2 px-6 py-16 sm:px-10">
        <div className="mx-auto max-w-6xl">
          <h2 className="font-display text-2xl text-ink">
            Gratuit pour commencer, Premium pour aller plus loin
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-slate">
            Cours, groupes, opportunités et activités sont accessibles à tous
            gratuitement. Premium retire la publicité et augmente les limites
            d'usage de l'IA.
          </p>

          <div className="mt-8 grid gap-6 lg:grid-cols-3">
            <div className="rounded-card border border-mist bg-white p-6">
              <p className="font-display text-lg text-ink">Gratuit</p>
              <p className="mt-1 text-sm text-slate">
                Pour tous les profils, sans limite de temps.
              </p>
              <ul className="mt-4 space-y-2 text-sm text-slate">
                <li>✓ Cours, examens, quiz</li>
                <li>✓ Groupes, opportunités, activités</li>
                <li>✓ IA limitée ({FREE_LIMITS.assistant} questions/jour)</li>
                <li>· Avec publicité</li>
              </ul>
              <Link
                href="/register"
                className="mt-6 inline-block rounded-card border border-mist px-5 py-2.5 text-sm font-medium text-ink hover:border-ink"
              >
                Commencer gratuitement
              </Link>
            </div>

            <div className="rounded-card border border-mist bg-white p-6">
              <div className="flex items-center gap-2">
                <Crown size={18} className="text-gold" />
                <p className="font-display text-lg text-ink">
                  Premium Élève / Étudiant
                </p>
              </div>
              <p className="mt-4 font-display text-3xl text-ink">
                2 500 FCFA
                <span className="text-base font-normal text-slate"> / mois</span>
              </p>
              <p className="text-xs text-slate">
                ou 7 000 FCFA / trimestre · 29 500 FCFA / an
              </p>
              <ul className="mt-4 space-y-2 text-sm text-slate">
                <li>✓ Sans publicité</li>
                <li>✓ 100 questions/jour à l'assistant IA</li>
                <li>✓ Plus d'examens et de Grands Quiz générés</li>
              </ul>
              <Link
                href="/register"
                className="mt-6 inline-block rounded-card bg-gold px-5 py-2.5 text-sm font-medium text-ink hover:bg-gold/90"
              >
                Passer Premium
              </Link>
            </div>

            <div className="rounded-card border border-mist bg-white p-6">
              <div className="flex items-center gap-2">
                <Users size={18} className="text-clay" />
                <p className="font-display text-lg text-ink">
                  Premium Enseignant
                </p>
              </div>
              <p className="mt-4 font-display text-3xl text-ink">
                3 000 FCFA
                <span className="text-base font-normal text-slate"> / mois</span>
              </p>
              <ul className="mt-4 space-y-2 text-sm text-slate">
                <li>✓ Tout Premium Élève/Étudiant</li>
                <li>✓ Création avancée de cours</li>
                <li>✓ Gestion de classes et statistiques</li>
              </ul>
              <p className="mt-6 text-xs text-slate">
                Offre Entreprise / Établissement sur devis — nous contacter.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Bandeau de confiance */}
      <section className="border-t border-mist px-6 py-8 sm:px-10">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-10 gap-y-3 text-sm text-slate">
          <span className="flex items-center gap-2">
            <Smartphone size={16} /> Accessible sur tous vos appareils
          </span>
          <span className="flex items-center gap-2">
            <ShieldCheck size={16} /> Sécurisé et fiable
          </span>
          <span className="flex items-center gap-2">
            <Headphones size={16} /> Une équipe à ton écoute
          </span>
        </div>
      </section>

      {/* Bannière publicitaire (comptes gratuits / visiteurs seulement, après consentement) : hors navigation et hors tarifs. */}
      <div className="mx-auto max-w-6xl px-6 pt-6 sm:px-10"><AdSlot slot="home_banner" /></div>

      <footer className="border-t border-mist px-6 py-8 text-center text-xs text-slate/60 sm:px-10">
        Study Helper — construit pour apprendre, pas pour donner la réponse.
      </footer>
    </main>
  );
}
