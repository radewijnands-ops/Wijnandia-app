/*
  Man of the Match voor Wijnandia 1 (team instelbaar met VOORSPEL_TEAM).
  - Stemmen kan zodra de uitslag van de laatste wedstrijd bekend is, tot 3 dagen na de aftrap.
  - Eén stem per telefoon per wedstrijd; niet aan te passen.
  - De stand wordt zichtbaar nadat je gestemd hebt (of als het stemmen gesloten is).
  - De selectie (spelerslijst) vult het bestuur in via de beheerpagina.

  GET  /api/motm?apparaat=<id>
  POST /api/motm  { apparaat, speler }
*/
import crypto from "node:crypto";
import { winkel, instelling, hvJson, clubEnTeams, isOns, isGespeeld, wandklok, wandklokVanApi, apparaatSleutel, json } from "../lib/gedeeld.mjs";

const STEMDAGEN = 3;
const wedstrijdId = w => crypto.createHash("sha256").update(`${w.date}|${w.home}|${w.away}`).digest("hex").slice(0, 16);

async function laatsteWedstrijd() {
  const ct = await clubEnTeams();
  if (!ct) return { fout: "geen-gegevens" };
  const code = instelling.voorspelTeam();
  const team = ct.teams.find(t => String(t.code) === String(code)) || { code, label: `${ct.club.name} ${code}` };
  const data = await hvJson(instelling.clubPad() + code + "/");
  const res = (data?.competition?.results || [])
    .filter(w => (isOns(w.home, ct.club.name, team) || isOns(w.away, ct.club.name, team)) && isGespeeld(w))
    .map(w => ({ ...w, wand: wandklokVanApi(w.date) })).filter(w => Number.isFinite(w.wand))
    .sort((a, b) => b.wand - a.wand);
  const w = res[0];
  if (!w) return { team, wedstrijd: null };
  return { team, wedstrijd: { id: wedstrijdId(w), thuis: w.home, uit: w.away, datum: w.date, aftrap: w.wand,
    sluit: w.wand + STEMDAGEN * 864e5, uitslag: { thuis: +w.homeGoals, uit: +w.awayGoals } } };
}

async function telStemmen(st, id) {
  const { blobs } = await st.list({ prefix: `stem/${id}/` });
  const stemmen = await Promise.all(blobs.map(b => st.get(b.key, { type: "json" }).catch(() => null)));
  const telling = {};
  for (const s of stemmen) if (s?.speler) telling[s.speler] = (telling[s.speler] || 0) + 1;
  return telling;
}
const winnaars = telling => {
  const max = Math.max(0, ...Object.values(telling));
  return max ? Object.keys(telling).filter(s => telling[s] === max) : [];
};

async function klassement(st, nu) {
  const { blobs } = await st.list({ prefix: "wedstrijd/" });
  const totaal = {};
  for (const b of blobs) {
    const w = await st.get(b.key, { type: "json" }).catch(() => null);
    if (!w) continue;
    let uit = await st.get(`uitslag/${w.id}`, { type: "json" }).catch(() => null);
    if (!uit) {
      const telling = await telStemmen(st, w.id);
      uit = { telling, winnaars: winnaars(telling) };
      if (nu >= w.sluit) await st.setJSON(`uitslag/${w.id}`, uit); // gesloten: vastleggen
    }
    for (const [speler, n] of Object.entries(uit.telling)) {
      totaal[speler] ||= { speler, titels: 0, stemmen: 0 };
      totaal[speler].stemmen += n;
    }
    if (nu >= w.sluit) for (const s of uit.winnaars) { totaal[s] ||= { speler: s, titels: 0, stemmen: 0 }; totaal[s].titels++; }
  }
  return Object.values(totaal).sort((a, b) => b.titels - a.titels || b.stemmen - a.stemmen || a.speler.localeCompare(b.speler)).slice(0, 25);
}

export default async (req) => {
  const st = winkel("motm");
  const nu = wandklok();
  const info = await laatsteWedstrijd();
  const w = info.wedstrijd;
  const spelers = (await st.get("spelers", { type: "json" }).catch(() => null)) || [];
  if (w) {
    const bekend = await st.get(`wedstrijd/${w.id}`, { type: "json" }).catch(() => null);
    if (!bekend) await st.setJSON(`wedstrijd/${w.id}`, w);
  }
  const open = !!w && nu < w.sluit;

  if (req.method === "GET") {
    const apparaat = new URL(req.url).searchParams.get("apparaat");
    const mijn = (w && apparaat) ? await st.get(`stem/${w.id}/${apparaatSleutel(apparaat)}`, { type: "json" }).catch(() => null) : null;
    let telling = null, totaal = 0;
    if (w && (mijn || !open)) { telling = await telStemmen(st, w.id); totaal = Object.values(telling).reduce((a, b) => a + b, 0); }
    return json(200, {
      fout: info.fout || null, team: info.team?.label || null,
      wedstrijd: w, open, nu, spelers,
      mijnStem: mijn?.speler || null,
      telling, totaal, winnaars: (!open && telling) ? winnaars(telling) : null,
      klassement: await klassement(st, nu)
    });
  }

  if (req.method !== "POST") return json(405, { fout: "Niet toegestaan." });
  if (!w) return json(409, { fout: "Er is nog geen gespeelde wedstrijd om op te stemmen." });
  if (!open) return json(409, { fout: "Het stemmen voor deze wedstrijd is gesloten." });
  let d; try { d = await req.json(); } catch { return json(400, { fout: "Ongeldige gegevens." }); }
  const speler = String(d?.speler || "");
  const apparaat = String(d?.apparaat || "");
  if (!spelers.includes(speler)) return json(400, { fout: "Kies een speler uit de lijst." });
  if (apparaat.length < 10) return json(400, { fout: "Onbekende telefoon; herlaad de app." });
  const res = await st.setJSON(`stem/${w.id}/${apparaatSleutel(apparaat)}`, { speler, t: Date.now() }, { onlyIfNew: true });
  if (res && res.modified === false) return json(409, { fout: "Je hebt al gestemd voor deze wedstrijd." });
  return json(200, { ok: true });
};

export const config = { path: "/api/motm" };
