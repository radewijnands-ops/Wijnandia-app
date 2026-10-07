/*
  Beheer door het bestuur. Alle verzoeken met header  X-Beheer: <wachtwoord>
  Het wachtwoord staat in Netlify als BEHEER_WACHTWOORD.

  POST   /api/beheer/inloggen                         -> { ok }
  POST   /api/beheer/nieuws   { titel, tekst, link?, push?, foto?, poll? } -> bericht plaatsen (+ pushmelding)
  DELETE /api/beheer/nieuws?id=<id>                   -> bericht verwijderen
  GET    /api/beheer/spelers                          -> { spelers: [...] }
  PUT    /api/beheer/spelers  { spelers: [...] }      -> selectie voor Man of the Match opslaan
  POST   /api/beheer/poll-sluiten?id=<id>            -> poll bij een bericht nu sluiten
  GET/POST/DELETE /api/beheer/activiteiten            -> activiteiten beheren (POST met id = wijzigen)
*/
import crypto from "node:crypto";
import { winkel, json, isBeheerder, instelling, hvOphalen } from "../lib/gedeeld.mjs";
import { stuurAanIedereen } from "../lib/webpush.mjs";
import { leesActiviteiten, bewaarActiviteiten, controleer } from "../lib/activiteiten.mjs";
import { wisPoll } from "../lib/polls.mjs";

const kort = (s, n) => String(s || "").trim().slice(0, n);

