# Beveiliging Zuip-O-Poly

Korte stand van zaken: dreigingen, wat is opgelost, wat blijft over en wat jij zelf moet instellen.

## Uitgangspunt

De app is een statische site (Vercel) met optionele Supabase-sync via de **anon public key**. Die key staat per definitie in de browser, dus alles wat de anon key mag, mag iedere bezoeker. Beveiliging zit dus in (1) de database-rechten, (2) het schoonmaken van alle data voordat de UI die toont, en (3) browser-headers.

## Dreigingen en status

| # | Dreiging | Ernst | Status |
|---|----------|-------|--------|
| 1 | Anon key kon **alle** spelkamers lezen, overschrijven en **verwijderen** (policy `for all using (true)`) | Hoog | Opgelost met `supabase/schema.hardening.sql` (geen delete, validatie). Volledig dicht na DEEL 3 (zie onder). |
| 2 | Spelkamers opsommen via `select *` | Hoog | Opgelost met DEEL 3 (tabel dicht, alleen RPC met bekende code). |
| 3 | XSS via remote state: team-id's, power-up-id's, getallen en `popup.kind` kwamen ongeëscaped in HTML-attributen | Hoog | Opgelost: `normalizeState` whitelist/valideert alles, `main.js` escapet de resterende attributen. |
| 4 | Gemanipuleerde state (`__proto__`, enorme arrays, `isDemo: true`, gigantische teksten) | Middel | Opgelost: diepe sanering, limieten, `isDemo` alleen voor de lokale testkamer. |
| 5 | Vaste worp forceren via aangepaste knop (`data-roll`) in een echte kamer | Middel | Opgelost: `rollDice` accepteert een vaste worp alleen in de testmodus. |
| 6 | Geen CSP/security headers; inline `onerror`-handlers | Middel | Opgelost: strikte CSP e.d. in `vercel.json`, inline handlers vervangen. |
| 7 | `supabase-js@2` zwevend via CDN (supply chain) | Middel | Gedeeltelijk: versie vastgepind (`2.45.4`). Dynamische imports kennen geen SRI. Zie "Aanbevolen". |
| 8 | Roomcode van 5 tekens (33 miljoen) was te raden/op te sommen | Middel | Opgelost: 6 tekens (1 miljard) + geen opsomming meer na DEEL 3. |
| 9 | Service-role key per ongeluk in de build | Hoog (preventief) | `scripts/build-static.mjs` laat de build falen bij een secret/service_role-key. |
| 10 | Speler vervalst eigen state (worp, positie, timers, power-ups) | Middel | **Niet op te lossen zonder server**, zie "Overgebleven risico's". |

## Wat is aangepast in de code

- `src/store/gameStore.js`: `normalizeState`/`normalizeTeam` valideren ids (`^[A-Za-z0-9_.:-]{1,80}$`), statussen en fases (whitelist), positie 1..40, rondes/beurten/worp begrensd, tijdstempels, tekstlengtes (teamnaam 40, teksten 2000), arrays en diepte begrensd, `__proto__`/`constructor`/`prototype` verwijderd, max 8 teams. Ook `getSession` valideert.
- `src/services/remoteGameState.js`: spelcode wordt gevalideerd (geen filter-injectie in realtime), gebruikt de beveiligde RPC-functies en valt automatisch terug op de tabel als die nog niet bestaan.
- `src/services/supabaseClient.js`: vaste versie, alleen https-URL, geen sessie in localStorage.
- `vercel.json`: CSP (`script-src 'self'` plus alleen `cdn.jsdelivr.net/npm/` voor supabase-js; `connect-src` alleen `*.supabase.co`; `frame-ancestors 'none'`; `object-src 'none'`), HSTS, `nosniff`, `X-Frame-Options`, `Referrer-Policy: no-referrer`, Permissions-Policy (camera/microfoon/locatie uit, bewegingssensor alleen voor de eigen site; vibratie blijft werken).
- `src/main.js`: resterende ids/`kind` geëscaped; `onerror` vervangen door een `data-fallback-src` + listener.

## Wat jij zelf in Supabase moet doen

1. Draai `supabase/schema.sql` (als dat nog niet is gebeurd) en daarna `supabase/schema.hardening.sql` in de SQL Editor (DEEL 1 en 2). Veilig om opnieuw te draaien.
2. Zet de nieuwe versie van de app live op Vercel en test: kamer aanmaken, tweede toestel joinen, een worp.
3. Haal in `schema.hardening.sql` de commentaartekens bij **DEEL 3** weg en draai dat deel. Daarna kan niemand meer kamers opsommen of de tabel rechtstreeks benaderen. Realtime-push stopt, de app pollt elke 2,5 s.
4. Controleer onder Project Settings > API dat alleen de **anon**-key in Vercel (`SUPABASE_ANON_KEY`) staat, nooit de `service_role`-key. Bij twijfel: key roteren.
5. Zet onder Authentication > Providers de signup/anonieme logins uit als je ze niet gebruikt, en zet een spend cap/rate limits aan (Project Settings > API / Auth rate limits).
6. Optioneel: plan het opruimen van oude kamers (staat uitgecommentarieerd onderaan het SQL-bestand).

## Overgebleven risico's

- **Spellogica draait in de browser.** Wie de spelcode heeft, kan met ontwikkelaarstools zijn eigen team vervalsen (positie, rondes, timers, power-ups) en via de gedeelde state ook andermans team aanpassen; per-team revisienummers dwingen niets af. De database controleert alleen vorm en bereik, niet of een zet "mag". Echte anti-cheat vraagt een server: een Supabase Edge Function die alleen geldige acties (`rollDice`, `confirmTask`, ...) accepteert en de state zelf berekent, met een geheime teamtoken per team. Voor een vriendenavond is dit acceptabel; voor een wedstrijd met prijs niet.
- Turbo-test (`?turbo=1`) verkort timers lokaal en is dus ook een valsspeel-knop; zet dit uit voor serieuze avonden of verwijder de knop.
- Iedereen met de code van een kamer kan die kamer lezen en bijwerken (verwacht gedrag; houd de code binnen de groep). Rooms bevatten alleen teamnamen en spelvoortgang, geen persoonsgegevens.
- Zonder server is er geen echte rate limit per IP; Supabase/Vercel bieden basis-limieten. Overweeg Vercel Firewall rate limiting.
- Features in `src/features/` die `ctx.toast(html)` gebruiken moeten teamnamen/teksten altijd door `ctx.esc()` halen.

## Aanbevolen vervolg

- Host `supabase-js` zelf (kopie in `assets/vendor/` en importeren met `./`), dan kan `cdn.jsdelivr.net` uit de CSP en is de supply chain gesloten.
- Als je een eigen Supabase-domein gebruikt (geen `*.supabase.co`), pas `connect-src` in `vercel.json` aan.
- Controleer na een deploy de browserconsole op `Content Security Policy`-meldingen.
