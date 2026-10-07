/*
  Voorspellingen.
  - Een ronde loopt van dinsdag 00:00 tot de volgende dinsdag 00:00 (Nederlandse tijd).
    Op dinsdag begint dus automatisch een nieuwe ronde met een leeg leaderboard.
  - Er wordt voorspeld op de wedstrijd van Wijnandia 1 (instelbaar: VOORSPEL_TEAM) in die ronde.
  - Voorspellen kan tot de aftrap. Daarna worden alle voorspellingen zichtbaar.
  - Eén voorspelling per naam én per telefoon; aanpassen kan niet (gecontroleerd op de server).
  - Punten: exacte uitslag 3 punten, juiste winnaar/gelijkspel 1 punt.

  GET  /api/voorspel?apparaat=<id>                      -> ronde, wedstrijd, leaderboard
  POST /api/voorspel  { naam, apparaat, thuis, uit }    -> voorspelling opslaan
*/
import crypto from "node:crypto";
import { winkel, instelling, hvJson, clubEnTeams, isOns, isGespeeld, isAfgelast, wandklokVanApi, json } from "../lib/gedeeld.mjs";
import { ronde, punten } from "../lib/ronde.mjs";

/* De wedstrijd van het gekozen team in deze ronde */
async function zoekWedstrijd(r) {
  const clubPad = instelling.clubPad();
  const code = instelling.voorspelTeam();
  const ct = await clubEnTeams();
  const club = ct?.club;
  if (!club) return { fout: "geen-gegevens" };
  const team = club.teams?.find(t => t.code === code) || { code, label: club.name + " " + code };
  const data = await hvJson(clubPad + code + "/");
  const c = data?.competition;
  if (!c) return { fout: "geen-gegevens" };
  const alle = [...(c.program || []), ...(c.results || [])]
    .filter(w => isOns(w.home, club.name, team) || isOns(w.away, club.name, team))
    .map(w => ({ ...w, wand: wandklokVanApi(w.date) }))
    .filter(w => Number.isFinite(w.wand) && w.wand >= r.start && w.wand < r.eind && !isAfgelast(w.status))
    .sort((a, b) => a.wand - b.wand);
  // dezelfde wedstrijd kan in program én results staan; neem de gespeelde versie als die er is
  const w = alle.find(x => isGespeeld(x)) || alle[0];
  if (!w) return { team, wedstrijd: null };
  return {
    team,
    wedstrijd: {
      thuis: w.home, uit: w.away, datum: w.date, aftrap: w.wand,
      tijdBekend: new Date(w.wand).getUTCHours() + new Date(w.wand).getUTCMinutes() > 0,
      uitslag: isGespeeld(w) ? { thuis: +w.homeGoals, uit: +w.awayGoals } : null
    }
  };
}

const naamSleutel = naam => naam.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const apparaatSleutel = id => crypto.createHash("sha256").update(String(id)).digest("hex").slice(0, 32);

async function leesVoorspellingen(st, rondeId) {
  const { blobs } = await st.list({ prefix: rondeId + "/naam/" });
  const lijst = await Promise.all(blobs.map(b => st.get(b.key, { type: "json" }).catch(() => null)));
  return lijst.filter(Boolean);
}

export default async (req) => {
  const r = ronde();
  const st = winkel("voorspellingen");
  const url = new URL(req.url);

  const info = await zoekWedstrijd(r);
  const w = info.wedstrijd;
  const gesloten = !w || r.nu >= w.aftrap;

  if (req.method === "GET") {
    const apparaat = url.searchParams.get("apparaat");
    const lijst = await leesVoorspellingen(st, r.id);
    let mijn = null;
    if (apparaat) {
      const m = await st.get(r.id + "/apparaat/" + apparaatSleutel(apparaat), { type: "json" }).catch(() => null);
      if (m) mijn = lijst.find(v => naamSleutel(v.naam) === m.naamSleutel) || null;
    }
    const leaderboard = lijst
      .map(v => ({ naam: v.naam, t: v.t, ...(gesloten ? { thuis: v.thuis, uit: v.uit, punten: punten(v, w?.uitslag) } : {}) }))
      .sort((a, b) => (b.punten ?? -1) - (a.punten ?? -1) || a.t - b.t);
    return json(200, {
      ronde: { id: r.id, start: r.start, eind: r.eind, nu: r.nu },
      fout: info.fout || null,
      team: info.team?.label || null,
      wedstrijd: w, gesloten,
      aantal: lijst.length,
      leaderboard,
      mijn: mijn && { naam: mijn.naam, thuis: mijn.thuis, uit: mijn.uit, punten: gesloten ? punten(mijn, w?.uitslag) : null }
    });
  }

  if (req.method !== "POST") return json(405, { fout: "Niet toegestaan." });
  if (!w) return json(409, { fout: "Er is deze week geen wedstrijd om te voorspellen." });
  if (gesloten) return json(409, { fout: "De wedstrijd is al begonnen; voorspellen kan niet meer." });

  let d;
  try { d = await req.json(); } catch { return json(400, { fout: "Ongeldige gegevens." }); }
  const naam = String(d?.naam || "").replace(/\s+/g, " ").trim();
  const thuis = Number(d?.thuis), uit = Number(d?.uit);
  const apparaat = String(d?.apparaat || "");
  if (naam.length < 2 || naam.length > 30 || !naamSleutel(naam)) return json(400, { fout: "Vul een naam in van 2 tot 30 tekens." });
  if (![thuis, uit].every(n => Number.isInteger(n) && n >= 0 && n <= 20)) return json(400, { fout: "Vul een geldige uitslag in (0 t/m 20)." });
  if (apparaat.length < 10) return json(400, { fout: "Onbekende telefoon; herlaad de app." });

  const aKey = r.id + "/apparaat/" + apparaatSleutel(apparaat);
  const nKey = r.id + "/naam/" + naamSleutel(naam);
  if (await st.get(aKey, { type: "json" }).catch(() => null)) return json(409, { fout: "Je hebt deze week al een voorspelling gedaan." });

  const v = { naam, thuis, uit, t: Date.now() };
  const res = await st.setJSON(nKey, v, { onlyIfNew: true });
  if (res && res.modified === false) return json(409, { fout: `Er is deze week al voorspeld onder de naam "${naam}". Kies een andere naam.` });
  await st.setJSON(aKey, { naamSleutel: naamSleutel(naam), t: v.t });

  return json(200, { ok: true, mijn: { naam, thuis, uit } });
};

export const config = { path: "/api/voorspel" };
