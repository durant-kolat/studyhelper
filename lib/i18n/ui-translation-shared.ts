// Découpage commun (serveur + navigateur) de l'interface anglaise en morceaux à traduire.
import { en } from "./dictionaries/en";

export const UI_CHUNK_SIZE = 50;

const KEYS = Object.keys(en);

export function uiPartCount(): number {
  return Math.ceil(KEYS.length / UI_CHUNK_SIZE);
}

/** Textes anglais d'un morceau (clé → texte). */
export function uiPart(part: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of KEYS.slice(part * UI_CHUNK_SIZE, (part + 1) * UI_CHUNK_SIZE)) out[k] = (en as Record<string, string>)[k];
  return out;
}

/** Empreinte de l'interface anglaise : si les textes changent, les traductions en cache sont refaites. */
export function uiVersion(): string {
  let h = 0;
  for (const k of KEYS) {
    const v = (en as Record<string, string>)[k];
    for (let i = 0; i < v.length; i++) h = (h * 31 + v.charCodeAt(i)) | 0;
  }
  return `${KEYS.length}-${(h >>> 0).toString(36)}`;
}

/** Variables {n}, {name}… d'un texte : une traduction valide doit contenir exactement les mêmes. */
export function placeholders(text: string): string {
  return (text.match(/\{\w+\}/g) ?? []).sort().join("|");
}
