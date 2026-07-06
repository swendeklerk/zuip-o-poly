import { cp, mkdir, rm, writeFile } from "node:fs/promises";

const outDir = "dist";
const entries = ["index.html", "src", "assets"];

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

for (const entry of entries) {
  await cp(entry, `${outDir}/${entry}`, { recursive: true });
}

const runtimeConfig = {
  SUPABASE_URL: process.env.SUPABASE_URL ?? "",
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY ?? "",
  SUPABASE_GAME_ID: process.env.SUPABASE_GAME_ID ?? "zuipopoly-main"
};

await writeFile(
  `${outDir}/config.js`,
  `window.ZUIPOPOLY_CONFIG = ${JSON.stringify(runtimeConfig, null, 2)};\n`,
  "utf8"
);

console.log(`Static build written to ${outDir}`);
