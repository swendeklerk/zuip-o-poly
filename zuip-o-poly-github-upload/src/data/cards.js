// Kans = chaos en risico. Algemeen Fonds = voordeel en tactiek.
// effectType bepaalt hoe de store de kaart verwerkt:
//   task                  fysieke opdracht, self-confirm of skip met straf
//   move_self             eigen team delta vakjes verplaatsen, nieuw vak direct uitvoeren
//   return_previous_street terug naar vorige straatvak
//   jail_self             direct naar de echte cel
//   bonus_roll            direct extra worp, telt niet als normale beurt
//   saved_powerup         power-up bewaren voor later
//   team_choice_move      ander team kiezen en delta verplaatsen
//   team_choice_wait      ander team kiezen, opdracht vervalt, wachttimer
//   swap_positions        ander team kiezen en van positie wisselen (geen wachttijd)

const CHANCE_CARDS = [
  {
    id: "chance-bank-kijkt-mee",
    title: "De Bank kijkt mee",
    body:
      "Er wordt door De Bank even stiekem meegekeken. Helaas voor jullie vindt De Bank dat jullie iets te makkelijk over het bord wandelen, en houdt het wel van een beetje naaien op zijn tijd. Even terug de chaos in!\n\nEffect: ga 3 vakjes achteruit. Voer het nieuwe vakje direct uit.",
    effectType: "move_self",
    delta: -3
  },
  {
    id: "chance-verkeerde-afslag",
    title: "Verkeerde Afslag",
    body:
      "Jullie hadden één taak: gewoon normaal de route volgen. Maar nee hoor, ergens tussen zelfvertrouwen en slechte oriëntatie is het weer misgegaan. Jullie zijn verkeerd gelopen, verkeerd gegooid of gewoon weer eens veel te overtuigd van jezelf. Hoe dan ook: dit wordt jullie eigen probleem.\n\nEffect: jullie team wordt 4 vakjes vooruit gezet en voert het nieuwe vakje direct uit.",
    effectType: "move_self",
    delta: 4
  },
  {
    id: "chance-blind-vertrouwen",
    title: "Blind Vertrouwen",
    body:
      "Jullie zicht is tijdelijk uitgeschakeld. Vanaf nu moeten jullie het doen met vertrouwen, communicatie en waarschijnlijk veel te veel geschreeuw. Eén teamlid krijgt de blinddoek om en mag bewijzen dat blind vertrouwen in dit team totaal onverstandig is. De rest van het team begeleidt deze persoon naar de bar en laat hem of haar bestellen. Pas bij de bar mag de blinddoek even af. Bestel een drankje naar keuze. Daarna gaat de blinddoek opnieuw om en neemt dezelfde persoon geblinddoekt een flinke slok van het drankje.",
    effectType: "task",
    timerType: "bar"
  },
  {
    id: "chance-jij-bent-m",
    title: "Jij Bent 'm",
    body:
      "Soms hoef je geen goede reden te hebben om iemand te naaien. Soms is het genoeg dat de app zegt dat het mag. Dus bij deze: jullie krijgen nu de macht om één team volledig uit hun flow te trekken. Pech voor hen, heerlijk voor jullie.\n\nEffect: kies een ander team. Dat team stopt direct met de huidige opdracht. De opdracht vervalt en dat team moet 3 minuten wachten voordat ze opnieuw mogen gooien.",
    effectType: "team_choice_wait",
    waitSeconds: 180
  },
  {
    id: "chance-retour-afzender",
    title: "Retour Afzender",
    body:
      "Jullie dachten lekker door te pakken, maar het bord is het daar niet mee eens. Soms moet je even terug naar waar het allemaal misging. En in jullie geval was dat waarschijnlijk vrij recent.\n\nEffect: ga terug naar het vorige straatvak waar jullie op stonden. Voer dat vakje opnieuw uit.",
    effectType: "return_previous_street"
  },
  {
    id: "chance-dorstige-douane",
    title: "Dorstige Douane",
    body:
      "Ho, stop. Jullie mogen niet zomaar door. De Dorstige Douane heeft jullie staande gehouden en wil eerst even controleren of jullie nog wel geschikt zijn voor verder vervoer. Ieder actief teamlid moet 1 minuut op één been blijven staan. Tijdens deze minuut zegt ieder teamlid om de beurt: \"Ik ben volledig nuchter en betrouwbaar.\" Valt iemand om, raakt iemand met de tweede voet de grond of vergeet iemand de zin, dan begint de opdracht opnieuw.",
    effectType: "task",
    timerType: "short"
  },
  {
    id: "chance-wie-niet-weg-is",
    title: "Wie Niet Weg Is...",
    body:
      "Jullie mogen iemand flink irriteren. Niet omdat het eerlijk is, niet omdat het nodig is, maar gewoon omdat het kan. Kies een team en geef ze een klein duwtje de verkeerde kant op.\n\nEffect: kies een ander team. Dat team gaat 2 vakjes achteruit en voert het nieuwe vakje direct uit.",
    effectType: "team_choice_move",
    delta: -2
  },
  {
    id: "chance-direct-naar-de-cel",
    title: "Direct Naar De Cel",
    body:
      "Geen discussie. Geen uitleg. Geen hoger beroep. Jullie gedrag is beoordeeld en de conclusie is duidelijk: dit team moet even achter slot en grendel. Succes met de wandeling straks!\n\nEffect: ga direct naar de cel. Wacht 7 minuten. Daarna verschijnt de strafopdracht.",
    effectType: "jail_self"
  }
];

