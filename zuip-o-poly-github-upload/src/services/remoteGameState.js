import { getSupabaseClient } from "./supabaseClient.js";

const TABLE = "game_states";
const RPC_GET = "zuip_get_state";
const RPC_SAVE = "zuip_save_state";

// Spelcodes bestaan alleen uit letters/cijfers. Dit voorkomt dat een vreemde
// code (spaties, komma's, punten) in de PostgREST- of realtime-filter terechtkomt.
const ROOM_CODE_PATTERN = /^[A-Z0-9]{3,12}$/;

// "unknown" -> nog niet geprobeerd, "rpc" -> beveiligde functies uit
// supabase/schema.hardening.sql, "table" -> directe tabeltoegang (oud schema).
let accessMode = "unknown";

function cleanRoomCode(roomCode) {
  const code = String(roomCode ?? "").trim().toUpperCase();
  return ROOM_CODE_PATTERN.test(code) ? code : null;
}

function rowIdForRoom(roomCode) {
  const code = cleanRoomCode(roomCode);
  return code ? `room_${code}` : null;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isMissingFunctionError(error) {
  return (
    error?.code === "PGRST202" ||
    error?.status === 404 ||
    /could not find the function/i.test(String(error?.message ?? ""))
  );
}

export async function loadRemoteGameState(roomCode) {
  const client = await getSupabaseClient();
  const code = cleanRoomCode(roomCode);
  if (!client || !code) {
    return null;
  }

  if (accessMode !== "table") {
    const { data, error } = await client.rpc(RPC_GET, { p_room: code });
    if (!error) {
      accessMode = "rpc";
      return isPlainObject(data) ? data : null;
    }
    if (!isMissingFunctionError(error)) {
      console.warn("Kon Supabase game state niet laden.", error);
      return null;
    }
    accessMode = "table";
  }

  const { data, error } = await client
    .from(TABLE)
    .select("state")
    .eq("id", rowIdForRoom(code))
    .maybeSingle();

  if (error) {
    console.warn("Kon Supabase game state niet laden.", error);
    return null;
  }

  return isPlainObject(data?.state) ? data.state : null;
}

export async function saveRemoteGameState(roomCode, state) {
  const client = await getSupabaseClient();
  const code = cleanRoomCode(roomCode);
  if (!client || !code || !isPlainObject(state)) {
    return false;
  }

  if (accessMode !== "table") {
    const { error } = await client.rpc(RPC_SAVE, { p_room: code, p_state: state });
    if (!error) {
      accessMode = "rpc";
      return true;
    }
    if (!isMissingFunctionError(error)) {
      console.warn("Kon Supabase game state niet opslaan.", error);
      return false;
    }
    accessMode = "table";
  }

  const { error } = await client.from(TABLE).upsert({
    id: rowIdForRoom(code),
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
  const rowId = rowIdForRoom(roomCode);
  // Bij beveiligde toegang (rpc) is de tabel niet leesbaar voor realtime;
  // de poll in gameStore (elke 2,5 s) neemt het dan over.
  if (!client || !rowId || accessMode === "rpc") {
    return () => {};
  }

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
        if (isPlainObject(payload.new?.state)) {
          onState(payload.new.state);
        }
      }
    )
    .subscribe();

  return () => {
    client.removeChannel(channel);
  };
}
