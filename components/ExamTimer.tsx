"use client";

import { useEffect, useRef, useState } from "react";

export default function ExamTimer({
  minutes = 30,
  onExpire,
}: {
  minutes?: number;
  onExpire?: () => void;
}) {
  const [secondsLeft, setSecondsLeft] = useState(minutes * 60);
  const expiredRef = useRef(false);

  useEffect(() => {
    const id = setInterval(() => {
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (secondsLeft === 0 && !expiredRef.current) {
      expiredRef.current = true;
      onExpire?.();
    }
  }, [secondsLeft, onExpire]);

  const m = Math.floor(secondsLeft / 60);
  const s = secondsLeft % 60;
  const low = secondsLeft < 60;

  return (
    <div
      className={`flex items-center gap-2 rounded-card border px-4 py-2 font-display text-lg ${
        low ? "border-clay text-clay" : "border-mist text-ink"
      }`}
    >
      <span>⏱</span>
      <span>
        {String(m).padStart(2, "0")}:{String(s).padStart(2, "0")}
      </span>
    </div>
  );
}
