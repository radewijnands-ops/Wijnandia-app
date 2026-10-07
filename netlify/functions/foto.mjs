/* Foto's bij nieuwsberichten tonen. GET /api/foto/<id> */
import { winkel } from "../lib/gedeeld.mjs";

export default async (req) => {
  const id = new URL(req.url).pathname.split("/").pop();
  if (!/^[0-9]{15}-[0-9a-f]{6}$/.test(id)) return new Response("Niet gevonden", { status: 404 });
  const st = winkel("fotos");
  const res = await st.getWithMetadata(id, { type: "arrayBuffer" }).catch(() => null);
  if (!res?.data) return new Response("Niet gevonden", { status: 404 });
  return new Response(res.data, {
    status: 200,
    headers: {
      "Content-Type": res.metadata?.type || "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable"
    }
  });
};

export const config = { path: "/api/foto/*" };
