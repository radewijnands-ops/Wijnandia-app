/* Gedeelde hulpfuncties voor de Wijnandia-functies op Netlify. */
import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";

export const HV_API = "https://api.hollandsevelden.nl";

/* Instellingen (via Netlify > Environment variables, met standaardwaarden) */
export const instelling = {
  // spaties, enters en aanhalingstekens rond de sleutel (bij plakken) worden genegeerd
  sleutel:      () => (Netlify.env.get("HV_API_KEY") || "").trim().replace(/^["'\u201c\u201d]+|["'\u201c\u201d]+$/g, "").trim(),
  sleutelRuw:   () => Netlify.env.get("HV_API_KEY") || "",
  clubPad:      () => Netlify.env.get("HV_CLUB_PAD") || "/clubs/w/wijnandia/",
  toegestaan:   () => (Netlify.env.get("HV_TOEGESTAAN") || Netlify.env.get("HV_CLUB_PAD") || "/clubs/w/wijnandia/")
                        .split(",").map(p => p.trim()).filter(Boolean),
  voorspelTeam: () => Netlify.env.get("VOORSPEL_TEAM") || "1",
  contact:      () => Netlify.env.get("PUSH_CONTACT") || "mailto:info@wijnandia.nl",
  wachtwoord:   () => Netlify.env.get("BEHEER_WACHTWOORD") || "",
  quizStart:    () => Netlify.env.get("QUIZ_START") || "2026-10-04T06:00"
};

/* Apparaat-id (willekeurige code per telefoon) -> korte, niet terug te rekenen sleutel */
export const apparaatSleutel = id => crypto.createHash("sha256").update("app:" + String(id)).digest("hex").slice(0, 32);
export const naamSleutel = naam => String(naam).trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
export const schoneNaam = naam => String(naam || "").replace(/\s+/g, " ").trim();
export const geldigeNaam = naam => naam.length >= 2 && naam.length <= 30 && !!naamSleutel(naam);

/* Beheer: wachtwoord controleren (header X-Beheer) */
export async function isBeheerder(req) {
  const ww = instelling.wachtwoord();
  const gegeven = req.headers.get("x-beheer") || "";
  if (!ww || !gegeven) return false;
  const a = crypto.createHash("sha256").update(ww).digest(), b = crypto.createHash("sha256").update(gegeven).digest();
  const ok = crypto.timingSafeEqual(a, b);
  if (!ok) await new Promise(r => setTimeout(r, 800)); // raden vertragen
  return ok;
}

export const winkel = naam => getStore({ name: naam, consistency: "strong" });

export function json(status, body, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra }
  });
}

/* ---------- Nederlandse tijd ---------- */
/* "Wandklok"-tijd in Amsterdam als UTC-getal: handig rekenen zonder zomer/wintertijd-gedoe */
export function wandklok(datum = new Date()) {
  const d = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).formatToParts(datum).map(p => [p.type, p.value]));
  return Date.UTC(+d.year, +d.month - 1, +d.day, +d.hour, +d.minute, +d.second);
}
/* Datum uit de API -> wandklok. "2026-03-15T14:30:00+01:00" of "2026-03-15 14:30:00" */
export function wandklokVanApi(s) {
  const t = String(s || "");
  if (/[zZ]|[+-]\d\d:?\d\d$/.test(t)) return wandklok(new Date(t));
  const m = t.match(/^(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d)(?::(\d\d))?/);
  return m ? Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) : NaN;
}

/* Bewaartijd volgens HollandseVelden-handleiding H8 (seconden) */
export function bewaartijd(nu = new Date()) {
  const w = new Date(wandklok(nu));
  const minuten = w.getUTCHours() * 60 + w.getUTCMinutes();
  const weekend = w.getUTCDay() === 0 || w.getUTCDay() === 6;
  const totMiddernacht = (24 * 60 - minuten) * 60;
  if (!weekend) return Math.max(60, Math.min(4 * 3600, totMiddernacht));
  if (minuten < 15 * 60) return Math.max(60, Math.min(3600, (15 * 60 - minuten) * 60));
  return 15 * 60;
}

/* ---------- HollandseVelden ophalen, met gedeelde cache ---------- */
/* Iedere functie (app, meldingen, voorspelling) gebruikt dezelfde cache, zodat de
   API per pad nooit vaker wordt aangeroepen dan het schema toestaat. */
