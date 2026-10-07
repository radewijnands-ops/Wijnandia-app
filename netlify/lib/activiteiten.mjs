/* Activiteiten: opgeslagen in Netlify (beheerpagina). Bij de allereerste keer worden ze
   overgenomen uit public/activiteiten.json (de activiteiten van de poster). */
import { winkel } from "./gedeeld.mjs";

const sorteer = l => l.slice().sort((a, b) => (a.datum + (a.start || "")).localeCompare(b.datum + (b.start || "")));

export async function leesActiviteiten(req) {
  const st = winkel("activiteiten");
  const lijst = await st.get("lijst", { type: "json" }).catch(() => null);
  if (Array.isArray(lijst)) return sorteer(lijst);
  try {
    const r = await fetch(new URL("/activiteiten.json", req.url));
    const d = await r.json();
    const start = Array.isArray(d.activiteiten) ? d.activiteiten : [];
    await st.setJSON("lijst", start, { onlyIfNew: true });
    return sorteer(start);
  } catch { return []; }
}

export async function bewaarActiviteiten(lijst) {
  await winkel("activiteiten").setJSON("lijst", sorteer(lijst));
}

/* Controle van een activiteit uit het beheerformulier */
export function controleer(d) {
  const kort = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
  const a = {
    titel: kort(d?.titel, 80), datum: kort(d?.datum, 10),
    start: kort(d?.start, 5), eind: kort(d?.eind, 5),
    locatie: kort(d?.locatie, 100), omschrijving: String(d?.omschrijving ?? "").trim().slice(0, 500)
  };
  if (a.titel.length < 2) return { fout: "Vul een naam van de activiteit in." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.datum) || isNaN(new Date(a.datum + "T12:00"))) return { fout: "Vul een geldige datum in." };
  for (const k of ["start", "eind"]) if (a[k] && !/^([01]\d|2[0-3]):[0-5]\d$/.test(a[k])) return { fout: "Vul een geldige tijd in (uu:mm)." };
  if (!a.start) a.eind = "";
  if (a.start && a.eind && a.eind <= a.start) return { fout: "De eindtijd moet na de begintijd liggen." };
  return { activiteit: a };
}
