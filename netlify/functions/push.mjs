/*
  Aan- en afmelden voor pushmeldingen.
  GET  /api/push/sleutel    -> publieke VAPID-sleutel voor de app
  POST /api/push/aanmelden  -> { subscription, soorten: ["uitslagen","nieuws"] }  (ook om voorkeuren te wijzigen)
  POST /api/push/afmelden   -> { endpoint }
*/
import { winkel, json } from "../lib/gedeeld.mjs";
import { vapidSleutels, hashSleutel } from "../lib/webpush.mjs";

const geldigEndpoint = e => {
  try { const u = new URL(e); return u.protocol === "https:"; } catch { return false; }
};

export default async (req) => {
  const actie = new URL(req.url).pathname.replace(/^\/api\/push\/?/, "");

  if (req.method === "GET" && actie === "sleutel") {
    const k = await vapidSleutels();
    return json(200, { publicKey: k.publicKey });
  }
  if (req.method !== "POST") return json(405, { fout: "Niet toegestaan." });

  let data;
  try { data = await req.json(); } catch { return json(400, { fout: "Ongeldige gegevens." }); }
  const st = winkel("push-abonnementen");

  if (actie === "aanmelden") {
    const sub = data?.subscription;
    if (!sub || !geldigEndpoint(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) return json(400, { fout: "Ongeldig abonnement." });
    const soorten = (Array.isArray(data.soorten) ? data.soorten : ["uitslagen", "nieuws"]).filter(x => ["uitslagen", "nieuws"].includes(x));
    await st.setJSON(hashSleutel(sub.endpoint), { sub: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }, soorten, t: Date.now() });
    return json(200, { ok: true });
  }
  if (actie === "afmelden") {
    if (!geldigEndpoint(data?.endpoint)) return json(400, { fout: "Ongeldig adres." });
    await st.delete(hashSleutel(data.endpoint));
    return json(200, { ok: true });
  }
  return json(404, { fout: "Onbekende actie." });
};

export const config = { path: "/api/push/*" };
