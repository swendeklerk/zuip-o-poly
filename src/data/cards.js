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
//   bank_verdict          de app bepaalt direct schuld of meevaller

const CHANCE_CARDS = [
  {
    id: "chance-stijn-kijkt-mee",
    title: "Stijn kijkt mee",
    body:
      "Er wordt van boven even meegekeken. En als er iemand wist hoe je een avond moest verlengen, versnellen en volledig uit de hand laten lopen, dan was het Stijn wel. Helaas voor jullie vindt hij dat jullie iets te makkelijk door het bord wandelen, en hield hij van een beetje naaien op zijn tijd. Even terug de chaos in!\n\nEffect: ga 3 vakjes achteruit. Voer het nieuwe vakje direct uit.",
    effectType: "move_self",
    delta: -3
  },
  {
    id: "chance-verkeerde-afslag",
    title: "Verkeerde Afslag",
    body:
      "Jullie hadden een taak: gewoon normaal de route volgen. Maar nee hoor, ergens tussen zelfvertrouwen en slechte orientatie is het weer misgegaan. Hoe dan ook: dit wordt jullie eigen probleem.\n\nEffect: jullie team wordt 4 vakjes vooruit gezet en voert het nieuwe vakje direct uit.",
    effectType: "move_self",
    delta: 4
  },
  {
    id: "chance-blind-vertrouwen",
    title: "Blind Vertrouwen",
    body:
      "Jullie zicht is tijdelijk uitgeschakeld. Een actief teamlid krijgt de blinddoek om. De rest begeleidt deze persoon naar de bar en laat hem of haar bestellen. Bij de bar mag de blinddoek even af. Daarna gaat de blinddoek opnieuw om en neemt dezelfde persoon geblinddoekt een flinke slok van het drankje.",
    effectType: "task",
    timerType: "bar"
  },
  {
    id: "chance-jij-bent-m",
    title: "Jij Bent 'm",
    body:
      "Soms hoef je geen goede reden te hebben om iemand te naaien. Soms is het genoeg dat de app zegt dat het mag.\n\nEffect: kies een ander team. Dat team stopt direct met de huidige opdracht. De opdracht vervalt en dat team moet 3 minuten wachten voordat ze opnieuw mogen gooien.",
    effectType: "team_choice_wait",
    waitSeconds: 180
  },
  {
    id: "chance-retour-afzender",
    title: "Retour Afzender",
    body:
      "Jullie dachten lekker door te pakken, maar het bord is het daar niet mee eens. Soms moet je even terug naar waar het allemaal misging.\n\nEffect: ga terug naar het vorige straatvak waar jullie op stonden. Voer dat vakje opnieuw uit.",
    effectType: "return_previous_street"
  },
  {
    id: "chance-dorstige-douane",
    title: "Dorstige Douane",
    body:
      "Ho, stop. De Dorstige Douane heeft jullie staande gehouden. Ieder actief teamlid moet 1 minuut op een been blijven staan. Tijdens deze minuut zegt ieder teamlid om de beurt: \"Ik ben volledig nuchter en betrouwbaar.\" Valt iemand om, raakt iemand met de tweede voet de grond of vergeet iemand de zin, dan begint de opdracht opnieuw.",
    effectType: "task",
    timerType: "short"
  },
  {
    id: "chance-wie-niet-weg-is",
    title: "Wie Niet Weg Is...",
    body:
      "Jullie mogen iemand flink irriteren. Niet omdat het eerlijk is, niet omdat het nodig is, maar gewoon omdat het kan.\n\nEffect: kies een ander team. Dat team gaat 2 vakjes achteruit en voert het nieuwe vakje direct uit.",
    effectType: "team_choice_move",
    delta: -2
  },
  {
    id: "chance-direct-naar-de-cel",
    title: "Direct Naar De Cel",
    body:
      "Geen discussie. Geen uitleg. Geen hoger beroep. Jullie gedrag is beoordeeld en de conclusie is duidelijk: dit team moet even achter slot en grendel.\n\nEffect: ga direct naar de cel. Wacht 4 minuten. Daarna verschijnt de strafopdracht.",
    effectType: "jail_self"
  }
];

