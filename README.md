# Zuip-O-Poly Nijmegen

Self-running mobiele webapp voor Zuip-O-Poly Nijmegen: een interactieve kroegentocht-game waarbij teams via hun telefoon over een digitaal bord door Nijmegen bewegen. De app is de spelleider — er is geen admin of Kroegraad nodig.

## Lokaal starten

Op deze machine is geen Python of Node beschikbaar, dus gebruik de meegeleverde PowerShell dev-server:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\dev-server.ps1 -Port 5173
```

Heb je wel Python? Dan werkt ook:

```powershell
python -m http.server 5173
```

Open daarna:

```text
http://127.0.0.1:5173
```

## Build / hosting

Voor Vercel is een static build voorbereid:

```powershell
npm run build
```

De output komt in `dist/`. Supabase-voorbereiding staat in `supabase/schema.sql` en `docs/hosting-supabase.md`.

Voor lokale Supabase-config vul je `config.js` in (zie `config.example.js`). Gebruik alleen de Supabase `anon public` key, nooit de `service_role` key. Zonder Supabase-config valt de app terug op lokale browseropslag (`LOKAAL`-badge in de lobby).

## Spelflow

1. Een speler maakt een spelkamer aan: kiest teamnaam, teamkleur en een spelstand (Gezellig 15 / Fanatiek 20 / Legendarisch 25 worpen). Deze speler is de **spelstarter** en speelt daarna gewoon mee — geen admin-rol.
2. Andere teams joinen met de gedeelde spelcode, kiezen zelf een teamnaam en teamkleur.
3. Zodra minimaal 2 teams klaarstaan, start de spelstarter het spel. Countdown, daarna start iedereen op vak 1.
4. Ieder team gooit, wordt automatisch verplaatst, voert de opdracht/kaart/actie van het vak uit en bevestigt zelf ("Gedaan, wij zweren het") of skipt (altijd −2 vakjes).
5. Teams kunnen elkaar dwarszitten via Kans, Algemeen Fonds, Wisselstation en power-ups. De app verwerkt dit direct en toont meldingen aan beide teams.
6. Na het ingestelde aantal beurten is een team "Gefinisht". Zodra alle teams klaar zijn, bepaalt de app automatisch de eindstand (rondes → positie → tijdstip).

## Code-organisatie

- `src/store/gameStore.js` — de volledige spellogica en statemachine (self-running, refresh-proof, anti-cheat).
- `src/main.js` — rendering en UI-events, geen spellogica.
- `src/data/` — configuratiegedreven speldata: bord (`tiles.js`), opdrachten (`tileAssignments.js`, `tasks.js`), kaarten (`cards.js`), spelstanden/kleuren/timers (`gameConfig.js`), statussen (`statuses.js`).
- `src/services/` — Supabase-sync (optioneel, per spelkamer/roomcode).
- `src/styles.css` — huisstijl (design tokens, Bebas Neue/Inter/JetBrains Mono).

## Anti-cheat / refresh-proof

- Geworpen is geworpen: de worp wordt direct opgeslagen zodra op "Gooi dobbelsteen" wordt geklikt.
- Alle timers (opdracht, cel, wisselstation, aanval) zijn gebaseerd op een opgeslagen starttijd — een refresh of nieuw toestel reset nooit een timer.
- Skippen kost altijd 2 vakjes, tenzij een power-up expliciet een gratis skip geeft.
- Eén actieve sessie per team; een nieuw toestel neemt de bestaande sessie over zonder de spelstand te wijzigen.
