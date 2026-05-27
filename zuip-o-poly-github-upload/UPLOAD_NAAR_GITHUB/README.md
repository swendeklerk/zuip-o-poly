# Zuip-O-Poly MVP

Mobiele webapp-basis voor Zuip-O-Poly, gebouwd volgens `Codex Build Spec v1.0`.

## Lokaal starten

Gebruik vanuit deze projectmap:

```powershell
python -m http.server 5173
```

Open daarna:

```text
http://127.0.0.1:5173
```

Of:

```powershell
npm run dev
```

## Build / hosting

Voor Vercel is een static build voorbereid:

```powershell
npm run build
```

De output komt in `dist/`. Supabase-voorbereiding staat in `supabase/schema.sql` en `docs/hosting-supabase.md`.

Voor lokale Supabase-config vul je `config.js` in. Gebruik alleen de Supabase `anon public` key, nooit de `service_role` key.

## Testflow

1. Open drie aparte tabs of telefoons.
2. Log de teams in met:
   - `BRUINEKROEG`
   - `ZWARTEPINT`
   - `WITTEBATAVUS`
3. Open een Kroegraad-tab en log in met:
   - `SWEN` / `0805`
   - `LARS` / `0311`
4. Start het spel zodra de checklist alle drie teams als ingelogd toont.
5. Alle ingelogde teams krijgen een countdown van 10 seconden.
6. Na de countdown start de 2-uurs timer.
7. Een team kan gooien, automatisch verplaatsen en een opdracht zien.
8. Het team klikt op `Bewijs staat in WhatsApp`.
9. De toegewezen Kroegraad ziet het team als `TE KEUREN` en kan goedkeuren of afkeuren.

## Ingebouwd

- De app gebruikt nu lokale browseropslag in plaats van een backend.
- Logo-assets worden geladen uit `assets/zuipopoly-logo-full.png` en `assets/zuipopoly-banner.png`.
- Teamdata staat in `src/data/teams.js`.
- Alle 40 vakken staan in `src/data/tiles.js`.
- Opdrachten staan configuratiegedreven in `src/data/tasks.js`.
- De basis game state/store staat in `src/store/gameStore.js`.
- Dobbelsteen, automatische verplaatsing, bewijsstatus en basiskeuring zijn ingebouwd.
- Het spel gebruikt 25 normale dobbelbeurten per team als eindconditie.

## Placeholders

- De app gebruikt nog geen gedeelde backend, dus echte multi-device sync moet later.
- Bordweergave is nog niet gebouwd.
- Kans, Algemeen Fonds, Wisselstation, Cel en bonusregels hebben nog geen speciale logica.
- Straatopdrachten en enkele vaktypes gebruiken placeholdertekst.
- Pauzeren, sessie vrijgeven, zachte timerstop met volledige eindflow en eindstand komen later.
