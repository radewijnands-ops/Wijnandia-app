/*
  Clubnieuws (openbaar lezen).
  GET /api/nieuws -> { berichten: [{ id, titel, tekst, link, t }] }  (nieuwste eerst, max. 30)
  Plaatsen en verwijderen gaat via /api/beheer (met wachtwoord).
*/
import { winkel, json } from "../lib/gedeeld.mjs";

export async function leesNieuws(max = 30) {
  const st = winkel("nieuws");
  const { blobs } = await st.list();
  // sleutels zijn tijdcodes: omgekeerd sorteren = nieuwste eerst
  const sleutels = blobs.map(b => b.key).sort().reverse().slice(0, max);
  const lijst = await Promise.all(sleutels.map(k => st.get(k, { type: "json" }).catch(() => null)));
  return lijst.filter(Boolean);
}

export default async (req) => {
  if (req.method !== "GET") return json(405, { fout: "Niet toegestaan." });
  return json(200, { berichten: await leesNieuws() }, { "Cache-Control": "public, max-age=30" });
};

export const config = { path: "/api/nieuws" };
