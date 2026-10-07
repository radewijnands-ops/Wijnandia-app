/* Gedeeld voor polls bij clubnieuws: stemmen tellen en wissen (Blob-store "polls") */
import { winkel } from "./gedeeld.mjs";

export async function telPoll(id, aantalOpties) {
  const st = winkel("polls");
  const { blobs } = await st.list({ prefix: `stem/${id}/` });
  const stemmen = await Promise.all(blobs.map(b => st.get(b.key, { type: "json" }).catch(() => null)));
  const telling = Array(aantalOpties).fill(0);
  for (const s of stemmen) if (Number.isInteger(s?.optie) && s.optie >= 0 && s.optie < aantalOpties) telling[s.optie]++;
  return { telling, totaal: telling.reduce((a, b) => a + b, 0) };
}

export async function wisPoll(id) {
  const st = winkel("polls");
  const { blobs } = await st.list({ prefix: `stem/${id}/` });
  await Promise.all(blobs.map(b => st.delete(b.key).catch(() => {})));
}
