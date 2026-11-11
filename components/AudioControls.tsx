"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play, Settings2, Square, Volume2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/I18nProvider";
import {
  getAudioPrefs,
  isVoiceOutputSupported,
  listVoicesForLang,
  MAX_RATE,
  MIN_RATE,
  pauseSpeaking,
  resumeSpeaking,
  setAudioPrefs,
  speak,
  stopSpeaking,
  voiceAvailable,
} from "@/lib/voice";

/**
 * Lecture à voix haute d'une réponse : Lire · Pause · Reprendre · Arrêter, plus un réglage
 * (icône ⚙) pour la vitesse de lecture et le choix de la voix. La voix suit la langue choisie
 * par l'utilisateur (détection automatique si le texte est dans une autre écriture). Utilise
 * uniquement la synthèse vocale du navigateur : aucune clé, aucun coût. Les réglages sont
 * mémorisés sur l'appareil et s'appliquent à toute lecture, sur toutes les pages.
 */
export default function AudioControls({ text }: { text: string }) {
  const { t, lang } = useI18n();
  const [state, setState] = useState<"idle" | "playing" | "paused">("idle");
  const [supported, setSupported] = useState(false);
  const [noVoice, setNoVoice] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [rate, setRate] = useState(1);
  const [voiceURI, setVoiceURI] = useState<string | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const stopRef = useRef<(() => void) | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    setSupported(isVoiceOutputSupported());
    const prefs = getAudioPrefs();
    setRate(prefs.rate);
    setVoiceURI(prefs.voiceURI);
    return () => {
      mounted.current = false;
      // Quitter la page ne doit pas laisser une voix parler dans le vide.
      if (stopRef.current) stopSpeaking();
    };
  }, []);

  // La liste des voix du navigateur se charge parfois de façon asynchrone.
  useEffect(() => {
    if (!supported) return;
    function refresh() {
      setVoices(listVoicesForLang(lang));
    }
    refresh();
    window.speechSynthesis.addEventListener("voiceschanged", refresh);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", refresh);
  }, [supported, lang]);

  if (!supported) return null;

  function start() {
    setNoVoice(voiceAvailable(lang) === false);
    setState("playing");
    stopRef.current = speak(
      text,
      () => {
        stopRef.current = null;
        if (mounted.current) setState("idle");
      },
      lang
    );
  }

  function stop() {
    stopRef.current?.();
    stopRef.current = null;
    setState("idle");
  }

  function changeRate(value: number) {
    setRate(value);
    setAudioPrefs({ rate: value });
  }

  function changeVoice(value: string) {
    const next = value === "" ? null : value;
    setVoiceURI(next);
    setAudioPrefs({ voiceURI: next });
  }

  const cls = "flex items-center gap-1 rounded-full px-2 py-1 text-xs text-slate hover:bg-mist2 hover:text-ink";

  return (
    <div className="mt-1.5" role="group" aria-label={t("audio.listen")}>
      <div className="flex flex-wrap items-center gap-1">
        {state === "idle" && (
          <button type="button" onClick={start} className={cls}>
            <Volume2 size={13} />
            {t("audio.listen")}
          </button>
        )}
        {state === "playing" && (
          <button
            type="button"
            onClick={() => {
              pauseSpeaking();
              setState("paused");
            }}
            className={cls}
          >
            <Pause size={13} />
            {t("audio.pause")}
          </button>
        )}
        {state === "paused" && (
          <button
            type="button"
            onClick={() => {
              resumeSpeaking();
              setState("playing");
            }}
            className={cls}
          >
            <Play size={13} />
            {t("audio.resume")}
          </button>
        )}
        {state !== "idle" && (
          <button type="button" onClick={stop} className={cls}>
            <Square size={13} />
            {t("audio.stop")}
          </button>
        )}
        <button
          type="button"
          onClick={() => setSettingsOpen((v) => !v)}
          aria-expanded={settingsOpen}
          aria-label={t("audio.settings")}
          className={cls}
        >
          <Settings2 size={13} />
        </button>
      </div>

      {settingsOpen && (
        <div className="mt-1.5 flex flex-col gap-2 rounded-card border border-mist bg-white p-2.5 text-xs">
          <label className="flex items-center gap-2">
            <span className="w-14 shrink-0 text-slate">{t("audio.speed")}</span>
            <input
              type="range"
              min={MIN_RATE}
              max={MAX_RATE}
              step={0.1}
              value={rate}
              onChange={(e) => changeRate(parseFloat(e.target.value))}
              className="flex-1"
              aria-label={t("audio.speed")}
            />
            <span className="w-8 shrink-0 text-right tabular-nums text-ink">{rate.toFixed(1)}×</span>
          </label>
          {voices.length > 0 && (
            <label className="flex items-center gap-2">
              <span className="w-14 shrink-0 text-slate">{t("audio.voice")}</span>
              <select
                value={voiceURI ?? ""}
                onChange={(e) => changeVoice(e.target.value)}
                className="min-w-0 flex-1 rounded-card border border-mist px-2 py-1 text-ink"
                aria-label={t("audio.voice")}
              >
                <option value="">{t("audio.voiceDefault")}</option>
                {voices.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      {noVoice && <p className="mt-1 px-2 text-[11px] text-clay">{t("audio.noVoice")}</p>}
    </div>
  );
}
