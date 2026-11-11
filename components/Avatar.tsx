"use client";

import { useEffect, useState } from "react";

function initialsOf(name: string | null | undefined) {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase();
}

/**
 * Photo de profil ronde. Sans photo (ou si l'image ne charge pas), affiche une
 * image par défaut : les initiales de l'utilisateur sur fond doré.
 */
export default function Avatar({
  src,
  name,
  size = 32,
  className = "",
}: {
  src?: string | null;
  name?: string | null;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);

  const box = { width: size, height: size };
  if (src && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name ? `Photo de ${name}` : "Photo de profil"}
        width={size}
        height={size}
        onError={() => setFailed(true)}
        style={box}
        className={`shrink-0 rounded-full object-cover ${className}`}
      />
    );
  }
  return (
    <div
      aria-hidden="true"
      style={{ ...box, fontSize: Math.max(11, Math.round(size * 0.4)) }}
      className={`flex shrink-0 select-none items-center justify-center rounded-full bg-gold/30 font-display text-ink ${className}`}
    >
      {initialsOf(name)}
    </div>
  );
}
