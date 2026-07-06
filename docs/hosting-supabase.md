# Hosting + Supabase voorbereiding

## Hosting

Aanbevolen:

- Vercel voor de webapp.
- Supabase voor realtime spelstatus.

Deze repo heeft nu:

- `vercel.json`
- `npm run build`
- `dist/` output via `scripts/build-static.mjs`

## Supabase

1. Maak later een Supabase project aan.
2. Open SQL Editor.
3. Draai `supabase/schema.sql`.
4. Zet realtime aan voor `public.game_states`.
5. Vul later de frontend-config in.

## Config

De app gebruikt nu nog localStorage als fallback. Supabase-config is voorbereid in:

- `.env.example`
- `config.js`
- `config.example.js`
- `src/config/supabaseConfig.js`
- `src/services/supabaseClient.js`
- `src/services/remoteGameState.js`

Lokaal kun je `config.js` invullen:

```js
window.ZUIPOPOLY_CONFIG = {
  SUPABASE_URL: "https://jouw-project.supabase.co",
  SUPABASE_ANON_KEY: "jouw-anon-public-key",
  SUPABASE_GAME_ID: "zuipopoly-main"
};
```

Gebruik nooit de `service_role` key in de frontend. Alleen de `anon public` key.

Voor Vercel zet je deze environment variables:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_GAME_ID`

Tijdens `npm run build` wordt `dist/config.js` automatisch gemaakt met die waarden.

## Volgende technische stap

De volgende stap is de store echt omschakelen:

- bij laden eerst Supabase state ophalen;
- bij wijzigingen state naar Supabase schrijven;
- realtime subscription aanzetten;
- localStorage alleen als fallback gebruiken.