const FUND_CARDS = [
  {
    id: "fund-op-gesprek-bij-de-bank",
    title: "Op gesprek bij de Bank",
    popup:
      "Oei! Een gesprek bij de bank kan natuurlijk heel goed uitpakken, maar ook heel slecht...",
    body:
      "Er is iets opgedoken in de administratie van Zuip-O-Poly... De Bank heeft jullie dossier geopend en onderzoekt of er nog een alcoholschuld openstaat, of dat er juist een alcoholische meevaller is gevonden.\n\nDe app doet direct uitspraak. De uitspraak van De Bank is definitief.",
    effectType: "bank_verdict",
    verdicts: [
      {
        id: "schuld",
        title: "Alcoholschuld gevonden",
        body:
          "De Bank heeft een openstaande alcoholschuld gevonden. Aflossen, nu. Ieder actief teamlid neemt een shotje naar keuze. Geen shotjes in de buurt? Dan telt een adtje ook.",
        timerType: "bar"
      },
      {
        id: "meevaller",
        title: "Alcoholische meevaller",
        body:
          "De Bank heeft een alcoholische meevaller gevonden! Kies een ander team, bel ze op en deel een drankje uit aan ieder actief teamlid van dat team. Zij drinken, jullie genieten.",
        timerType: "bar"
      }
    ],
    oncePerTeam: true
  },
  {
    id: "fund-rondje-van-de-zaak",
    title: "Rondje Van De Zaak",
    body:
      "Kijk eens aan. Eindelijk zit het een keer mee. Geen gezeik, geen straf, geen omweg, gewoon een klein cadeautje van het bord.\n\nEffect: jullie mogen direct opnieuw gooien. Deze bonusworp telt niet mee als normale dobbelbeurt.",
    effectType: "bonus_roll"
  },
  {
    id: "fund-tjarda-de-spelleider",
    title: "Tjarda de Spelleider",
    body:
      "Jullie hebben geluk. Tjarda is vandaag de spelleider en ziet blijkbaar precies genoeg om dit volledig door de vingers te zien.\n\nEffect: bewaar deze kaart. Jullie mogen deze een keer inzetten om een opdracht over te slaan zonder straf. Na inzetten mogen jullie direct opnieuw gooien. Deze bonusworp telt niet mee als normale dobbelbeurt.",
    effectType: "saved_powerup",
    powerUpLabel: "Opdracht overslaan",
    savedPowerUpType: "skip_task"
  },
  {
    id: "fund-hong-beschermt",
    title: "Hong Beschermt",
    body:
      "Er hangt tijdelijk iets boven jullie hoofd. Geen idee wat precies, maar het voelt verdacht veel als Hong die van boven even meeblokt.\n\nEffect: bewaar deze kaart. De eerstvolgende keer dat een ander team jullie probeert te naaien, wordt die actie automatisch geblokkeerd.",
    effectType: "saved_powerup",
    powerUpLabel: "Hong Beschermt",
    savedPowerUpType: "shield"
  },
  {
    id: "fund-kleine-correctie",
    title: "Kleine Correctie",
    body:
      "Het bord heeft even naar jullie gekeken en dacht: ach, deze stumpers kunnen wel wat hulp gebruiken.\n\nEffect: ga 2 vakjes vooruit. Voer het nieuwe vakje direct uit.",
    effectType: "move_self",
    delta: 2
  },
  {
    id: "fund-vriendendienst",
    title: "Vriendendienst",
    body:
      "Jullie mogen heel even aardig zijn. Of irritant aardig, dat mag natuurlijk ook.\n\nEffect: kies een ander team. Dat team gaat 2 vakjes vooruit en voert het nieuwe vakje direct uit.",
    effectType: "team_choice_move",
    delta: 2
  },
  {
    id: "fund-celvrij-kaart",
    title: "Celvrij Kaart",
    body:
      "Deze kaart bewaar je tot het moment dat het echt misgaat. Zit je straks in de cel? Niet vandaag.\n\nEffect: bewaar deze kaart. Als jullie later in de echte cel komen, mogen jullie een keer direct uit de cel zonder wachttijd en zonder strafopdracht.",
    effectType: "saved_powerup",
    powerUpLabel: "Celvrij",
    savedPowerUpType: "jail_free"
  },
  {
    id: "fund-wisseltruc",
    title: "Wisseltruc",
    body:
      "Even schuiven met de ellende. Bordspelletje, toch?\n\nEffect: kies een ander team en wissel van positie. Anders dan bij Wisselstation krijgt het gekozen team geen wachttijd. Beide teams voeren direct het nieuwe vakje uit.",
    effectType: "swap_positions"
  },
  {
    id: "fund-vrijbrief-van-het-bord",
    title: "Vrijbrief van het Bord",
    body:
      "Het bord is streng, maar vandaag heeft het een zwak moment. Jullie krijgen zwart op wit een officiële vrijbrief.\n\nEffect: bewaar deze kaart. Jullie mogen één keer een opdracht skippen zonder de 2-vakjes-straf.",
    effectType: "saved_powerup",
    powerUpLabel: "Gratis skip",
    savedPowerUpType: "skip_free"
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
