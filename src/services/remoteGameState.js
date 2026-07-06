import { getSupabaseClient } from "./supabaseClient.js";

const TABLE = "game_states";

function rowIdForRoom(roomCode) {
  return `room_${String(roomCode ?? "").trim().toUpperCase()}`;
}

export async function loadRemoteGameState(roomCode) {
  const client = await getSupabaseClient();
  if (!client || !roomCode) {
    return null;
  }

  const { data, error } = await client
    .from(TABLE)
    .select("state")
    .eq("id", rowIdForRoom(roomCode))
    .maybeSingle();

  if (error) {
    console.warn("Kon Supabase game state niet laden.", error);
    return null;
  }

  return data?.state ?? null;
}

export async function saveRemoteGameState(roomCode, state) {
  const client = await getSupabaseClient();
  if (!client || !roomCode) {
    return false;
  }

  const { error } = await client.from(TABLE).upsert({
    id: rowIdForRoom(roomCode),
    state,
    updated_at: new Date().toISOString()
  });

  if (error) {
    console.warn("Kon Supabase game state niet opslaan.", error);
    return false;
  }

  return true;
}

export async function subscribeRemoteGameState(roomCode, onState) {
  const client = await getSupabaseClient();
  if (!client || !roomCode) {
    return () => {};
  }

  const rowId = rowIdForRoom(roomCode);
  const channel = client
    .channel(`game-state-${rowId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: TABLE,
        filter: `id=eq.${rowId}`
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
