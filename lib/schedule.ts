export type PlanItem = {
  start_time: string; // "HH:MM"
  end_time: string; // "HH:MM" — égal à start_time pour un simple repère sans durée
  title: string;
  subject: string | null; // matière réelle, ou null pour réveil/pause/école
  is_exam: boolean;
};

function addMinutes(time: string, minutes: number) {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const hh = Math.floor((total % (24 * 60)) / 60);
  const mm = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export function minutesBetween(a: string, b: string) {
  const [ah, am] = a.split(":").map(Number);
  const [bh, bm] = b.split(":").map(Number);
  return bh * 60 + bm - (ah * 60 + am);
}

/**
 * Construit le planning de révision du matin selon la règle simple du
 * cahier des charges : 1 matière = 1h, +30 min pour l'examen Study Helper.
 * Les matières les plus faibles (score le plus bas) passent en premier.
 */
export function buildMorningPlan({
  wakeTime,
  departureTime,
  prayerTime,
  subjects,
}: {
  wakeTime: string;
  departureTime: string;
  prayerTime?: string | null;
  subjects: { subject: string; percent: number }[];
}): PlanItem[] {
  const items: PlanItem[] = [
    { start_time: wakeTime, end_time: wakeTime, title: "Réveil", subject: null, is_exam: false },
  ];

  const prepBuffer = 30; // minutes réservées avant le départ pour se préparer
  const available = Math.max(
    0,
    minutesBetween(wakeTime, departureTime) - prepBuffer
  );

  const ordered = [...subjects].sort((a, b) => a.percent - b.percent);

  let cursor = wakeTime;
  let remaining = available;
  const chosen: string[] = [];

  for (const s of ordered) {
    if (remaining < 60) break;
    items.push({
      start_time: cursor,
      end_time: addMinutes(cursor, 60),
      title: s.subject,
      subject: s.subject,
      is_exam: false,
    });
    chosen.push(s.subject);
    cursor = addMinutes(cursor, 60);
    remaining -= 60;
  }

  if (chosen.length > 0 && remaining >= 30) {
    items.push({
      start_time: cursor,
      end_time: addMinutes(cursor, 30),
      title: "Examen Study Helper",
      subject: null,
      is_exam: true,
    });
    cursor = addMinutes(cursor, 30);
  }

  if (prayerTime) {
    items.push({
      start_time: prayerTime,
      end_time: prayerTime,
      title: "Temps de prière",
      subject: null,
      is_exam: false,
    });
  }

  items.push({
    start_time: cursor,
    end_time: cursor,
    title: "Préparation",
    subject: null,
    is_exam: false,
  });
  items.push({
    start_time: departureTime,
    end_time: departureTime,
    title: "École",
    subject: null,
    is_exam: false,
  });

  return items.sort((a, b) => (a.start_time > b.start_time ? 1 : -1));
}
