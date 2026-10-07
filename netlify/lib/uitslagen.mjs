/* Logica voor het vinden van nieuwe Wijnandia-uitslagen (gebruikt door uitslagen-check). */
import { winkel, instelling, hvJson, clubEnTeams, isOns, isGespeeld, wandklokVanApi, wandklok } from "./gedeeld.mjs";

const wedstrijdSleutel = w => `${w.date}|${w.home}|${w.away}`;

export async function zoekNieuweUitslagen() {
  const clubPad = instelling.clubPad();
  const ct = await clubEnTeams();
  const club = ct?.club;
  if (!club?.teams?.length) return { fout: "Geen clubgegevens (sleutel of clubadres?)" };

  const gezien = winkel("uitslagen-gezien");
  const nieuw = [];
  const nu = wandklok();

  for (const team of club.teams) {
    const data = await hvJson(clubPad + team.code + "/");
    const resultaten = data?.competition?.results;
    if (!Array.isArray(resultaten)) continue;

    const ons = resultaten.filter(w => (isOns(w.home, club.name, team) || isOns(w.away, club.name, team)) && isGespeeld(w));
    const sleutelNaam = "team_" + String(team.code).replace(/[^a-z0-9+]/gi, "_");
    const bekend = await gezien.get(sleutelNaam, { type: "json" }).catch(() => null);
    const sleutels = ons.map(wedstrijdSleutel);

    if (bekend) {
      const set = new Set(bekend);
      for (const w of ons) {
        if (set.has(wedstrijdSleutel(w))) continue;
        // alleen recente wedstrijden melden (max. 3 dagen oud), geen oude inhaalsessies
        const wanneer = wandklokVanApi(w.date);
        if (Number.isFinite(wanneer) && nu - wanneer > 3 * 864e5) continue;
        nieuw.push({ team, w });
      }
    }
    // Eerste keer: alleen onthouden, niets sturen
    await gezien.setJSON(sleutelNaam, Array.from(new Set([...(bekend || []), ...sleutels])).slice(-200));
  }
  return { club, nieuw };
}

export function maakBericht(club, team, w) {
  const thuis = isOns(w.home, club.name, team);
  const voor = thuis ? +w.homeGoals : +w.awayGoals, tegen = thuis ? +w.awayGoals : +w.homeGoals;
  const uitkomst = voor > tegen ? "Gewonnen! 🎉" : voor === tegen ? "Gelijkgespeeld." : "Verloren.";
  return {
    titel: `⚽ ${w.home} – ${w.away}: ${w.homeGoals}-${w.awayGoals}`,
    tekst: team.code === instelling.voorspelTeam()
      ? `${team.label}: ${uitkomst} Stem nu op de Man of the Match!`
      : `${team.label}: ${uitkomst} Bekijk de stand in de app.`,
    url: team.code === instelling.voorspelTeam() ? "./#motm" : "./#uitslagen",
    tag: "uitslag-" + wedstrijdSleutel(w)
  };
}

