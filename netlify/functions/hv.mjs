/*
  Tussenstap tussen de Wijnandia-app en de HollandseVelden API.
  De API-sleutel staat als geheime instelling op Netlify (HV_API_KEY), niet in de app.
  Antwoorden worden gedeeld bewaard volgens het schema uit de API-handleiding (H8).
*/
import { hvOphalen, instelling, bewaartijd, json } from "../lib/gedeeld.mjs";

export default async (req) => {
  if (req.method !== "GET") return json(405, { fout: "Alleen GET is toegestaan." });

  const url = new URL(req.url);
  let pad = url.pathname.replace(/^\/api\/hv/, "") || "/";
  if (!pad.endsWith("/")) pad += "/";

  if (!/^\/[a-z0-9\-\/+]+\/$/i.test(pad) || pad.includes("..")) return json(400, { fout: "Ongeldig pad." });
  if (!instelling.toegestaan().some(p => pad.startsWith(p))) return json(403, { fout: "Dit pad is niet toegestaan." });

  const r = await hvOphalen(pad);
  if (r.status !== 200) {
    return new Response(r.body || JSON.stringify({ fout: "Fout " + r.status }), {
      status: r.status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
    });
  }
  const ttl = bewaartijd();
  return new Response(r.body, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": `public, max-age=${Math.min(ttl, 300)}`,
      "Netlify-CDN-Cache-Control": `public, s-maxage=${Math.min(ttl, 900)}, stale-while-revalidate=120, durable`
    }
  });
};

export const config = { path: "/api/hv/*" };
