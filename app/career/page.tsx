"use client";

import { useEffect, useRef, useState } from "react";
import AppShell from "@/components/AppShell";
import { supabase } from "@/lib/supabase";
import {
  generateCV,
  generateCoverLetter,
  askInterviewer,
  getOrientation,
  OrientationPath,
  ChatMessage,
  CVData,
} from "@/lib/api";
import {
  FileText,
  Mail,
  Phone,
  MapPin,
  MessageSquare,
  Loader2,
  Copy,
  Send,
  Download,
  Briefcase,
  Compass,
  Plus,
  Trash2,
  ExternalLink,
} from "lucide-react";
import { downloadTextAsPdf } from "@/lib/pdf-export";
import { downloadTextAsDocx } from "@/lib/docx-export";
import { downloadCVAsPdf } from "@/lib/cv-template";
import { downloadCVAsDocx } from "@/lib/cv-template-docx";

type Tab = "cv" | "letter" | "interview" | "portfolio" | "orientation";

export default function CareerPage() {
  const [tab, setTab] = useState<Tab>("cv");

  return (
    <AppShell active="career" title="Espace Carrière">
      <div className="mb-6 flex flex-wrap gap-2">
        {[
          { key: "cv", label: "CV", icon: FileText },
          { key: "letter", label: "Lettre de motivation", icon: Mail },
          { key: "interview", label: "Simulation d'entretien", icon: MessageSquare },
          { key: "portfolio", label: "Portfolio", icon: Briefcase },
          { key: "orientation", label: "Orientation", icon: Compass },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key as Tab)}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs ${
              tab === t.key ? "bg-ink text-paper" : "border border-mist text-slate"
            }`}
          >
            <t.icon size={13} /> {t.label}
          </button>
        ))}
      </div>

      {tab === "cv" && <CVTab />}
      {tab === "letter" && <LetterTab />}
      {tab === "interview" && <InterviewTab />}
      {tab === "portfolio" && <PortfolioTab />}
      {tab === "orientation" && <OrientationTab />}
    </AppShell>
  );
}

function CVTab() {
  const [fields, setFields] = useState({
    fullName: "",
    targetRole: "",
    email: "",
    phone: "",
    location: "",
    education: "",
    experience: "",
    skills: "",
  });
  const [result, setResult] = useState<CVData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatingDocx, setGeneratingDocx] = useState(false);

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const cv = await generateCV(fields);
      setResult(cv);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue.");
    } finally {
      setLoading(false);
    }
  }

  const baseFilename = `CV_${fields.fullName || "sans-nom"}`;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form onSubmit={handleGenerate} className="space-y-3 rounded-card border border-mist bg-white p-5">
        <Field label="Nom complet" value={fields.fullName} onChange={(v) => setFields({ ...fields, fullName: v })} required />
        <Field label="Poste visé" value={fields.targetRole} onChange={(v) => setFields({ ...fields, targetRole: v })} required />
        <div className="grid grid-cols-2 gap-3">
          <Field label="E-mail" value={fields.email} onChange={(v) => setFields({ ...fields, email: v })} />
          <Field label="Téléphone" value={fields.phone} onChange={(v) => setFields({ ...fields, phone: v })} />
        </div>
        <Field label="Ville" value={fields.location} onChange={(v) => setFields({ ...fields, location: v })} />
        <Field label="Formation" value={fields.education} onChange={(v) => setFields({ ...fields, education: v })} textarea />
        <Field label="Expérience" value={fields.experience} onChange={(v) => setFields({ ...fields, experience: v })} textarea />
        <Field label="Compétences" value={fields.skills} onChange={(v) => setFields({ ...fields, skills: v })} textarea />
        {error && <p className="text-sm text-clay">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="flex items-center gap-2 rounded-card bg-clay px-4 py-2 text-sm text-paper hover:bg-clay/90 disabled:opacity-60"
        >
          {loading ? <Loader2 size={15} className="animate-spin" /> : null}
          {loading ? "Génération…" : "Générer mon CV"}
        </button>
      </form>

      {!result ? (
        <div className="rounded-card border border-mist bg-white p-5">
          <p className="text-sm text-slate">Ton CV généré apparaîtra ici.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-card border border-mist bg-white">
          <div className="flex justify-end gap-2 border-b border-mist bg-mist2 p-3">
            <button
              onClick={() => downloadCVAsPdf(result, `${baseFilename}.pdf`)}
              className="flex items-center gap-1 rounded-card border border-mist bg-white px-2 py-1 text-xs text-slate hover:border-ink"
            >
              <Download size={12} /> PDF
            </button>
            <button
              onClick={async () => {
                setGeneratingDocx(true);
                await downloadCVAsDocx(result, `${baseFilename}.docx`);
                setGeneratingDocx(false);
              }}
              disabled={generatingDocx}
              className="flex items-center gap-1 rounded-card border border-mist bg-white px-2 py-1 text-xs text-slate hover:border-ink disabled:opacity-60"
            >
              <Download size={12} /> {generatingDocx ? "…" : "Word"}
            </button>
          </div>

          <div className="flex">
            <div className="w-2/5 space-y-5 bg-ink p-6 text-paper">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gold/20 font-display text-xl text-gold ring-2 ring-gold/40">
                {result.fullName
                  .split(" ")
                  .filter(Boolean)
                  .slice(0, 2)
                  .map((w) => w[0]?.toUpperCase())
                  .join("") || "?"}
              </div>
              <div>
                <p className="font-display text-xl leading-tight">{result.fullName}</p>
                <p className="mt-1 inline-block rounded-full bg-gold/15 px-2.5 py-0.5 text-xs font-medium text-gold">
                  {result.targetRole}
                </p>
              </div>
              {(result.email || result.phone || result.location) && (
                <div className="space-y-1.5 border-t border-paper/15 pt-4 text-xs text-paper/80">
                  {result.email && (
                    <div className="flex items-center gap-2">
                      <Mail size={12} className="shrink-0 text-gold" />
                      <span className="break-all">{result.email}</span>
                    </div>
                  )}
                  {result.phone && (
                    <div className="flex items-center gap-2">
                      <Phone size={12} className="shrink-0 text-gold" />
                      <span>{result.phone}</span>
                    </div>
                  )}
                  {result.location && (
                    <div className="flex items-center gap-2">
                      <MapPin size={12} className="shrink-0 text-gold" />
                      <span>{result.location}</span>
                    </div>
                  )}
                </div>
              )}
              {result.skills?.length > 0 && (
                <div className="border-t border-paper/15 pt-4">
                  <p className="mb-2 text-xs font-semibold tracking-wide text-gold">
                    COMPÉTENCES
                  </p>
                  <ul className="space-y-1.5 text-xs text-paper/90">
                    {result.skills.map((s, i) => (
                      <li key={i} className="flex items-start gap-1.5">
                        <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-gold" />
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <div className="w-3/5 space-y-5 p-6">
              <div>
                <p className="mb-1.5 text-xs font-semibold tracking-wide text-clay">
                  PROFIL
                </p>
                <p className="text-sm leading-relaxed text-ink">{result.tagline}</p>
              </div>
              {result.experience?.length > 0 && (
                <div className="border-t border-mist pt-4">
                  <p className="mb-2.5 text-xs font-semibold tracking-wide text-clay">
                    EXPÉRIENCE
                  </p>
                  <div className="space-y-3">
                    {result.experience.map((e, i) => (
                      <div key={i} className="border-l-2 border-mist pl-3">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-sm font-medium text-ink">{e.title}</span>
                          <span className="shrink-0 text-xs font-medium text-clay">{e.period}</span>
                        </div>
                        {e.detail && (
                          <p className="mt-0.5 text-xs leading-relaxed text-slate">{e.detail}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {result.education?.length > 0 && (
                <div className="border-t border-mist pt-4">
                  <p className="mb-2.5 text-xs font-semibold tracking-wide text-clay">
                    FORMATION
                  </p>
                  <div className="space-y-3">
                    {result.education.map((e, i) => (
                      <div key={i} className="border-l-2 border-mist pl-3">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-sm font-medium text-ink">{e.title}</span>
                          <span className="shrink-0 text-xs font-medium text-clay">{e.period}</span>
                        </div>
                        {e.detail && (
                          <p className="mt-0.5 text-xs leading-relaxed text-slate">{e.detail}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LetterTab() {
  const [fields, setFields] = useState({
    fullName: "",
    targetRole: "",
    company: "",
    strengths: "",
  });
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const letter = await generateCoverLetter(fields);
      setResult(letter);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form onSubmit={handleGenerate} className="space-y-3 rounded-card border border-mist bg-white p-5">
        <Field label="Nom complet" value={fields.fullName} onChange={(v) => setFields({ ...fields, fullName: v })} required />
        <Field label="Poste visé" value={fields.targetRole} onChange={(v) => setFields({ ...fields, targetRole: v })} required />
        <Field label="Entreprise" value={fields.company} onChange={(v) => setFields({ ...fields, company: v })} />
        <Field label="Tes points forts" value={fields.strengths} onChange={(v) => setFields({ ...fields, strengths: v })} textarea />
        {error && <p className="text-sm text-clay">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="flex items-center gap-2 rounded-card bg-clay px-4 py-2 text-sm text-paper hover:bg-clay/90 disabled:opacity-60"
        >
          {loading ? <Loader2 size={15} className="animate-spin" /> : null}
          {loading ? "Génération…" : "Générer ma lettre"}
        </button>
      </form>
      <ResultPanel
        content={result}
        placeholder="Ta lettre générée apparaîtra ici."
        baseFilename={`Lettre_${fields.fullName || "sans-nom"}`}
      />
    </div>
  );
}

function InterviewTab() {
  const [targetRole, setTargetRole] = useState("");
  const [started, setStarted] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleStart(e: React.FormEvent) {
    e.preventDefault();
    if (!targetRole.trim()) return;
    setStarted(true);
    setSending(true);
    try {
      const reply = await askInterviewer(
        targetRole,
        "Bonjour, je suis prêt(e) à commencer l'entretien.",
        []
      );
      setMessages([{ role: "assistant", content: reply }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue.");
    } finally {
      setSending(false);
    }
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setSending(true);
    setError(null);
    try {
      const reply = await askInterviewer(targetRole, text, messages);
      setMessages([...next, { role: "assistant", content: reply }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue.");
    } finally {
      setSending(false);
    }
  }

  if (!started) {
    return (
      <form onSubmit={handleStart} className="max-w-md space-y-3 rounded-card border border-mist bg-white p-5">
        <Field label="Poste visé pour cet entretien" value={targetRole} onChange={setTargetRole} required />
        <button
          type="submit"
          disabled={sending}
          className="flex items-center gap-2 rounded-card bg-clay px-4 py-2 text-sm text-paper hover:bg-clay/90 disabled:opacity-60"
        >
          {sending ? <Loader2 size={15} className="animate-spin" /> : null}
          {sending ? "Préparation…" : "Démarrer l'entretien"}
        </button>
        {error && <p className="text-sm text-clay">{error}</p>}
      </form>
    );
  }

  return (
    <div className="flex h-[calc(100vh-220px)] flex-col rounded-card border border-mist bg-white">
      <div className="flex-1 space-y-3 overflow-y-auto p-5">
        {messages.map((m, i) => (
          <div
            key={i}
            className={`max-w-md whitespace-pre-wrap rounded-card px-4 py-3 text-sm ${
              m.role === "user" ? "ml-auto bg-ink text-paper" : "bg-mist2 text-ink"
            }`}
          >
            {m.content}
          </div>
        ))}
        {sending && (
          <div className="flex items-center gap-2 rounded-card bg-mist2 px-4 py-3 text-sm text-slate">
            <Loader2 size={14} className="animate-spin" /> Le recruteur réfléchit…
          </div>
        )}
        {error && <p className="text-sm text-clay">{error}</p>}
        <div ref={bottomRef} />
      </div>
      <form onSubmit={handleSend} className="flex items-center gap-2 border-t border-mist p-4">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ta réponse…"
          className="flex-1 rounded-card border border-mist px-4 py-2.5 text-sm outline-none focus:border-ink"
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          className="rounded-card bg-clay p-2.5 text-paper hover:bg-clay/90 disabled:opacity-50"
        >
          <Send size={18} />
        </button>
      </form>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  required,
  textarea,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  textarea?: boolean;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm text-slate">{label}</label>
      {textarea ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={2}
          className="w-full rounded-card border border-mist px-3 py-2 text-sm"
        />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          className="w-full rounded-card border border-mist px-3 py-2 text-sm"
        />
      )}
    </div>
  );
}

function ResultPanel({
  content,
  placeholder,
  baseFilename,
}: {
  content: string | null;
  placeholder: string;
  baseFilename?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [generatingDocx, setGeneratingDocx] = useState(false);

  async function handleCopy() {
    if (!content) return;
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function handleDownloadPdf() {
    if (!content) return;
    downloadTextAsPdf(content, `${baseFilename ?? "document"}.pdf`);
  }

  async function handleDownloadDocx() {
    if (!content) return;
    setGeneratingDocx(true);
    await downloadTextAsDocx(content, `${baseFilename ?? "document"}.docx`);
    setGeneratingDocx(false);
  }

  return (
    <div
      className={`relative rounded-card border border-mist bg-white p-5 ${
        content ? "pt-14" : ""
      }`}
    >
      {content && (
        <div className="absolute right-4 top-4 flex flex-wrap justify-end gap-2">
          <button
            onClick={handleDownloadPdf}
            className="flex items-center gap-1 rounded-card border border-mist px-2 py-1 text-xs text-slate hover:border-ink"
          >
            <Download size={12} /> PDF
          </button>
          <button
            onClick={handleDownloadDocx}
            disabled={generatingDocx}
            className="flex items-center gap-1 rounded-card border border-mist px-2 py-1 text-xs text-slate hover:border-ink disabled:opacity-60"
          >
            <Download size={12} /> {generatingDocx ? "…" : "Word"}
          </button>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 rounded-card border border-mist px-2 py-1 text-xs text-slate hover:border-ink"
          >
            <Copy size={12} /> {copied ? "Copié !" : "Copier"}
          </button>
        </div>
      )}
      {content ? (
        <pre className="whitespace-pre-wrap font-body text-sm text-ink">
          {content}
        </pre>
      ) : (
        <p className="text-sm text-slate">{placeholder}</p>
      )}
    </div>
  );
}

type PortfolioItem = {
  id: string;
  title: string;
  description: string | null;
  link: string | null;
  technologies: string[];
};

function PortfolioTab() {
  const [items, setItems] = useState<PortfolioItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", link: "", tags: "" });

  async function load() {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;
    const { data } = await supabase
      .from("portfolio_items")
      .select("id, title, description, link, technologies")
      .eq("owner_id", userData.user.id)
      .order("created_at", { ascending: false });
    setItems(data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;
    setSaving(true);
    await supabase.from("portfolio_items").insert({
      owner_id: userData.user.id,
      title: form.title,
      description: form.description || null,
      link: form.link || null,
      // technologies est NOT NULL en base : tableau vide plutôt que null.
      technologies: form.tags
        ? form.tags.split(",").map((t) => t.trim()).filter(Boolean)
        : [],
    });
    setSaving(false);
    setShowForm(false);
    setForm({ title: "", description: "", link: "", tags: "" });
    load();
  }

  async function handleDelete(id: string) {
    await supabase.from("portfolio_items").delete().eq("id", id);
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <button
          onClick={() => setShowForm((s) => !s)}
          className="flex items-center gap-2 rounded-card bg-clay px-4 py-2 text-sm text-paper hover:bg-clay/90"
        >
          <Plus size={16} /> Ajouter un projet
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleAdd} className="mb-6 space-y-3 rounded-card border border-mist bg-white p-4">
          <Field label="Titre du projet" value={form.title} onChange={(v) => setForm({ ...form, title: v })} required />
          <Field label="Description" value={form.description} onChange={(v) => setForm({ ...form, description: v })} textarea />
          <Field label="Lien (GitHub, démo...)" value={form.link} onChange={(v) => setForm({ ...form, link: v })} />
          <Field label="Technologies (séparées par des virgules)" value={form.tags} onChange={(v) => setForm({ ...form, tags: v })} />
          <button
            type="submit"
            disabled={saving}
            className="rounded-card bg-ink px-4 py-2 text-sm text-paper hover:bg-ink/90 disabled:opacity-60"
          >
            {saving ? "Ajout…" : "Ajouter"}
          </button>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-slate">Chargement…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-slate">
          Aucun projet pour l'instant — ajoute le premier ci-dessus.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {items.map((item) => (
            <div key={item.id} className="rounded-card border border-mist bg-white p-4">
              <div className="flex items-start justify-between">
                <p className="font-display text-base text-ink">{item.title}</p>
                <button onClick={() => handleDelete(item.id)} className="text-slate hover:text-clay">
                  <Trash2 size={14} />
                </button>
              </div>
              {item.description && <p className="mt-1 text-sm text-slate">{item.description}</p>}
              {item.technologies && item.technologies.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {item.technologies.map((t) => (
                    <span key={t} className="rounded-full bg-mist2 px-2 py-0.5 text-[11px] text-slate">
                      {t}
                    </span>
                  ))}
                </div>
              )}
              {item.link && (
                <a
                  href={item.link}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-sm text-clay hover:underline"
                >
                  Voir le projet <ExternalLink size={13} />
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OrientationTab() {
  const [fields, setFields] = useState({
    favoriteSubjects: "",
    interests: "",
    skills: "",
    constraints: "",
  });
  const [paths, setPaths] = useState<OrientationPath[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const result = await getOrientation(fields);
      setPaths(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form onSubmit={handleSubmit} className="space-y-3 rounded-card border border-mist bg-white p-5">
        <Field
          label="Tes matières préférées"
          value={fields.favoriteSubjects}
          onChange={(v) => setFields({ ...fields, favoriteSubjects: v })}
          required
        />
        <Field
          label="Tes centres d'intérêt"
          value={fields.interests}
          onChange={(v) => setFields({ ...fields, interests: v })}
          textarea
        />
        <Field
          label="Tes compétences"
          value={fields.skills}
          onChange={(v) => setFields({ ...fields, skills: v })}
          textarea
        />
        <Field
          label="Contraintes (budget, lieu, durée d'études...)"
          value={fields.constraints}
          onChange={(v) => setFields({ ...fields, constraints: v })}
          textarea
        />
        {error && <p className="text-sm text-clay">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="flex items-center gap-2 rounded-card bg-clay px-4 py-2 text-sm text-paper hover:bg-clay/90 disabled:opacity-60"
        >
          {loading ? <Loader2 size={15} className="animate-spin" /> : null}
          {loading ? "Analyse…" : "Trouver des pistes"}
        </button>
      </form>

      <div className="space-y-3">
        {!paths ? (
          <div className="rounded-card border border-mist bg-white p-5">
            <p className="text-sm text-slate">
              Tes pistes d'orientation apparaîtront ici.
            </p>
          </div>
        ) : (
          paths.map((p, i) => (
            <div key={i} className="rounded-card border border-mist bg-white p-5">
              <p className="font-display text-base text-ink">{p.title}</p>
              <p className="mt-1 text-sm text-slate">{p.why}</p>
              <p className="mt-2 rounded-card bg-mist2 px-3 py-2 text-xs text-ink">
                💡 {p.next_steps}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
