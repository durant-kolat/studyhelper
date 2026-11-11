/**
 * OBJECTIF 3 — Vérification réelle du modèle Gemini configuré (points 7, 8, 9).
 *
 * Fait un vrai appel réseau à l'API Gemini avec la clé GEMINI_API_KEY et le modèle GEMINI_MODEL
 * (ou GEMINI_PRACTICE_MODEL en passant --practice) actuellement configurés, et affiche :
 *   - la réponse du modèle si tout fonctionne ;
 *   - le code HTTP et le message d'erreur RÉELS renvoyés par Google si le modèle est invalide,
 *     indisponible pour cette clé, ou si la clé est refusée. Aucun repli automatique : ce script
 *     ne teste QUE le modèle demandé.
 *
 * Usage (depuis la racine du projet, avec un .env.local contenant une vraie clé) :
 *   npx tsx scripts/check-gemini-model.ts            # teste GEMINI_MODEL (Gemini n°1 — Assistant)
 *   npx tsx scripts/check-gemini-model.ts --practice  # teste GEMINI_PRACTICE_MODEL (Gemini n°2 — Pratique)
 *
 * Ce script n'a pas pu être exécuté dans l'environnement qui a préparé ces changements : il n'y a
 * ni accès réseau sortant, ni clé GEMINI_API_KEY réelle disponible. À exécuter sur ta machine ou
 * sur le serveur, où la clé et le réseau sont disponibles.
 */
import { readFileSync, existsSync } from "fs";

function loadDotEnvLocal() {
  const path = ".env.local";
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadDotEnvLocal();

const usePractice = process.argv.includes("--practice");
const key = (process.env.GEMINI_API_KEY ?? "").trim();
const model = usePractice
  ? (process.env.GEMINI_PRACTICE_MODEL?.trim() || "gemini-3.5-flash-lite")
  : (process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash-lite");

async function main() {
  console.log(`Modèle testé : ${model} (${usePractice ? "GEMINI_PRACTICE_MODEL — Pratique" : "GEMINI_MODEL — Assistant et autres"})`);

  if (!key) {
    console.error("❌ GEMINI_API_KEY est absente (ni variable d'environnement, ni .env.local). Impossible de tester.");
    process.exit(1);
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "Réponds uniquement par: OK" }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 10 },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const elapsed = Date.now() - started;

    if (!res.ok) {
      const body = await res.text();
      console.error(`❌ HTTP ${res.status} après ${elapsed} ms — le modèle "${model}" a été refusé par l'API.`);
      console.error("Détail réel renvoyé par Google :");
      console.error(body);
      if (res.status === 404) {
        console.error('\nUn 404 signifie généralement que cet identifiant de modèle n\'existe pas (ou plus) pour cette version d\'API ("v1beta").');
      } else if (res.status === 403) {
        console.error("\nUn 403 signifie généralement que la clé API n'a pas accès à ce modèle (ex. modèle en accès restreint / payant).");
      } else if (res.status === 429) {
        console.error("\nUn 429 signifie quota ou limite de débit dépassé pour cette clé — pas un problème d'identifiant de modèle.");
      }
      process.exit(1);
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
    if (!text.trim()) {
      const reason = data.candidates?.[0]?.finishReason ?? data.promptFeedback?.blockReason ?? "inconnue";
      console.error(`❌ Le modèle "${model}" a répondu HTTP 200 mais sans texte (raison : ${reason}).`);
      process.exit(1);
    }

    console.log(`✅ Le modèle "${model}" a répondu correctement en ${elapsed} ms.`);
    console.log(`Réponse brute : ${JSON.stringify(text)}`);
    process.exit(0);
  } catch (err) {
    console.error(`❌ Échec réseau en appelant "${model}" :`, err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();
