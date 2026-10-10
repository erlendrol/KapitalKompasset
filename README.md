# KapitalKompasset

Norsk sparekalkulator som gir en konkret fordeling mellom aksjer, renter og bank, med graf og PDF. Alt kjører i nettleseren: ingen server, ingen database, ingen informasjonskapsler, og ingenting brukeren skriver sendes noe sted.

- **Forsiden:** seks spørsmål gir en anbefaling, en vekstgraf og en PDF.
- **Dybdeanalyse:** en AI-chat eller et manuelt skjema gir en Monte Carlo-graf med utfallsrom og en PDF.

Arkitektur, modell og fallgruver er beskrevet i [`CONTEXT.md`](CONTEXT.md). Les den før du endrer koden.

## Filer

| Fil | Innhold |
|---|---|
| `index.html` | Hele appen: HTML, CSS og JavaScript |
| `fonts/` | DM Sans og DM Serif Display, servert fra siden selv (SIL OFL-lisens ligger ved) |
| `_headers` | Sikkerhetsregler (Content-Security-Policy m.m.) for Cloudflare Pages |
| `tests/` | Tester som kjører appens kode i Node |
| `.github/workflows/test.yml` | Kjører testene ved hver push og pull request |

Chart.js og jsPDF lastes fra jsDelivr med integritetssjekk (`integrity`-hash). Se `CONTEXT.md` før du bytter versjon.

## Kjøre lokalt

```bash
python3 -m http.server 8000     # og åpne http://localhost:8000
```

Bruk en lokal server i stedet for å åpne `index.html` direkte som fil. Da lastes fontene og PDF-nedlastingen som på den publiserte siden.

## Tester

```bash
npm test
```

Krever Node 20 eller nyere og ingen installasjon. Testene kjøres også automatisk på GitHub for hver push (fanen «Actions»).

## Publisering (Cloudflare Pages)

Første gang:

1. Logg inn på [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
2. Velg repoet `KapitalKompasset` og branch `main`.
3. Byggeinnstillinger: **Framework preset** `None`, **Build command** tomt, **Build output directory** `/`.
4. **Save and Deploy**. Siden får en adresse som `kapitalkompasset.pages.dev`.
5. Eget domene (valgfritt): **Custom domains** → **Set up a custom domain**, og følg instruksjonene for DNS.

Etterpå publiseres hver push til `main` automatisk. Andre brancher får hver sin forhåndsvisningsadresse.

Etter første publisering bør du sjekke at:
- grafene vises og begge PDF-knappene virker, både på PC og mobil
- sikkerhetsreglene er aktive: i nettleserens utviklerverktøy → Network → `index.html` skal svaret ha `content-security-policy`

**GitHub Pages** fungerer også (Settings → Pages → `main` / root), men leser ikke `_headers`. Siden blir da publisert uten sikkerhetsreglene.

### Når du legger til noe fra et annet domene

Content-Security-Policy i `_headers` tillater bare skript fra siden selv og jsDelivr, og fonter, stiler og bilder bare fra siden selv. Legger du til for eksempel besøksstatistikk eller et nytt bibliotek fra et annet domene, må domenet legges inn i `_headers`. Ellers blokkerer nettleseren det.

## Viktig før lansering

Verktøyet gir anbefalinger tilpasset brukerens økonomi. Investeringsrådgivning krever konsesjon i Norge (verdipapirhandelloven), så få det vurdert juridisk før siden gjøres offentlig tilgjengelig.

## Lisenser

Fontene er lisensiert under SIL Open Font License 1.1, se `fonts/OFL-*.txt`.
