/*
  Weekquiz-klassement.
  - Je speelt onder een vaste naam per telefoon (eenmalig gekozen; een naam kan maar door één telefoon gebruikt worden).
  - Per week één antwoord, alleen op de vraag van die week; niet aan te passen.
  - 1 punt per goed antwoord. Het klassement telt alle weken bij elkaar op.
  - De server controleert zelf of het antwoord goed is (met quiz/vragen.json).

  GET  /api/quiz?apparaat=<id>                    -> klassement, mijn naam, mijn antwoord van deze week
  POST /api/quiz  { apparaat, naam, week, letter } -> antwoord insturen
*/
import { winkel, instelling, apparaatSleutel, naamSleutel, schoneNaam, geldigeNaam, json } from "../lib/gedeeld.mjs";
import { quizWeek } from "../lib/ronde.mjs";

let vragenCache = null;
async function vragen(req) {
  if (vragenCache) return vragenCache;
  const r = await fetch(new URL("/quiz/vragen.json", req.url));
  if (!r.ok) throw new Error("vragen niet gevonden");
  vragenCache = (await r.json()).vragen;
  return vragenCache;
}

async function klassement(st) {
  const { blobs } = await st.list({ prefix: "score/" });
  const lijst = (await Promise.all(blobs.map(b => st.get(b.key, { type: "json" }).catch(() => null)))).filter(Boolean);
  return lijst.map(s => ({ naam: s.naam, punten: s.punten, gespeeld: s.gespeeld, _k: s.k }))
    .sort((a, b) => b.punten - a.punten || a.gespeeld - b.gespeeld || a.naam.localeCompare(b.naam));
}

export default async (req) => {
  const st = winkel("quiz");
  const n = quizWeek(instelling.quizStart());

  if (req.method === "GET") {
    const apparaat = new URL(req.url).searchParams.get("apparaat");
    const a = apparaat ? apparaatSleutel(apparaat) : null;
    const ik = a ? await st.get(`apparaat/${a}`, { type: "json" }).catch(() => null) : null;
    const mijnAntwoord = a ? await st.get(`antwoord/${n}/${a}`, { type: "json" }).catch(() => null) : null;
    const lijst = await klassement(st);
    const pos = a ? lijst.findIndex(x => x._k === a) : -1;
    const { blobs } = await st.list({ prefix: `antwoord/${n}/` });
    return json(200, {
      week: n, naam: ik?.naam || null,
      mijnAntwoord: mijnAntwoord ? { letter: mijnAntwoord.letter, goed: mijnAntwoord.goed } : null,
      dezeWeek: blobs.length,
      klassement: lijst.slice(0, 50).map(({ _k, ...x }) => ({ ...x, ik: _k === a })),
      mijnPositie: pos >= 0 ? { positie: pos + 1, ...(({ _k, ...x }) => x)(lijst[pos]) } : null
    });
  }

  if (req.method !== "POST") return json(405, { fout: "Niet toegestaan." });
  let d; try { d = await req.json(); } catch { return json(400, { fout: "Ongeldige gegevens." }); }
  const apparaat = String(d?.apparaat || "");
  if (apparaat.length < 10) return json(400, { fout: "Onbekende telefoon; herlaad de app." });
  if (Number(d?.week) !== n) return json(409, { fout: "Deze vraag is niet meer actief. Herlaad de app voor de nieuwe vraag." });
  const lijst = await vragen(req);
  const vraag = lijst[((n % lijst.length) + lijst.length) % lijst.length];
  const letter = String(d?.letter || "");
  if (!vraag.antwoorden.some(x => x.letter === letter)) return json(400, { fout: "Ongeldig antwoord." });

  const a = apparaatSleutel(apparaat);
  let ik = await st.get(`apparaat/${a}`, { type: "json" }).catch(() => null);
  if (!ik) {
    const naam = schoneNaam(d?.naam);
    if (!geldigeNaam(naam)) return json(400, { fout: "Vul een naam in van 2 tot 30 tekens." });
    const claim = await st.setJSON(`naam/${naamSleutel(naam)}`, { a }, { onlyIfNew: true });
    if (claim && claim.modified === false) {
      const eigenaar = await st.get(`naam/${naamSleutel(naam)}`, { type: "json" }).catch(() => null);
      if (eigenaar?.a !== a) return json(409, { fout: `De naam "${naam}" is al in gebruik. Kies een andere naam.`, veld: "naam" });
    }
    ik = { naam };
    await st.setJSON(`apparaat/${a}`, ik);
  }

  const goed = letter === vraag.juist;
  const res = await st.setJSON(`antwoord/${n}/${a}`, { letter, goed, t: Date.now() }, { onlyIfNew: true });
  if (res && res.modified === false) {
    const oud = await st.get(`antwoord/${n}/${a}`, { type: "json" });
    return json(409, { fout: "Je hebt deze week al geantwoord.", mijnAntwoord: { letter: oud.letter, goed: oud.goed }, naam: ik.naam });
  }
  const score = (await st.get(`score/${a}`, { type: "json" }).catch(() => null)) || { k: a, naam: ik.naam, punten: 0, gespeeld: 0 };
  score.naam = ik.naam; score.punten += goed ? 1 : 0; score.gespeeld += 1; score.laatste = n;
  await st.setJSON(`score/${a}`, score);
  return json(200, { ok: true, goed, juist: vraag.juist, naam: ik.naam });
};

export const config = { path: "/api/quiz" };
