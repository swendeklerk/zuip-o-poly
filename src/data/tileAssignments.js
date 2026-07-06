// Vaste opdrachten per vak. timerType verwijst naar TASK_TIMERS in gameConfig.js
// (short 30s, bar 75s, snack 120s, location 180s, none 0s).
export const TILE_ASSIGNMENTS = {
  1: {
    id: 1,
    type: "Start",
    label: "Start",
    location: "Grote Markt",
    popup: "Bordje rond! Klasse. En als je langs Start komt, hoort daar uiteraard een beloning bij…",
    teamText: "Jullie mogen een lekker biertje uitdelen aan één team naar keuze!",
    rules: "Kies een team in de app en bel ze om het goede nieuws te brengen.",
    timerType: "none"
  },
  2: {
    id: 2,
    type: "Straatvak",
    label: "Kroeg",
    location: "De Blonde Pater",
    popup: "Iedereen houdt van een lekker blondje. En hopelijk (voor jullie) zijn deze ook niet schaars in de stad..",
    teamText: "Daag een random blonde persoon uit voor een wedstrijdje adten van één blond biertje.",
    rules: "Winnen of verliezen maakt niet uit, maar wel beide adten!",
    timerType: "bar"
  },
  3: {
    id: 3,
    type: "Algemeen Fonds",
    label: "Algemeen Fonds",
    location: "-",
    popup: "-",
    teamText: "-",
    rules: "-",
    timerType: "none"
  },
  4: {
    id: 4,
    type: "Straatvak",
    label: "Kroeg",
    location: "Roxy's Tikibar",
    popup: "Wie Roxy leest, leest automatisch 'Dekker' er achter. Maar helaas is dit geen bar van onze Rox. Maar, om toch een ode te brengen aan de minnares van Koen...",
    teamText: "Bestel één Missonary's Downfall (Roxy-ro's favoriete standje, heb ik me laten vertellen), en drink deze, omdat 'Tikkie' dit jaar 10 jaar bestaat, op in maximaal 10 seconden.",
    rules: ">10 sec. = opnieuw doen\nIJs en andere meuk telt niet mee uiteraard.",
    timerType: "bar"
  },
  5: {
    id: 5,
    type: "Vast strafvak",
    label: "Speciaal Vak",
    location: "Fietsbelasting",
    popup: "Stijn raakte ooit zijn witte Batavus kwijt. Tragisch, onnodig en tot op de dag van vandaag eigenlijk nog steeds niet helemaal verwerkt. Tijd om de zoektocht officieel te heropenen.",
    teamText: "Fotografeer 5 witte fietsen als eerbetoon aan Stijns verdwenen witte Batavus. De fietsen moeten duidelijk herkenbaar wit zijn. Dit mogen losse foto's zijn of één foto/video waarin meerdere witte fietsen zichtbaar zijn. Daarna mogen jullie verder.",
    rules: "-",
    timerType: "location"
  },
  6: {
    id: 6,
    type: "Snackstation",
    label: "Station",
    location: "McDonalds",
    popup: "Snackstation!",
    teamText: "Ieder actief teamlid haalt minimaal één snackie bij de McDonalds. Smikkel deze lekker op. Eetsmakelijk allen!",
    rules: "Geen verdere regels/restricties.",
    timerType: "snack"
  },
  7: {
    id: 7,
    type: "Straatvak",
    label: "Kroeg",
    location: "De Blaauwe Hand",
    popup: "Jullie zijn beland op de Blaauwe Hand. Tijd voor een klein stukje geschiedenis: Het oudste en nog bestaande speciaalbier ter wereld komt uit Beieren. Daar wordt al bijna 1.000 (!) jaar bier gebrouwen, bij Weihenstephan. Hansie heeft dus nog wel even te gaan! Jullie gaan op zoek naar een Duits/Beiers biertje. En waar kan dat toepasselijker dan bij het oudste café van Nijmegen! Het cirkerltje is weer rond.",
    teamText: "Bestel een Schneider Helles. Daarbij geeft één teamlid een serieus biercollege van minimaal 30 seconden over Beiers bier (dit mag je voorbereiden). En zoals de Duitsers altijd zeggen: Prost!",
    rules: "Geen verdere regels/restricties.",
    timerType: "bar"
  },
  8: {
    id: 8,
    type: "Kans",
    label: "Kans",
    location: "-",
    popup: "-",
    teamText: "-",
    rules: "-",
    timerType: "none"
  },
  9: {
    id: 9,
    type: "Straatvak",
    label: "Kroeg",
    location: "Kruittoren (Kronenburgerpark)",
    popup: "Het Kronenburgerpark. Iconisch natuurlijk, en misschien wel de grootste hit van Nijmegenaar Frank Boeijen (en zijn groep). Een andere mega hit van deze Nijmegenaar is Zwart-Wit. En daar kunnen we wel iets mee…",
    teamText: "Fix een Zwart, én een Wit drankje, en nuttig deze in het Kronenburgerpark. Enjoy!",
    rules: "Uiteraard moeten het alcoholische drankjes zijn.",
    timerType: "location"
  },
  10: {
    id: 10,
    type: "Straatvak",
    label: "Kroeg",
    location: "Red Light's Nijmegen",
    popup: "\"IIk zieee het Rooode liiiccht, de gordijnen zijn…\" Goed, u kent het wel. Uit betrouwbare bronnen blijkt dat ze ook in Nimma hoertjes hebben, alleen denk ik niet dat die al aan het werk zijn momenteel. Zonde, want jullie hadden nog wel die Monopoly-dollar meegenomen! Ach ja, zo'n hoerentent blijft voor de één wat mysterieuzer dan voor de ander...",
    teamText: "Haal voor ieder actief teamlid een drankje. Minimaal: 1 speciaal biertje, 1 zoet drankje en 1 vies shotje. Zet de drankjes random neer, nummer ze en laat ieder teamlid met ogen dicht een nummer aanwijzen. Wat je aanwijst, is wat je adt. Direct doorslikken, niet zeuren.",
    rules: "1. Haal voor ieder actief teamlid een drankje.\nMinimaal: 1 speciaal biertje, 1 zoet drankje en 1 vies shotje.\n2. Zet ze random neer en nummer ze.\n3. Ieder teamlid wijst blind een nummer aan.\n4. Iedereen adt direct zijn/haar aangewezen drankje.",
    timerType: "bar"
  },
  11: {
    id: 11,
    type: "Cel Bezoekvak",
    label: "Op Bezoek bij de Cel",
    location: "Nagelstudio Saigon",
    popup: "Als er voor Cel één plek als een gevangenis voelde, was het wel de nagelstudio in Nijmegen. Wat een verschrikkelijke plek!",
    teamText: "Ga op bezoek bij Nagelstudio Saigon, en maak een leuke selfie ter herinnering.",
    rules: "Op de selfie moet goed te zien zijn dat jullie bij Nagelstudio Saigon zijn.",
    timerType: "location"
  },
  12: {
    id: 12,
    type: "Straatvak",
    label: "Kroeg",
    location: "The Shamrock",
    popup: "Deze kan iedereen natuurlijk wel invullen: Split the G!",
    teamText: "You heard me mate, focking Split the focking G you little twat!",
    rules: "Schuimrand moet tussen de bovenkant- en middenstreepje van de G zitten. Hoeft niet perfect op de middenstreep!",
    timerType: "bar"
  },
  13: {
    id: 13,
    type: "Vast speciaal vak",
    label: "Speciaal Vak",
    location: "Waterleiding",
    popup: "Oei. De waterleiding is gesprongen. Heel vervelend natuurlijk, vooral voor degene die straks als noodopvang wordt gebruikt. Tijd voor waterschade in teamverband.",
    teamText: "Koop of regel een flesje water. Kies één actief teamlid uit en gooi het flesje water volledig leeg over deze persoon. Zorg dat het water echt over een teamgenoot heen gaat. Daarna mogen jullie verder.",
    rules: "-",
    timerType: "short"
  },
  14: {
    id: 14,
    type: "Straatvak",
    label: "Kroeg",
    location: "Sjors & Sjimmie",
    popup: "Sjors & Sjimmie is natuurlijk één van dé uitgaansgelegenheden van Nijmegen. Wat zouden we hier toch kunnen gaan doen..",
    teamText: "Gooi één keer met de fysieke dobbelsteen uit je tasje, en drink dat aantal biertjes in totaal samen met je teamgenoten.",
    rules: "Eén keer gooien, dat aantal drinken. (Oneerlijk) verdelen over het team mag!",
    timerType: "bar"
  },
  15: {
    id: 15,
    type: "Straatvak",
    label: "Kroeg",
    location: "Albert Heijn",
    popup: "Eerst had ik hier een wijnbar staan, maar die zitten waarschijnlijk niet ons te wachten. Maar wat is een zuipspelletje zonder vino!!?!",
    teamText: "Haal allemaal een klein wijntje (250ml) bij de Albert Heijn en tut deze lekker leeg. Cheers gurliesss",
    rules: "Uiteraard verplicht met alcohol.",
    timerType: "bar"
  },
  16: {
    id: 16,
    type: "Wisselstation",
    label: "Station",
    location: "-",
    popup: "Jullie staan op het Wisselstation. Tijd om de boel even lekker door elkaar te gooien. Waarom zelf netjes verder spelen als je ook een ander team uit hun flow kunt trekken?",
    teamText: "Kies één ander team om mee van positie te wisselen. Jullie wisselen direct van plek op het bord. Het gekozen team stopt meteen met de opdracht waar ze mee bezig zijn. Die opdracht vervalt. Het gekozen team krijgt géén nieuwe opdracht op het nieuwe vakje, maar moet eerst 3 minuten wachten voordat ze opnieuw mogen gooien. Jullie team mag na de wissel direct opnieuw gooien.",
    rules: "-",
    timerType: "none"
  },
  17: {
    id: 17,
    type: "Straatvak",
    label: "Kroeg",
    location: "Brouwerij Florijn",
    popup: "Is het een vliegtuig? Is het een vogel? Nee, dat is het niet. Maar hè, wat dan wel? Een biertje? Een wijntje? Ach, da Witte Tonnie!",
    teamText: "Bestel een Witte Tonnie voor ieder actief teamlid en werk hem in één keer achterover!",
    rules: "Adten verplicht. Overgebleven schuim toegestaan.",
    timerType: "bar"
  },
  18: {
    id: 18,
    type: "Algemeen Fonds",
    label: "Algemeen Fonds",
    location: "-",
    popup: "-",
    teamText: "-",
    rules: "-",
    timerType: "none"
  },
  19: {
    id: 19,
    type: "Straatvak",
    label: "Kroeg",
    location: "Poolcafé",
    popup: "Het Poolcafé: dé plek waar sporten en zuipen samenkomen. Vandaag met een sportieve inzet.",
    teamText: "Je begint met 10 biertjes. Pak de tennisbal uit de tas en laat één teamlid het hooghouden filmen. Eén persoon laat de bal zo vaak mogelijk met zijn voeten hooghouden. De 10 biertjes worden verminderd met het aantal keer correct hooggehouden. Let op: je krijgt slechts één poging, en de ondergrens is één biertje.",
    rules: "Film de poging met een tweede telefoon of laat een teamlid meekijken en tellen. Eén persoon, één poging. Elke correcte keer hooghouden is -1 biertje. Ondergrens is één biertje, dus altijd drinken.",
    timerType: "bar"
  },
  20: {
    id: 20,
    type: "Straatvak",
    label: "Kroeg",
    location: "Café Faber",
    popup: "Fabertje. Dat gaat natuurlijk in één adem met Koningsdag en Zomerfeesten. Laten we beide combineren, en een heeerlijk zomers-oranje drankje bestellen:",
    teamText: "Een Aperolleke! Neem lekker plaats in de zon, bestel voor elk actief teamlid een Aperol Spritz en gooi vervolgens samen de fysieke dobbelsteen 2x. Het totaal aantal ogen is het aantal minuten dat jullie minimaal moeten blijven genieten van het zonnetje! De tijd gaat in als de drankjes op tafel staan. Saluti!",
    rules: "Tijd gaat in als de drankjes geserveerd zijn. Maximaal 2x gooien.",
    timerType: "bar"
  },
  21: {
    id: 21,
    type: "Parkeeropdracht / chillvak",
    label: "Vrij Parkeren",
    location: "Mariënburg P5\n(bovenste verdieping)",
    popup: "Vrij Parkeren!",
    teamText: "Parkeer jullie kontjes heel eventjes om wat uit te rusten. Let op: Dit moet wel op een nette parkeerplek! Ga daarom naar Parkeerplaats Mariënburg, en neem plaats op de bovenste verdieping!",
    rules: "Verplicht op de bovenste verdieping.",
    timerType: "location"
  },
  22: {
    id: 22,
    type: "Straatvak",
    label: "Kroeg",
    location: "Festival TREK",
    popup: "Wat een geluk! Misschien wel het leukste foodfestival van Nijmegen is dit weekend: Festival TREK. Trek richting het festival en begin maar met snoepen. En nee, niet op die manier ...",
    teamText: "Haal allemaal een speciaalbiertje naar keuze en geniet er van. Voor de liefhebbers: Dikke aanrader om ook een lekker snackie erbij te halen!",
    rules: "Geen regels/restricties.",
    timerType: "bar"
  },
  23: {
    id: 23,
    type: "Kans",
    label: "Kans",
    location: "-",
    popup: "-",
    teamText: "-",
    rules: "-",
    timerType: "none"
  },
  24: {
    id: 24,
    type: "Straatvak",
    label: "Kroeg",
    location: "Café Biessels",
    popup: "Biessels, daar hebben ze van die heeerlijke, grote vazen met bier. Hebben jullie er al zin in??!",
    teamText: "Bestel voor twee actieve teamleden een halve liter bier, en laat de barman/-vrouw uitkiezen wie deze moeten opdrinken. Doe dit beide binnen 20 seconden om de opdracht te halen!",
    rules: "Barman/-vrouw bepaalt. Maximaal 20 seconden om het op te drinken.\n>20 sec. = opdracht opnieuw",
    timerType: "bar"
  },
  25: {
    id: 25,
    type: "Straatvak",
    label: "Kroeg",
    location: "Albert Heijn",
    popup: "Shhhhhhhotjj…. uhh, gun! Shotgun!",
    teamText: "Plunder de Albert Heijn en haal allemaal een blikkie Stëlz. Shotgun deze vervolgens allemaal tegelijk. Degene die het traagst was, mag het nog eens in zijn eentje opnieuw proberen!",
    rules: "Start de shotgun tegelijk. De traagste doet er nog één.",
    timerType: "bar"
  },
  26: {
    id: 26,
    type: "Snackstation",
    label: "Station",
    location: "FEBO",
    popup: "Snackstation!",
    teamText: "Ieder actief teamlid haalt minimaal één snackie uit de muur bij de FEBO. Smikkel deze lekker op. Eetsmakelijk allen!",
    rules: "Geen verdere regels/restricties.",
    timerType: "snack"
  },
  27: {
    id: 27,
    type: "Straatvak",
    label: "Kroeg",
    location: "Tierney's Irish Pub",
    popup: "Een Irish Pub met een twist:",
    teamText: "Split allemaal the G. Lukt dit? Klasse! Drink je Guinnessje rustig op. Lukt dit niet in één poging? Bestel nog een extra Baby Guinness voor de kleine speler.",
    rules: "Schuimrand moet tussen de bovenkant- en middenstreepje van de G zitten. Hoeft niet perfect op de middenstreep!",
    timerType: "bar"
  },
  28: {
    id: 28,
    type: "Straatvak",
    label: "Kroeg",
    location: "Café Samson",
    popup: "Samson is altijd trouw naar zijn baasje Gert. Gert is daarnentegen niet altijd even trouw geweest richting zijn vrouw, zoals de affaire met K3-Josje liet blijken. Maar ach, foutje moet kunnen toch! Wees solidair met Gert, en ga of laat iemand vreemdgaan!",
    teamText: "Of bestel 3 alcoholische drankjes die beginnen met een 'K', en drink deze op. Keuze is aan jullie!",
    rules: "Drankjes moeten beginnen met de 'K', en NIET alleen de letter 'K' bevatten:\nKasteel Rouge is akkoord; Heineken telt niet!",
    timerType: "bar"
  },
  29: {
    id: 29,
    type: "Vast speciaal vak",
    label: "Speciaal Vak",
    location: "Elektriciteit",
    popup: "Jullie energielevel is dramatisch laag. De app heeft het gezien en eerlijk gezegd straalt het van jullie af. Tijd om de batterij op een onverantwoorde manier weer op te laden. Maar let op: wie zichzelf oplaadt, mag daarna iemand anders kortsluiting bezorgen.",
    teamText: "Loop naar de dichtstbijzijnde plek waar je Red Bull kunt halen. Koop voor ieder actief teamlid één Red Bull. Ieder actief teamlid shotgunt zijn/haar Red Bull.\n\nPower-up verdienen — Uno Reverse:\nWillen jullie de power-up Uno Reverse verdienen? Dan doet ieder actief teamlid direct daarna ook een adje wodka-Red Bull. Bevestig in de app of jullie alleen de basisopdracht of ook de bonus hebben gedaan.\n\nEffect power-up:\nMet Uno Reverse wijzen jullie één ander actief team aan. Dat team krijgt direct dezelfde bonusopdracht: ieder actief teamlid doet een adje wodka-Red Bull, uit te voeren voordat zij opnieuw mogen gooien.",
    rules: "-",
    timerType: "location",
    bonusPowerUp: {
      label: "Uno Reverse",
      type: "uno_reverse"
    }
  },
  30: {
    id: 30,
    type: "Straatvak",
    label: "Kroeg",
    location: "De Derde Kamer",
    popup: "De Derde Kamer. Dagelijks wordt er in de Eerste- en Tweede Kamer veel gediscusieerd, gedebatteerd en gestemd, maar dat doen we in de Derde Kamer een beeeetje anders…",
    teamText: "Bel een willekeurig team, en vraag of zij voor jullie willen stemmen: Ieder actief teamlid een pilsje, een wit wijntje, of een shotje Limoncello. Geen discussie, geen debat. De meeste stemmen gelden!",
    rules: "Op goed vertrouwen. Het gebelde team bepaalt.",
    timerType: "bar"
  },
  31: {
    id: 31,
    type: "Celstraf",
    label: "Naar de Cel",
    location: "Keizer Karelplein",
    popup: "Jullie zitten in de cel. Wacht 4 minuten.",
    teamText: "Loop nu een volledig rondje over het Keizer Karelplein. Daarna zijn jullie weer vrij!",
    rules: "Het hele rondje moet gefilmd worden!",
    timerType: "location"
  },
  32: {
    id: 32,
    type: "Straatvak",
    label: "Kroeg",
    location: "Dock 17",
    popup: "Een heeeerlijk plekje aan de Waalkade. Maar geen tijd om te genieten, we houden het tempo er in:",
    teamText: "Elke actieve speler kiest in de app een eigen getal tussen de 1 en 17. Daarna onthult de app welk drankje daarbij hoort. Drink de gekozen drankjes.",
    rules: "Gekozen getal = drankje op de kaart. Geen wisselingen onderling.",
    timerType: "bar"
  },
  33: {
    id: 33,
    type: "Straatvak",
    label: "Kroeg",
    location: "Café Van Ouds",
    popup: "We gaan het even lekker doen zoals van ouds: Een ouderwets draaitje aan het rad!",
    teamText: "Open het Rad van Bier en Vertier. Ieder actief teamlid draait één keer aan het rad en bestelt het drankje waar hij/zij op belandt. Drink dit in maximaal 3 slokken op.",
    rules: "Ieder actief teamlid draait één keer aan het rad. Het rad bepaalt.\nMaximaal 3 slokken per drankje.",
    timerType: "bar"
  },
  34: {
    id: 34,
    type: "Algemeen Fonds",
    label: "Algemeen Fonds",
    location: "-",
    popup: "-",
    teamText: "-",
    rules: "-",
    timerType: "none"
  },
  35: {
    id: 35,
    type: "Straatvak",
    label: "Kroeg",
    location: "Café Wunderkammer",
    popup: "'Ons café is gevuld met rariteiten en curiosa die een moderne knipoog vormen naar het rariteitenkabinet van de 17e eeuw.', aldus de website van Café Wunderkammer. Jullie merken het al: Lekker gek!",
    teamText: "Doe eens lekker gek, en bestel voor minimaal twee actieve teamleden een heerlijke Kasteel Cuvée Chateau: Een pilske met jawel, 11%! We blijven lekker gek natuurlijk!!!!",
    rules: "Geen verdere regels/restricties.",
    timerType: "bar"
  },
  36: {
    id: 36,
    type: "Wisselstation",
    label: "Station",
    location: "-",
    popup: "Welkom op Perron Paniek. De trein rijdt niet, de planning klopt niet en iemand anders mag daar nu last van hebben. Jullie krijgen de kans om een ander team compleet uit de dienstregeling te trekken.",
    teamText: "Kies één ander team om mee van positie te wisselen. Jullie wisselen direct van plek op het bord. Het gekozen team raakt de draad volledig kwijt: hun huidige opdracht vervalt, ze krijgen géén nieuwe opdracht op hun nieuwe vakje en ze moeten 3 minuten wachten voordat ze opnieuw mogen gooien. Jullie team mag na de wissel direct opnieuw gooien.",
    rules: "-",
    timerType: "none"
  },
  37: {
    id: 37,
    type: "Kans",
    label: "Kans",
    location: "-",
    popup: "-",
    teamText: "-",
    rules: "-",
    timerType: "none"
  },
  38: {
    id: 38,
    type: "Straatvak",
    label: "Kroeg",
    location: "Café Daen",
    popup: "Wat zijn de meeste hier vaak binnen geweest met de bekerfinale van Ons Eniesee. Dat pissen zorgde onder andere voor een heuze tweede Waal in Nijmegen, en de tranen na het fluitsignaal voor een Waterval...",
    teamText: "Neem allemaal een heerlijk wijntje naar eigen keuze, en Waterval deze met je team: De eerste persoon begint met drinken, de volgende persoon moet al beginnen met drinken voordat deze op is, enzovoorts. Drankje persoon 1 op voordat persoon 2 begint? Waterval begint opnieuw.",
    rules: "Watervallen: Persoon 1 begint met drinken, persoon 2 moet al beginnen met drinken voordat die van persoon 1 op is, enzovoorts. Als het drankje van de persoon voor je al op is, voordat jij begonnen bent, begint de waterval compleet opnieuw.",
    timerType: "bar"
  },
  39: {
    id: 39,
    type: "Vast strafvak",
    label: "Speciaal Vak",
    location: "Zuipbelasting",
    popup: "Gefeliciteerd, jullie zijn officieel aangeslagen door de Zuipbelasting. De Belastingdienst is misschien streng, maar deze variant is vooral dorstig. Betalen kan vandaag niet met geld, alleen met ICE.",
    teamText: "Kies één actief teamlid. Deze persoon drinkt een grote fles ICE leeg. De rest van het team mag aanmoedigen, uitlachen of doen alsof dit een verstandige keuze is. Daarna mogen jullie verder.",
    rules: "-",
    timerType: "bar"
  },
  40: {
    id: 40,
    type: "Straatvak",
    label: "Kroeg",
    location: "De Hemel",
    popup: "Bij de hemel denken we helaas allemaal maar aan één ding.. Gelukkig wordt hij nooit vergeten, is hij altijd in ons hoofd, én zit hij in jullie tasje!!",
    teamText: "Geniet samen met Stijn van een heerlijk klein Weizenbiertje. Maar let op, naast al jullie actieve teamleden lust Stijn er ook gewoon eentje!! Die mogen jullie lekker verdelen onder elkaar. Proost op het Leven lieverds!",
    rules: "Geen verdere regels/restricties.",
    timerType: "bar"
  }
};

