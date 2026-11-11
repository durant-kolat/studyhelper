"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import ProgressCard, { SubjectProgress } from "@/components/ProgressCard";
import { supabase } from "@/lib/supabase";
import { fetchSubjectProgress } from "@/lib/api";

export default function ProgressPage() {
  const [progress, setProgress] = useState<SubjectProgress[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return;
      setProgress(await fetchSubjectProgress(userData.user.id));
      setLoading(false);
    }
    load();
  }, []);

  return (
    <AppShell active="progress" title="Progression">
      {loading ? (
        <p className="text-sm text-slate">Chargement…</p>
      ) : progress.length === 0 ? (
        <p className="text-sm text-slate">
          Pas encore de résultat d'examen — ta progression apparaîtra ici.
        </p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <ProgressCard data={progress} />
        </div>
      )}
    </AppShell>
  );
}
