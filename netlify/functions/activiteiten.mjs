/* Activiteiten openbaar lezen. GET /api/activiteiten -> { activiteiten: [...] } */
import { json } from "../lib/gedeeld.mjs";
import { leesActiviteiten } from "../lib/activiteiten.mjs";

export default async (req) => {
  if (req.method !== "GET") return json(405, { fout: "Niet toegestaan." });
  return json(200, { activiteiten: await leesActiviteiten(req) }, { "Cache-Control": "public, max-age=60" });
};

export const config = { path: "/api/activiteiten" };
