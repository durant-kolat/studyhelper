"use client";

import { getStoredLanguage, languageHeader } from "@/lib/i18n/client";
import { useEffect, useRef, useState } from "react";
import { Download, Image as ImageIcon, Loader2, Maximize2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useI18n } from "@/lib/i18n/I18nProvider";
import FullscreenViewer from "./FullscreenViewer";

/**
 * Explication visuelle d'une réponse : schéma annoté (flèches, numéros, légendes) dans la langue choisie.
 * Le SVG vient du serveur (déjà vérifié) et est affiché via <img src="data:…"> : aucun script possible.
 * `autoStart` : l'utilisateur a explicitement demandé « Montre-moi / Fais un schéma… ».
 */
export default function VisualExplain({ topic, context, autoStart = false }: { topic: string; context: string; autoStart?: boolean }) {
  const { t } = useI18n();
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [src, setSrc] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  const started = useRef(false);

  async function generate() {
    if (state === "loading") return;
    setState("loading");
    setMessage(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const res = await fetch("/api/visual", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...languageHeader(), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ topic: topic.slice(0, 500), context: context.slice(0, 3000), language: getStoredLanguage() ?? undefined }),
      });
      const json = (await res.json().catch(() => null)) as { svg?: string; error?: string; code?: string } | null;
      if (!res.ok || !json?.svg) {
        setMessage(res.status === 429 && json?.code === "too_many_requests" ? t("visual.tooMany") : json?.error ?? t("visual.error"));
        setState("error");
        return;
      }
      // base64 UTF-8 sûr (les légendes peuvent contenir de l'arabe, du chinois…).
      const b64 = btoa(String.fromCharCode(...Array.from(new TextEncoder().encode(json.svg))));
      setSrc(`data:image/svg+xml;base64,${b64}`);
      setState("done");
    } catch {
      setMessage(t("error.network"));
      setState("error");
    }
  }

  useEffect(() => {
    if (autoStart && !started.current) {
      started.current = true;
      void generate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

  if (state === "idle") {
    return (
      <button type="button" onClick={generate} className="mt-1.5 flex items-center gap-1 rounded-full px-2 py-1 text-xs text-slate hover:bg-mist2 hover:text-ink">
        <ImageIcon size={13} />
        {t("visual.generate")}
      </button>
    );
  }
  if (state === "loading") {
    return (
      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-slate">
        <Loader2 size={13} className="animate-spin" />
        {t("visual.loading")}
      </p>
    );
  }
  if (state === "error") {
    return (
      <div className="mt-1.5 text-xs text-clay" role="alert">
        {message}{" "}
        <button type="button" onClick={generate} className="underline">
          {t("common.retry")}
        </button>
      </div>
    );
  }
  return (
    <div className="mt-2 max-w-[94%]">
      <button type="button" onClick={() => setFull(true)} className="group relative block w-full overflow-hidden rounded-card border border-mist bg-white" aria-label={t("visual.title")}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src ?? ""} alt={t("visual.title")} className="block h-auto w-full" />
        <span className="absolute right-2 top-2 rounded-full bg-ink/70 p-1.5 text-paper">
          <Maximize2 size={14} />
        </span>
      </button>
      <a
        href={src ?? "#"}
        download={`${topic.slice(0, 60).replace(/[^\p{L}\p{N}]+/gu, "-") || "schema"}.svg`}
        className="mt-1.5 flex w-fit items-center gap-1 rounded-full px-2 py-1 text-xs text-slate hover:bg-mist2 hover:text-ink"
      >
        <Download size={13} />
        {t("visual.download")}
      </a>
      {full && src && <FullscreenViewer url={src} kind="image" title={t("visual.title")} onClose={() => setFull(false)} />}
    </div>
  );
}
