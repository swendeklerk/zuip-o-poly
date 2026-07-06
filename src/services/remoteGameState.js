import { SUPABASE_CONFIG } from "../config/supabaseConfig.js";
import { getSupabaseClient } from "./supabaseClient.js";

const TABLE = "game_states";

export async function loadRemoteGameState() {
  const client = await getSupabaseClient();
  if (!client) {
    return null;
  }

  const { data, error } = await client
    .from(TABLE)
    .select("state")
    .eq("id", SUPABASE_CONFIG.gameId)
    .maybeSingle();

  if (error) {
    console.warn("Kon Supabase game state niet laden.", error);
    return null;
  }

  return data?.state ?? null;
}

export async function saveRemoteGameState(state) {
  const client = await getSupabaseClient();
  if (!client) {
    return false;
  }

  const { error } = await client.from(TABLE).upsert({
    id: SUPABASE_CONFIG.gameId,
    state,
    updated_at: new Date().toISOString()
  });

  if (error) {
    console.warn("Kon Supabase game state niet opslaan.", error);
    return false;
  }

  return true;
}

export async function subscribeRemoteGameState(onState) {
  const client = await getSupabaseClient();
  if (!client) {
    return () => {};
  }

  const channel = client
    .channel(`game-state-${SUPABASE_CONFIG.gameId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: TABLE,
        filter: `id=eq.${SUPABASE_CONFIG.gameId}`
      },
      (payload) => {
        if (payload.new?.state) {
          onState(payload.new.state);
        }
      }
    )
    .subscribe();

  return () => {
    client.removeChannel(channel);
  };
}
