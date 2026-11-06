import { SUPABASE_CONFIG, hasSupabaseConfig } from "../config/supabaseConfig.js";

let clientPromise = null;

// Vastgepinde versie i.p.v. "@2": een nieuwe (of gekaapte) release op jsDelivr
// komt zo niet ongezien in de app. Dynamische imports ondersteunen geen SRI;
// wil je volledige controle, host dan zelf een kopie (zie docs/security.md).
const SUPABASE_JS_URL = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

function isSafeSupabaseUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

export async function getSupabaseClient() {
  if (!hasSupabaseConfig() || !isSafeSupabaseUrl(SUPABASE_CONFIG.url)) {
    return null;
  }

  if (!clientPromise) {
    clientPromise = import(SUPABASE_JS_URL)
      .then(({ createClient }) =>
        createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey, {
          // Geen auth-sessie of tokens in localStorage nodig: de app gebruikt alleen de anon key.
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
        })
      )
      .catch((error) => {
        console.warn("Supabase client kon niet laden. LocalStorage fallback blijft actief.", error);
        return null;
      });
  }

  return clientPromise;
}