export const DOCK17_DRINKS = [
  { id: 1, drink: "Witte wijn" },
  { id: 2, drink: "Tripel biertje" },
  { id: 3, drink: "Shotje sterk" },
  { id: 4, drink: "Pilsje" },
  { id: 5, drink: "Appelsap" },
  { id: 6, drink: "Duvel biertje" },
  { id: 7, drink: "IPA biertje" },
  { id: 8, drink: "Witte wijn" },
  { id: 9, drink: "Radler" },
  { id: 10, drink: "Pilsje" },
  { id: 11, drink: "Pink Lemonade" },
  { id: 12, drink: "Rosé wijn" },
  { id: 13, drink: "Pilsje" },
  { id: 14, drink: "Kriek biertje" },
  { id: 15, drink: "Desperados" },
  { id: 16, drink: "Shotje sterk" },
  { id: 17, drink: "Rode wijn" }
];

export const CAFE_VAN_OUDS_WHEEL_OPTIONS = [
  "Omer",
  "Guinness",
  "Affligem Tripel",
  "Texels Jutter",
  "Delirium Tremens",
  "Brand Weizen",
  "Wisseltap / speciaalbier van de maand",
  "Leffe Blond",
  "Westmalle Dubbel",
  "Affligem Blond",
  "La Chouffe",
  "Duvel",
  "Heineken",
  "Tripel Karmeliet",
  "Affligem Dubbel",
  "Texels Skuumkoppe"
];

export function getTileAssignment(tileId) {
  return TILE_ASSIGNMENTS[tileId] ?? null;
}
