/* Rekenregels voor de voorspellingen (ronde en punten). */
import { wandklok } from "./gedeeld.mjs";

const DAG = 864e5;

/* Ronde: dinsdag 00:00 t/m maandag 23:59 (wandklok) */
export function ronde(nu = new Date()) {
  const w = wandklok(nu);
  const d = new Date(w);
  const dagenSindsDinsdag = (d.getUTCDay() + 7 - 2) % 7;
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - dagenSindsDinsdag * DAG;
  return { id: new Date(start).toISOString().slice(0, 10), start, eind: start + 7 * DAG, nu: w };
}

const toto = (a, b) => Math.sign(a - b);
export function punten(v, u) {
  if (!u) return null;
  if (v.thuis === u.thuis && v.uit === u.uit) return 3;
  return toto(v.thuis, v.uit) === toto(u.thuis, u.uit) ? 1 : 0;
}


/* Weekquiz: welke vraag (0-gebaseerd) geldt nu? Wisselt elke zondag 06:00 Nederlandse tijd. */
export function quizWeek(startTekst, nu = new Date()) {
  const [dt, tm = "06:00"] = String(startTekst).split("T");
  const [j, m, d] = dt.split("-").map(Number); const [u, mi] = tm.split(":").map(Number);
  const start = Date.UTC(j, m - 1, d, u, mi);
  return Math.floor((wandklok(nu) - start) / (7 * DAG));
}
