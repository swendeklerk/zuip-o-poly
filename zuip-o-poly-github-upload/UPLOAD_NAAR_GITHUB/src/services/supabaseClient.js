import { SUPABASE_CONFIG, hasSupabaseConfig } from "../config/supabaseConfig.js";

let clientPromise = null;

export async function getSupabaseClient() {
  if (!hasSupabaseConfig()) {
    return null;
  }

  if (!clientPromise) {
    clientPromise = import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm")
      .then(({ createClient }) =>
        createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey)
      )
      .catch((error) => {
        console.warn("Supabase client kon niet laden. LocalStorage fallback blijft actief.", error);
        return null;
      });
  }

  return clientPromise;
}
