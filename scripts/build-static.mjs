import { cp, mkdir, rm, writeFile } from "node:fs/promises";

const outDir = "dist";
const entries = ["index.html", "src", "assets"];

// Beveiliging: alleen de PUBLIEKE (anon) key mag in de client-build komen.
// Een service_role-/secret-key in dist/config.js zou voor iedereen leesbaar zijn
// en geeft volledige toegang tot de database. De build faalt dan bewust.
function assertPublicKeyOnly(name, value) {
  if (!value) {
    return;
  }
  if (/^sb_secret_/i.test(value)) {
    throw new Error(`${name} lijkt een Supabase SECRET key. Gebruik alleen de anon/publishable key.`);
  }
  const parts = value.split(".");
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
      if (payload && payload.role && payload.role !== "anon") {
        throw new Error(
          `${name} heeft role "${payload.role}". Alleen de key met role "anon" mag in de client-build.`
        );
      }
    } catch (error) {
      if (error instanceof SyntaxError) {
        return; // geen leesbare JWT: niet blokkeren
      }
      throw error;
    }
  }
}

const supabaseUrl = process.env.SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY ?? "";
const supabaseGameId = process.env.SUPABASE_GAME_ID ?? "zuipopoly-main";

assertPublicKeyOnly("SUPABASE_ANON_KEY", supabaseAnonKey);
if (supabaseUrl && !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(supabaseUrl)) {
  console.warn(
    "Waarschuwing: SUPABASE_URL is geen https://<project>.supabase.co-adres. " +
      "Pas dan ook connect-src in vercel.json aan, anders blokkeert de CSP de verbinding."
  );
}

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

for (const entry of entries) {
  await cp(entry, `${outDir}/${entry}`, { recursive: true });
}

const runtimeConfig = {
  SUPABASE_URL: supabaseUrl,
  SUPABASE_ANON_KEY: supabaseAnonKey,
  SUPABASE_GAME_ID: supabaseGameId
};

await writeFile(
  `${outDir}/config.js`,
  `window.ZUIPOPOLY_CONFIG = ${JSON.stringify(runtimeConfig, null, 2)};\n`,
  "utf8"
);

console.log(`Static build written to ${outDir}`);
