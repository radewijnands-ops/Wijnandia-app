/*
  Draait elk kwartier. Kijkt of er nieuwe uitslagen van Wijnandia-teams zijn
  en stuurt dan een pushmelding naar iedereen die meldingen aan heeft staan.
  Door de gedeelde cache (hvOphalen) wordt HollandseVelden niet vaker aangeroepen
  dan de API-handleiding toestaat.
*/
import { zoekNieuweUitslagen, maakBericht } from "../lib/uitslagen.mjs";
import { stuurAanIedereen } from "../lib/webpush.mjs";

export default async () => {
  const r = await zoekNieuweUitslagen();
  if (r.fout) { console.log(r.fout); return; }
  for (const { team, w } of r.nieuw) {
    const res = await stuurAanIedereen(maakBericht(r.club, team, w), "uitslagen");
    console.log("Melding", w.home, w.away, res);
  }
  if (!r.nieuw.length) console.log("Geen nieuwe uitslagen");
};

export const config = { schedule: "*/15 * * * *" };
