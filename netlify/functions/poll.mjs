/*
  Polls bij clubnieuws.
  - Het bestuur zet een poll (vraag + 2 tot 6 antwoorden, optioneel een sluitmoment) bij een nieuwsbericht.
  - Eén stem per telefoon per poll; niet te wijzigen.
  - De uitslag zie je nadat je gestemd hebt, of als de poll gesloten is.
  - Met het beheerwachtwoord (header X-Beheer) is de uitslag altijd zichtbaar.

  GET  /api/poll?id=<berichtId>&apparaat=<id>   -> { open, sluit, aantal, mijnStem, telling, totaal }
  POST /api/poll  { id, apparaat, optie }        -> stem opslaan, geeft de uitslag terug
*/
import { winkel, json, apparaatSleutel, isBeheerder } from "../lib/gedeeld.mjs";
import { telPoll } from "../lib/polls.mjs";

const ID = /^[0-9]{15}-[0-9a-f]{6}$/;

async function zoekPoll(id) {
  if (!ID.test(id)) return null;
  const b = await winkel("nieuws").get(id, { type: "json" }).catch(() => null);
  return b?.poll ? b.poll : null;
}

export default async (req) => {
  const url = new URL(req.url);
  const nu = Date.now();

  if (req.method === "GET") {
    const id = url.searchParams.get("id") || "";
    const poll = await zoekPoll(id);
    if (!poll) return json(404, { fout: "Deze poll bestaat niet (meer)." });
    const open = !poll.sluit || nu < poll.sluit;
    const apparaat = url.searchParams.get("apparaat");
    const mijn = apparaat ? await winkel("polls").get(`stem/${id}/${apparaatSleutel(apparaat)}`, { type: "json" }).catch(() => null) : null;
    const t = await telPoll(id, poll.opties.length);
    const zien = !!mijn || !open || (await isBeheerder(req));
    return json(200, {
      open, sluit: poll.sluit || null, nu,
      mijnStem: Number.isInteger(mijn?.optie) ? mijn.optie : null,
      totaal: t.totaal,
      telling: zien ? t.telling : null
    });
  }

  if (req.method !== "POST") return json(405, { fout: "Niet toegestaan." });
  let d; try { d = await req.json(); } catch { return json(400, { fout: "Ongeldige gegevens." }); }
  const id = String(d?.id || "");
  const poll = await zoekPoll(id);
  if (!poll) return json(404, { fout: "Deze poll bestaat niet (meer)." });
  if (poll.sluit && nu >= poll.sluit) return json(409, { fout: "Deze poll is gesloten." });
  const optie = Number(d?.optie);
  if (!Number.isInteger(optie) || optie < 0 || optie >= poll.opties.length) return json(400, { fout: "Kies een van de antwoorden." });
  const apparaat = String(d?.apparaat || "");
  if (apparaat.length < 10) return json(400, { fout: "Onbekende telefoon; herlaad de app." });

  const res = await winkel("polls").setJSON(`stem/${id}/${apparaatSleutel(apparaat)}`, { optie, t: nu }, { onlyIfNew: true });
  if (res && res.modified === false) return json(409, { fout: "Je hebt al gestemd op deze poll." });
  const t = await telPoll(id, poll.opties.length);
  return json(200, { ok: true, open: true, sluit: poll.sluit || null, nu, mijnStem: optie, ...t });
};

export const config = { path: "/api/poll" };