const FUND_CARDS = [
  {
    id: "fund-rondje-van-de-zaak",
    title: "Rondje Van De Zaak",
    body:
      "Kijk eens aan. Eindelijk zit het een keer mee. Geen gezeik, geen straf, geen omweg, gewoon een klein cadeautje van het bord. Pak dat voordeel en doe alsof jullie het verdiend hebben.\n\nEffect: jullie mogen direct opnieuw gooien. Deze bonusworp telt niet mee als normale dobbelbeurt.",
    effectType: "bonus_roll"
  },
  {
    id: "fund-tjarda-de-spelleider",
    title: "Tjarda de Spelleider",
    body:
      "Jullie hebben geluk. Tjarda is vandaag de spelleider en ziet blijkbaar precies genoeg om dit volledig door de vingers te zien. Vervelende opdracht voor de boeg? Niemand die het merkt. Bewijs? Niet nodig. Gewoon doorlopen alsof er niks gebeurd is.\n\nEffect: bewaar deze kaart. Jullie mogen deze één keer inzetten om een opdracht over te slaan. Na inzetten mogen jullie direct opnieuw gooien. Deze bonusworp telt niet mee als normale dobbelbeurt.",
    effectType: "saved_powerup",
    powerUpLabel: "Opdracht overslaan",
    savedPowerUpType: "skip_task"
  },
  {
    id: "fund-geluksvogel",
    title: "Geluksvogel",
    body:
      "Vandaag lijken de biergoden aan jullie kant te staan. De eerstvolgende keer dat een ander team jullie probeert te naaien, draait het plan volledig om en zijn zij zelf de pineut.\n\nEffect: bewaar deze kaart. Jullie mogen deze één keer inzetten wanneer een ander team jullie kiest voor een Kans-, Algemeen Fonds-, Wisselstation- of bonusactie. De actie wordt geblokkeerd en het andere team moet een ander team kiezen.",
    effectType: "saved_powerup",
    powerUpLabel: "Geluksvogel",
    savedPowerUpType: "shield"
  },
  {
    id: "fund-kleine-correctie",
    title: "Kleine Correctie",
    body:
      "De Bank heeft even naar jullie gekeken en dacht: ach, deze stumpers kunnen wel wat hulp gebruiken. Geen grote overwinning, geen heldendaad, gewoon een kleine correctie in jullie voordeel.\n\nEffect: ga 2 vakjes vooruit. Voer het nieuwe vakje direct uit.",
    effectType: "move_self",
    delta: 2
  },
  {
    id: "fund-vriendendienst",
    title: "Vriendendienst",
    body:
      "Jullie mogen heel even aardig zijn. Of irritant aardig, dat mag natuurlijk ook. Geef een ander team een duwtje vooruit en hoop vooral dat ze op een verschrikkelijk vakje terechtkomen.\n\nEffect: kies een ander team. Dat team gaat 2 vakjes vooruit en voert het nieuwe vakje direct uit.",
    effectType: "team_choice_move",
    delta: 2
  },
  {
    id: "fund-celvrij-kaart",
    title: "Celvrij Kaart",
    body:
      "Deze kaart bewaar je tot het moment dat het echt misgaat. Zit je straks in de cel en moet je eigenlijk wachten en een kutrondje om het Keizer Karelplein lopen? Niet vandaag. Jullie trekken deze kaart en lopen gewoon door alsof er niks aan de hand is.\n\nEffect: bewaar deze kaart. Als jullie later in de echte cel komen, mogen jullie één keer direct uit de cel zonder wachttijd en zonder Keizer Karelplein-opdracht.",
    effectType: "saved_powerup",
    powerUpLabel: "Celvrij",
    savedPowerUpType: "jail_free"
  },
  {
    id: "fund-wisseltruc",
    title: "Wisseltruc",
    body:
      "Even schuiven met de ellende. Jullie hoeven niet hard te lopen, jullie hoeven niet slim te zijn, jullie hoeven alleen iemand anders strategisch onhandig neer te zetten. Bordspelletje, toch?\n\nEffect: kies een ander team en wissel van positie. Anders dan bij Wisselstation krijgt het gekozen team géén wachttijd. Beide teams voeren direct het nieuwe vakje uit.",
    effectType: "swap_positions"
  },
  {
    id: "fund-zuipmaatjes",
    title: "Zuipmaatjes",
    body:
      "Er zijn weinig dingen zeker in het leven, maar zuipen in je eentje is toch wel een beetje triest... Jullie hebben geluk! De eerstvolgende opdracht mogen jullie samen doen met een willekeurig team. Zij moeten exact dezelfde drankjes en hoeveelheden drinken als jullie! (Tip: bel het team op!)\n\nEffect: bewaar deze kaart. Jullie mogen deze één keer inzetten tijdens jullie eerstvolgende opdracht. Kies dan een ander team: dat team voert direct dezelfde opdracht uit als jullie.",
    effectType: "saved_powerup",
    powerUpLabel: "Zuipmaatjes",
    savedPowerUpType: "share_task"
  }
];

export const CARD_DECKS = {
  chance: CHANCE_CARDS,
  fund: FUND_CARDS
};

export function drawCard(type) {
  const deck = CARD_DECKS[type] ?? CARD_DECKS.chance;
  return deck[Math.floor(Math.random() * deck.length)];
}
