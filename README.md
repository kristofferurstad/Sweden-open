# Frisbeegolf – live turneringstavle

En komplett, gratis-hostbar webapp for en privat frisbeegolfturnering. Ingen backend, ingen innlogging – kun HTML, CSS og JavaScript.

## Filene

```
index.html   – struktur og alle faner (Oversikt, Leaderboard, Runder, Neste runde, Admin)
style.css    – design (fairway-grønn/disc-oransje, responsiv, mørk/lys modus, utskrift)
app.js       – all logikk: lagring, beregninger, rendering, admin-handlinger
data.json    – "publisert" tilstand som lastes av alle besøkende (se under)
```

## Viktig å forstå: hvordan "live" fungerer uten server

Appen har ingen database. Alt skjer i nettleseren via **Local Storage**, og du sa selv at det er greit siden det kun er du som legger inn data. Konsekvensen er:

- **Din egen enhet** husker alt du legger inn automatisk mellom øktene (ingenting forsvinner ved refresh).
- **Andre deltakeres enheter** har sin egen, tomme Local Storage. De kan derfor ikke se dine endringer i sanntid – det finnes ingen server som sender data mellom telefoner.

Løsningen appen bruker: filen **`data.json`** er den "offentlige" tilstanden som lastes av alle som åpner lenken for første gang. Når du som admin har lagt inn resultater:

1. Gå til **Admin → Data → "Eksporter til JSON"**. Dette laster ned en oppdatert `data.json`.
2. Erstatt `data.json` i prosjektet ditt (last opp filen på GitHub, eller dra den inn i Netlify).
3. Nettsiden oppdateres automatisk (GitHub Pages/Netlify redeployer på sekunder), og alle som åpner lenken på nytt ser de ferdige resultatene.

Appen sjekker automatisk om `data.json` er nyere enn det som ligger lokalt i den enkelte nettleseren, så gamle telefoner som allerede har besøkt siden får også med seg oppdateringen.

**Praktisk tips under selve turneringen:** eksporter og publiser `data.json` på nytt etter hver runde, så følger alle live-tavlen fra runde til runde.

## Kom i gang

1. Åpne **Admin**-fanen.
2. Legg inn turneringsnavn og dato under "Turnering".
3. Legg til spillere under "Spillere".
4. Legg til baner under "Baner".
5. Under "Runder & score": velg bane og trykk "Legg til runde". Skriv inn score for hver spiller etter hvert som runden spilles. Huk av "Runden er fullført" når den er ferdig.
6. Sjekk **Leaderboard** og **Neste runde** – kortoppsettet genereres automatisk basert på sammenlagtstillingen.
7. Eksporter `data.json` og publiser (se over) for å dele resultatene med deltakerne.

## Publisere på GitHub Pages

1. Opprett et nytt repository og last opp alle filene i denne mappen (`index.html`, `style.css`, `app.js`, `data.json`).
2. Gå til **Settings → Pages**, velg branch `main` og mappe `/root`.
3. Del lenken GitHub gir deg (f.eks. `https://brukernavn.github.io/repo-navn/`) med deltakerne.
4. Hver gang du vil publisere nye resultater: last opp en ny `data.json` (erstatt den gamle) og commit.

## Publisere på Netlify

1. Dra hele mappen inn på [app.netlify.com/drop](https://app.netlify.com/drop), eller koble til et Git-repo.
2. Del lenken Netlify gir deg.
3. For å publisere nye resultater: dra inn mappen på nytt (drag-and-drop-metoden), eller push en ny commit om du bruker Git-integrasjon.

## Andre funksjoner

- **Skriv ut / PDF**: knappen på Leaderboard-fanen åpner nettleserens utskriftsdialog med en ren versjon av tabellen – velg "Lagre som PDF".
- **Mørk/lys modus**: bytt med sol/måne-knappen øverst til høyre.
- **Importer JSON**: under Admin → Data kan du laste inn en tidligere eksportert fil, f.eks. for å gjenopprette data på en annen enhet.
- **Nullstill turnering**: sletter alle spillere, baner og runder (ber om bekreftelse først).
