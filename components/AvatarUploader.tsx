"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, Trash2 } from "lucide-react";
import Avatar from "./Avatar";
import { AVATAR_ACCEPT } from "@/lib/avatar";
import { AvatarError, announceAvatarChanged, prepareAvatarImage } from "@/lib/avatar-client";
import { removeAvatar, uploadAvatar } from "@/lib/api";

/**
 * Sélection → envoi → affichage immédiat de la photo de profil.
 * L'aperçu local apparaît tout de suite ; l'URL enregistrée (profiles.avatar_url)
 * prend ensuite le relais. Elle change à chaque envoi : pas de problème de cache.
 */
export default function AvatarUploader({
  avatarUrl,
  name,
  onChange,
}: {
  avatarUrl: string | null;
  name: string;
  onChange: (url: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  // Libère l'aperçu local quand il n'est plus utile.
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  async function handleFile(file: File) {
    setError(null);
    setBusy(true);
    try {
      const blob = await prepareAvatarImage(file);
      setPreview(URL.createObjectURL(blob)); // visible immédiatement
      const url = await uploadAvatar(blob);
      onChange(url);
      announceAvatarChanged(url);
      setPreview(null); // l'URL enregistrée prend le relais
    } catch (err) {
      setPreview(null);
      setError(
        err instanceof AvatarError || err instanceof Error
          ? err.message
          : "L'envoi de la photo a échoué. Réessaie."
      );
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = ""; // permet de rechoisir le même fichier
    }
  }

  async function handleRemove() {
    setError(null);
    setBusy(true);
    try {
      await removeAvatar();
      onChange(null);
      announceAvatarChanged(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de retirer la photo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-4">
      <div className="relative">
        <Avatar src={preview ?? avatarUrl} name={name} size={64} />
        {busy && (
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-paper/70">
            <Loader2 size={20} className="animate-spin text-clay" />
          </span>
        )}
      </div>
      <div className="min-w-0">
        <input
          ref={inputRef}
          type="file"
          accept={AVATAR_ACCEPT}
          className="hidden"
          aria-label="Choisir une photo de profil"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-card border border-mist px-3 py-1.5 text-xs text-ink hover:border-ink disabled:opacity-60"
          >
            <Camera size={13} />
            {avatarUrl ? "Changer la photo" : "Ajouter une photo"}
          </button>
          {avatarUrl && (
            <button
              type="button"
              onClick={handleRemove}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-card px-3 py-1.5 text-xs text-slate hover:text-clay disabled:opacity-60"
            >
              <Trash2 size={13} />
              Retirer
            </button>
          )}
        </div>
        <p className="mt-1 text-[11px] text-slate/70">JPG, PNG ou WebP — 2 Mo max.</p>
        {error && (
          <p role="alert" className="mt-1 text-xs text-clay">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
