const runtimeConfig = window.ZUIPOPOLY_CONFIG ?? {};

export const SUPABASE_CONFIG = {
  url: runtimeConfig.SUPABASE_URL ?? "",
  anonKey: runtimeConfig.SUPABASE_ANON_KEY ?? "",
  gameId: runtimeConfig.SUPABASE_GAME_ID ?? "zuipopoly-main"
};

export function hasSupabaseConfig() {
  return Boolean(SUPABASE_CONFIG.url && SUPABASE_CONFIG.anonKey);
}
