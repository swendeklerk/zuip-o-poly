# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Groepen van 18+ die een avond uit zijn in Nijmegen: vriendengroepen, vrijgezellenfeesten en studenten. Elk team speelt op zijn eigen telefoon (mobiel web), onderweg van kroeg naar kroeg, vaak in het donker, met een drankje in de hand en niet helemaal nuchter. Er is geen organisator of spelleider nodig.

## Product Purpose
Een interactieve kroegentocht-game waarbij teams via hun telefoon over een digitaal Monopoly-achtig bord door Nijmegen bewegen. De app is zelf de spelleider: ze regelt worpen, vakken, opdrachten, kaarten, timers en de eindstand. Succes is een avond waarin teams elkaar uitdagen en iedereen zonder gedoe kan meespelen.

## Positioning
Teams tegen elkaar: competitie en elkaar dwarszitten (Kans, Algemeen Fonds, Wisselstation en power-ups) staan voorop. Het verschil met een gewone kroegentocht is dat het spel zichzelf runt: geen admin, geen Kroegraad, geen papieren spelregels.

## Operating Context
Spelen in teams van 1 tot 8, met een gedeelde spelcode. De spelstarter maakt de kamer en speelt zelf mee. Timers zijn gebaseerd op een opgeslagen starttijd, zodat refresh of een nieuw toestel niets reset. Zonder Supabase-config valt de app terug op lokale opslag.

## Capabilities and Constraints
Spelstanden van 15, 20 of 25 worpen; maximaal 8 teams; bord met 40 vakken en vaste Nijmeegse vaknamen. Alle spellogica draait in de browser. Skippen kost altijd 2 vakjes. Teksten zijn Nederlands, met humor en alcohol-thema.

Open beslissing: of het merk (de beer met hoge hoed, het donkere kroegthema, de Nijmeegse vaknamen) bindend is of vrij aanpasbaar. De eigenaar gaf hier nog geen voorkeur voor.

## Evidence on Hand
Illustraties van de beer en de vakjes (`assets/tiles/*.png`), de hero-banner en het embleem (`assets/`). Echte Nijmeegse plekken als vaknamen. Er zijn geen testimonials, gebruikersaantallen of partners vastgelegd; die mag toekomstig werk niet verzinnen.

## Product Principles
- De app is de spelleider: niemand hoeft uit te leggen, alles is duidelijk bij één blik.
- Teams tegen elkaar: competitie en dwarszitten zijn het hart, niet het randje.
- Bruikbaar met één hand, in het donker en met een drankje: grote doelen, korte teksten.
- Een refresh, een nieuw toestel of een haperende verbinding mag het spel nooit breken.
- Humor en sfeer ondersteunen het spel; ze mogen de volgende actie nooit verbergen.

## Accessibility & Inclusion
Spelers zijn 18+ en vaak niet nuchter, onderweg en soms in fel licht of donker. Daaruit volgt: goed contrast, grote aanraakdoelen en weinig tekst per scherm. Een formele toegankelijkheidsnorm is niet vastgelegd.
