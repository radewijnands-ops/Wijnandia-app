/*
  Beheer door het bestuur. Alle verzoeken met header  X-Beheer: <wachtwoord>
  Het wachtwoord staat in Netlify als BEHEER_WACHTWOORD.

  POST   /api/beheer/inloggen                         -> { ok }
  POST   /api/beheer/nieuws   { titel, tekst, link?, push? } -> bericht plaatsen (+ pushmelding)
  DELETE /api/beheer/nieuws?id=<id>                   -> bericht verwijderen
  GET    /api/beheer/spelers                          -> { spelers: [...] }
  PUT    /api/beheer/spelers  { spelers: [...] }      -> selectie voor Man of the Match opslaan
*/
import crypto from "node:crypto";
import { winkel, json, isBeheerder, instelling, hvOphalen } from "../lib/gedeeld.mjs";
import { stuurAanIedereen } from "../lib/webpush.mjs";

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
      await st.setJSON(id, bericht);
      let push = null;
      if (d?.push) {
        push = await stuurAanIedereen({
          titel: "📣 " + titel,
          tekst: tekst.replace(/\s+/g, " ").slice(0, 140) || "Lees het in de Wijnandia-app.",
          url: "./#nieuws", tag: "nieuws-" + id
        }, "nieuws");
      }
      return json(200, { ok: true, bericht, push });
    }
    if (req.method === "DELETE") {
      const id = url.searchParams.get("id") || "";
      if (!/^[0-9]{15}-[0-9a-f]{6}$/.test(id)) return json(400, { fout: "Onbekend bericht." });
      await st.delete(id);
      return json(200, { ok: true });
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
