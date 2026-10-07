/*
  Web Push zonder extra pakketten (RFC 8291 versleuteling + RFC 8292 VAPID).
  De VAPID-sleutels worden bij het eerste gebruik automatisch aangemaakt en
  veilig in de Netlify-opslag bewaard; je hoeft zelf niets in te stellen.
*/
import crypto from "node:crypto";
import { winkel, instelling } from "./gedeeld.mjs";

const b64u = buf => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const vanB64u = s => Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64");

/* VAPID-sleutelpaar ophalen of eenmalig aanmaken */
export async function vapidSleutels() {
  const st = winkel("push");
  let k = await st.get("vapid", { type: "json" }).catch(() => null);
  if (!k) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const jwk = privateKey.export({ format: "jwk" });
    const pub = publicKey.export({ format: "jwk" });
    const ruw = Buffer.concat([Buffer.from([4]), vanB64u(pub.x), vanB64u(pub.y)]);
    k = { jwk, publicKey: b64u(ruw) };
    // alleen opslaan als er nog niets staat (twee gelijktijdige eerste aanroepen)
    const r = await st.setJSON("vapid", k, { onlyIfNew: true }).catch(() => null);
    if (r && r.modified === false) k = await st.get("vapid", { type: "json" });
  }
  return k;
}

function vapidHeader(endpoint, k) {
  const aud = new URL(endpoint).origin;
  const kop = b64u(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const inhoud = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: instelling.contact() }));
  const sleutel = crypto.createPrivateKey({ key: k.jwk, format: "jwk" });
  const handtekening = crypto.sign("sha256", Buffer.from(kop + "." + inhoud), { key: sleutel, dsaEncoding: "ieee-p1363" });
  return `vapid t=${kop}.${inhoud}.${b64u(handtekening)}, k=${k.publicKey}`;
}

/* Versleutel de melding voor één abonnement (aes128gcm) */
export function versleutel(abonnement, tekst) {
  const uaPub = vanB64u(abonnement.keys.p256dh);
  const auth = vanB64u(abonnement.keys.auth);
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  const asPub = ecdh.getPublicKey();
  const gedeeld = ecdh.computeSecret(uaPub);

  const info = Buffer.concat([Buffer.from("WebPush: info\0"), uaPub, asPub]);
  const ikm = Buffer.from(crypto.hkdfSync("sha256", gedeeld, auth, info, 32));
  const zout = crypto.randomBytes(16);
  const cek = Buffer.from(crypto.hkdfSync("sha256", ikm, zout, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(crypto.hkdfSync("sha256", ikm, zout, Buffer.from("Content-Encoding: nonce\0"), 12));

  const c = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const versleuteld = Buffer.concat([c.update(Buffer.concat([Buffer.from(tekst), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const kop = Buffer.alloc(21);
  zout.copy(kop, 0);
  kop.writeUInt32BE(4096, 16);
  kop.writeUInt8(asPub.length, 20);
  return Buffer.concat([kop, asPub, versleuteld]);
}

/* Stuur één melding. Geeft de HTTP-status terug (404/410 = abonnement bestaat niet meer). */
export async function stuurPush(abonnement, bericht, k) {
  const body = versleutel(abonnement, JSON.stringify(bericht));
  try {
    const r = await fetch(abonnement.endpoint, {
      method: "POST",
      headers: {
        "Authorization": vapidHeader(abonnement.endpoint, k),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        "TTL": "86400",
        "Urgency": "normal"
      },
      body
    });
    return r.status;
  } catch (e) {
    return 0;
  }
}

/* Stuur een melding naar alle aangemelde telefoons die deze soort melding willen
   ("uitslagen" of "nieuws"); ruimt verlopen abonnementen op */
export async function stuurAanIedereen(bericht, soort = "uitslagen") {
  const st = winkel("push-abonnementen");
  const k = await vapidSleutels();
  const { blobs } = await st.list();
  let verstuurd = 0, opgeruimd = 0;
  // in kleine groepjes tegelijk versturen
  for (let i = 0; i < blobs.length; i += 20) {
    await Promise.all(blobs.slice(i, i + 20).map(async b => {
      const ab = await st.get(b.key, { type: "json" }).catch(() => null);
      if (!ab?.sub) return;
      const soorten = Array.isArray(ab.soorten) ? ab.soorten : ["uitslagen", "nieuws"];
      if (!soorten.includes(soort)) return;
      const status = await stuurPush(ab.sub, bericht, k);
      if (status === 404 || status === 410) { await st.delete(b.key); opgeruimd++; }
      else if (status >= 200 && status < 300) verstuurd++;
    }));
  }
  return { verstuurd, opgeruimd, totaal: blobs.length };
}

export const hashSleutel = s => crypto.createHash("sha256").update(String(s)).digest("hex").slice(0, 40);
