// Coordination minimale entre les outils flottants (calculatrice, horloge).
// Chaque outil reste INDÉPENDANT (aucun état partagé, aucun parent commun) :
// quand l'un s'ouvre, il le signale par un événement navigateur et les
// autres se replient — leurs panneaux ne se chevauchent donc jamais, quelle
// que soit la taille de l'écran.

export type ToolId = "calculator" | "clock";

const EVENT_NAME = "sh:tool-open";

export function announceToolOpen(id: ToolId) {
  window.dispatchEvent(new CustomEvent<ToolId>(EVENT_NAME, { detail: id }));
}

/** Appelle `close` quand un AUTRE outil s'ouvre. Renvoie la fonction de nettoyage. */
export function onOtherToolOpen(id: ToolId, close: () => void) {
  const handler = (event: Event) => {
    if ((event as CustomEvent<ToolId>).detail !== id) close();
  };
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}

/** Signal envoyé par la page Paramètres quand le fuseau horaire change. */
export const TIMEZONE_CHANGED_EVENT = "sh:timezone-changed";

export function announceTimezoneChanged(timezone: string) {
  window.dispatchEvent(new CustomEvent<string>(TIMEZONE_CHANGED_EVENT, { detail: timezone }));
}
