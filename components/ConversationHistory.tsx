"use client";

import { useEffect, useState } from "react";
import { Trash2, X } from "lucide-react";
import { deleteAllConversations, deleteConversation, listConversations, loadConversation, type SavedConversation, type StoredMessage } from "@/lib/conversations";

/** Panneau « Historique » du chat global : consulter, rouvrir et supprimer ses conversations (privées, protégées par RLS). */
export default function ConversationHistory({
  open,
  onClose,
  currentId,
  onOpen,
  onDeleted,
}: {
  open: boolean;
  onClose: () => void;
  currentId: string | null;
  onOpen: (id: string, messages: StoredMessage[]) => void;
  onDeleted: (id: string | "all") => void;
}) {
  const [items, setItems] = useState<SavedConversation[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setItems(null);
    setError(null);
    listConversations().then(setItems).catch(() => setError("Impossible de charger l'historique."));
  }, [open]);

  if (!open) return null;

  async function openOne(id: string) {
    const msgs = await loadConversation(id);
    if (!msgs) return setError("Cette conversation est introuvable.");
    onOpen(id, msgs);
    onClose();
  }
  async function removeOne(id: string) {
    if (!(await deleteConversation(id))) return setError("Suppression impossible. Réessaie.");
    setItems((l) => (l ?? []).filter((c) => c.id !== id));
    onDeleted(id);
  }
  async function removeAll() {
    if (!window.confirm("Supprimer toutes tes conversations ? Cette action est définitive.")) return;
    if (!(await deleteAllConversations())) return setError("Suppression impossible. Réessaie.");
    setItems([]);
    onDeleted("all");
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/40" role="dialog" aria-modal="true" aria-label="Historique des conversations" onClick={onClose}>
      <div className="flex h-full w-full max-w-sm flex-col bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-mist px-4 py-3">
          <p className="font-display text-base text-ink">Mes conversations</p>
          <button type="button" onClick={onClose} aria-label="Fermer" className="text-slate hover:text-ink">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {error && <p role="alert" className="mb-2 text-xs text-clay">{error}</p>}
          {items === null && !error && <p className="text-sm text-slate">Chargement…</p>}
          {items?.length === 0 && <p className="text-sm text-slate">Aucune conversation enregistrée pour le moment.</p>}
          <ul className="space-y-2">
            {items?.map((c) => (
              <li key={c.id} className={`flex items-center gap-2 rounded-card border px-3 py-2 ${c.id === currentId ? "border-forest/40 bg-forest/5" : "border-mist"}`}>
                <button type="button" onClick={() => openOne(c.id)} className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-sm text-ink">{c.title}</span>
                  <span className="block text-xs text-slate">{new Date(c.updated_at).toLocaleString()}</span>
                </button>
                <button type="button" onClick={() => removeOne(c.id)} aria-label={`Supprimer « ${c.title} »`} className="text-slate hover:text-clay">
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
        </div>
        {items && items.length > 0 && (
          <div className="border-t border-mist p-3">
            <button type="button" onClick={removeAll} className="w-full rounded-card border border-clay/40 px-3 py-2 text-xs text-clay hover:bg-clay/5">
              Supprimer tout l&apos;historique
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