export default async (req) => {
  if (!instelling.wachtwoord()) return json(503, { fout: "Beheer staat uit: stel BEHEER_WACHTWOORD in bij Netlify." });
  if (!(await isBeheerder(req))) return json(401, { fout: "Onjuist wachtwoord." });

  const url = new URL(req.url);
  const actie = url.pathname.replace(/^\/api\/beheer\/?/, "");
  const lees = async () => { try { return await req.json(); } catch { return null; } };

  if (actie === "inloggen" && req.method === "POST") return json(200, { ok: true });

  /* Koppeling met HollandseVelden testen (slaat de cache over; toont nooit de sleutel zelf) */
  if (actie === "test" && req.method === "POST") {
    const ruw = instelling.sleutelRuw(), schoon = instelling.sleutel();
    const sleutel = {
      ingesteld: !!schoon,
      lengte: schoon.length,
      begin: schoon ? schoon.slice(0, 4) + "…" : "",
      opgeschoond: ruw !== schoon   // er stonden spaties of aanhalingstekens omheen
    };
    const clubPad = instelling.clubPad();
    const paden = [clubPad, clubPad + instelling.voorspelTeam() + "/"];
    const resultaten = [];
    for (const pad of paden) {
      const r = await hvOphalen(pad, { forceer: true });
      let samenvatting = "";
      if (r.status === 200) {
        try {
          const d = JSON.parse(r.body);
          samenvatting = d.club?.teams ? `${d.club.teams.length} teams gevonden` :
            d.competition ? `${d.club?.team?.label || "team"}: ${d.competition.meta?.title || "competitie"} (${(d.competition.program || []).length} wedstrijden op het programma)` : "antwoord ontvangen";
        } catch { samenvatting = "antwoord ontvangen"; }
      } else samenvatting = String(r.body || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
      resultaten.push({ pad, status: r.status, ok: r.status === 200, samenvatting });
    }
    return json(200, { sleutel, clubPad, resultaten });
  }

  if (actie === "nieuws") {
    const st = winkel("nieuws");
    if (req.method === "POST") {
      const d = await lees();
      const titel = kort(d?.titel, 80), tekst = kort(d?.tekst, 2000);
      let link = kort(d?.link, 300);
      if (link && !/^https?:\/\//i.test(link)) link = "https://" + link;
      if (titel.length < 3) return json(400, { fout: "Vul een titel in (minimaal 3 tekens)." });
      const t = Date.now();
      const id = String(t).padStart(15, "0") + "-" + crypto.randomBytes(3).toString("hex");
      const bericht = { id, titel, tekst, link: link || null, t };
      // optionele poll: vraag + 2 tot 6 antwoorden, optioneel sluitmoment (ms)
      if (d?.poll) {
        const vraag = kort(d.poll.vraag, 140);
        const opties = Array.from(new Set((Array.isArray(d.poll.opties) ? d.poll.opties : [])
          .map(o => kort(o, 60).replace(/\s+/g, " ")).filter(Boolean)));
        if (vraag.length < 3) return json(400, { fout: "Vul een pollvraag in (minimaal 3 tekens)." });
        if (opties.length < 2) return json(400, { fout: "Een poll heeft minimaal 2 verschillende antwoorden nodig." });
        if (opties.length > 6) return json(400, { fout: "Een poll kan maximaal 6 antwoorden hebben." });
        let sluit = null;
        if (d.poll.sluit) {
          sluit = Number(d.poll.sluit);
          if (!Number.isFinite(sluit)) return json(400, { fout: "Het sluitmoment van de poll klopt niet." });
          if (sluit <= t) return json(400, { fout: "Het sluitmoment van de poll ligt in het verleden." });
        }
        bericht.poll = { vraag, opties, sluit };
      }
      // optionele foto (in de beheerpagina al verkleind tot JPEG)
      if (d?.foto) {
        const m = String(d.foto).match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
        if (!m) return json(400, { fout: "De foto kon niet gelezen worden. Probeer een JPG- of PNG-bestand." });
        const data = Buffer.from(m[2], "base64");
        if (data.length > 4 * 1024 * 1024) return json(400, { fout: "De foto is te groot (max. 4 MB)." });
        await winkel("fotos").set(id, data, { metadata: { type: m[1] } });
        bericht.foto = `/api/foto/${id}`;
      }
      await st.setJSON(id, bericht);
      let push = null;
      if (d?.push) {
        push = await stuurAanIedereen({
          titel: "📣 " + titel,
          tekst: bericht.poll ? ("📊 Stem mee: " + bericht.poll.vraag).slice(0, 140)
            : (tekst.replace(/\s+/g, " ").slice(0, 140) || "Lees het in de Wijnandia-app."),
          url: "./#nieuws", tag: "nieuws-" + id, afbeelding: bericht.foto || undefined
        }, "nieuws");
      }
      return json(200, { ok: true, bericht, push });
    }
    if (req.method === "DELETE") {
      const id = url.searchParams.get("id") || "";
      if (!/^[0-9]{15}-[0-9a-f]{6}$/.test(id)) return json(400, { fout: "Onbekend bericht." });
      await st.delete(id);
      await winkel("fotos").delete(id).catch(() => {});
      await wisPoll(id).catch(() => {});
      return json(200, { ok: true });
    }
  }

  /* Poll nu sluiten (daarna ziet iedereen de uitslag) */
  if (actie === "poll-sluiten" && req.method === "POST") {
    const id = url.searchParams.get("id") || "";
    if (!/^[0-9]{15}-[0-9a-f]{6}$/.test(id)) return json(400, { fout: "Onbekend bericht." });
    const st = winkel("nieuws");
    const b = await st.get(id, { type: "json" }).catch(() => null);
    if (!b?.poll) return json(404, { fout: "Dit bericht heeft geen poll." });
    b.poll.sluit = Date.now();
    await st.setJSON(id, b);
    return json(200, { ok: true, bericht: b });
  }

  /* Activiteiten: lijst, toevoegen/wijzigen (met id), verwijderen */
  if (actie === "activiteiten") {
    if (req.method === "GET") return json(200, { activiteiten: await leesActiviteiten(req) });
    if (req.method === "POST") {
      const d = await lees();
      const c = controleer(d);
      if (c.fout) return json(400, { fout: c.fout });
      const lijst = await leesActiviteiten(req);
      const id = String(d?.id || "");
      let nieuw = true;
      if (id) {
        const i = lijst.findIndex(x => x.id === id);
        if (i < 0) return json(404, { fout: "Deze activiteit bestaat niet meer. Herlaad de pagina." });
        lijst[i] = { ...c.activiteit, id }; nieuw = false;
      } else {
        lijst.push({ ...c.activiteit, id: "a" + Date.now().toString(36) + crypto.randomBytes(2).toString("hex") });
      }
      await bewaarActiviteiten(lijst);
      let push = null;
      if (d?.push) {
        const a = c.activiteit;
        const dt = new Date(a.datum + "T12:00");
        const dag = dt.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Amsterdam" });
        push = await stuurAanIedereen({
          titel: (nieuw ? "📅 Nieuwe activiteit: " : "📅 Gewijzigd: ") + a.titel,
          tekst: `${dag}${a.start ? " om " + a.start : ""}${a.locatie ? " · " + a.locatie : ""}. Zet hem met één tik in je agenda.`,
          url: "./#activiteiten", tag: "activiteit-" + (id || a.titel)
        }, "nieuws");
      }
      return json(200, { ok: true, activiteiten: await leesActiviteiten(req), push });
    }
    if (req.method === "DELETE") {
      const id = url.searchParams.get("id") || "";
      const lijst = await leesActiviteiten(req);
      const rest = lijst.filter(x => x.id !== id);
      if (rest.length === lijst.length) return json(404, { fout: "Onbekende activiteit." });
      await bewaarActiviteiten(rest);
      return json(200, { ok: true, activiteiten: rest });
    }
  }

  if (actie === "spelers") {
    const st = winkel("motm");
    if (req.method === "GET") return json(200, { spelers: (await st.get("spelers", { type: "json" }).catch(() => null)) || [] });
    if (req.method === "PUT") {
      const d = await lees();
      const spelers = Array.from(new Set((Array.isArray(d?.spelers) ? d.spelers : [])
        .map(s => kort(s, 40).replace(/\s+/g, " ")).filter(s => s.length >= 2))).slice(0, 40);
      await st.setJSON("spelers", spelers);
      return json(200, { ok: true, spelers });
    }
  }

  return json(404, { fout: "Onbekende actie." });
};

export const config = { path: "/api/beheer/*" };