export async function hvOphalen(pad, { forceer = false } = {}) {
  const cache = winkel("hv-cache");
  const sleutelNaam = "pad" + pad.replace(/\//g, "_");
  const oud = await cache.get(sleutelNaam, { type: "json" }).catch(() => null);
  if (!forceer && oud && Date.now() - oud.t < oud.ttl * 1000) return { status: 200, body: oud.body, uitCache: true };

  const sleutel = instelling.sleutel();
  if (!sleutel) return { status: 503, body: JSON.stringify({ fout: "API-sleutel is nog niet ingesteld (HV_API_KEY)." }) };

  // Mislukte pogingen even onthouden, zodat een fout niet tot een stortvloed aan verzoeken leidt
  // (per sleutel: een nieuwe of verbeterde sleutel begint met een schone lei)
  const sleutelId = crypto.createHash("sha256").update(sleutel).digest("hex").slice(0, 8);
  const foutSleutel = "fout_" + sleutelId + pad.replace(/\//g, "_");
  const recenteFout = await cache.get(foutSleutel, { type: "json" }).catch(() => null);
  // Geen toegang: 1 uur niet opnieuw proberen; onbekend pad: 6 uur; andere fouten: 5 minuten
  const wachttijd = [401, 403].includes(recenteFout?.status) ? 3600 * 1000 : recenteFout?.status === 404 ? 6 * 3600 * 1000 : 5 * 60 * 1000;
  if (!forceer && recenteFout && Date.now() - recenteFout.t < wachttijd) {
    if (oud) return { status: 200, body: oud.body, uitCache: true, verouderd: true };
    return { status: recenteFout.status, body: recenteFout.body };
  }

  let r;
  try {
    r = await fetch(HV_API + pad, { headers: { "X-Api-Key": sleutel, "Accept": "application/json" } });
  } catch (e) {
    r = { status: 502, text: async () => JSON.stringify({ fout: "HollandseVelden is niet bereikbaar." }) };
  }
  const body = await r.text();
  if (r.status === 200) {
    await cache.setJSON(sleutelNaam, { t: Date.now(), ttl: bewaartijd(), body });
    await cache.delete(foutSleutel).catch(() => {});
    return { status: 200, body };
  }
  await cache.setJSON(foutSleutel, { t: Date.now(), status: r.status, body });
  if (oud) return { status: 200, body: oud.body, uitCache: true, verouderd: true };
  return { status: r.status, body };
}

export async function hvJson(pad) {
  const r = await hvOphalen(pad);
  if (r.status !== 200) return null;
  try { return JSON.parse(r.body); } catch { return null; }
}

/* ---------- Wijnandia herkennen in een wedstrijd ---------- */
export function isOns(naam, clubNaam, team) {
  if (!naam) return false;
  const n = naam.trim().toLowerCase();
  if (team?.label && n === team.label.toLowerCase()) return true;
  if (team?.code === "1" && clubNaam && n === String(clubNaam).toLowerCase()) return true;
  return false;
}

export function isAfgelast(status) {
  return /afgelast|uitgesteld|vervallen|stopgezet|forfait|ongeldig/i.test(status || "");
}
export function isGespeeld(w) {
  return !isAfgelast(w.status) && w.result !== "" && Number.isFinite(+w.homeGoals) && Number.isFinite(+w.awayGoals)
    && /uitgespeeld|gespeeld/i.test(w.status || "Uitgespeeld");
}

/* ---------- Club en teams ophalen ----------
   Normaal via het cluboverzicht (/clubs/w/wijnandia/). Geeft de API-sleutel alleen
   toegang tot één team (bv. /clubs/w/wijnandia/1/), dan valt dit terug op dat team. */
export async function clubEnTeams() {
  const clubPad = instelling.clubPad();
  const overzicht = await hvJson(clubPad);
  if (overzicht?.club?.teams?.length) return { club: overzicht.club, teams: overzicht.club.teams };
  const code = instelling.voorspelTeam();
  const los = await hvJson(clubPad + code + "/");
  if (los?.club) {
    const team = los.club.team || { code, label: `${los.club.name} ${code}` };
    return { club: { ...los.club, teams: [team] }, teams: [team], alleenEenTeam: true };
  }
  return null;
}
