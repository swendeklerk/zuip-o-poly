# Zuip-O-Poly Nijmegen

Self-running mobiele webapp voor Zuip-O-Poly Nijmegen: een interactieve kroegentocht-game waarbij teams via hun telefoon over een digitaal bord door Nijmegen bewegen. De app is de spelleider — er is geen admin of Kroegraad nodig.

## Lokaal starten

Het makkelijkst: dubbelklik op `START_TESTOMGEVING.bat`. Dat opent de browser en
start de meegeleverde PowerShell dev-server. Handmatig kan ook:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\dev-server.ps1 -Port 5173
```

Heb je Python? Dan werkt ook `python -m http.server 5173`. Open daarna
`http://127.0.0.1:5173`.

- **Meerdere teams testen:** open de app in aparte browser- of incognitovensters
  (één venster = één team).
- **Opnieuw beginnen:** `http://127.0.0.1:5173/?reset=1` of "Spelkamer verlaten".
- **Alles los uitproberen:** de knop **Testmodus** op het startscherm zet je
  direct in een lopend spel met een testpaneel (teleporteren, kaarten trekken,
  aanvallen simuleren, timers overslaan).

- **Snel het hele spel doorlopen (Turbo-test):** zet op het startscherm de knop
  **Turbo-test** aan, of open `?turbo=1`. Alle timers (aftelling, opdrachten, cel,
  wisselstation, aanval) zijn dan ~15x korter en de animaties sneller. Uit via de
  knop of `?turbo=0`. Het blijft onthouden in de browser; een gele TURBO-badge toont
  dat het aan staat.

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
3. De spelstarter start het spel zodra alle teams klaarstaan (solo starten mag ook, om te testen). Countdown, daarna start iedereen op vak 1.
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

## Extra's (src/features/)

Losse modules die de app uitbreiden zonder de spellogica te raken; een kapotte module wordt overgeslagen.

- `eastEggs.js` — 25 verborgen geheimen met teller en overzicht (`?eggtime=2026-12-05T17:30` simuleert een datum).
- `juice.js` — confetti, vuurwerk, bierschuim, soundboard (🍻) en optioneel schudden om te gooien.
- `awards.js` — badges, kroegstats (📊), dagboek en kroegprijzen op het eindscherm.

`?turbo=1` en `?reset=1` beginnen met een schoon spel en verdwijnen daarna uit de adresbalk. Spelcodes zijn 6 tekens. Beveiliging: zie `docs/security.md` en `supabase/schema.hardening.sql`.
