# TenderTracker — Release-handleiding

## Vereisten

- Node.js 20+, npm
- Git-toegang tot `https://github.com/wolkjesmelker/tender-tracker`
- Geen server, geen handmatige uploads — GitHub doet het automatisch ✓

---

## Nieuwe versie uitbrengen vanuit Cursor

Open een terminal in de map `tender-tracker/` en kies het juiste commando:

| Type wijziging | Commando | Voorbeeld |
|---|---|---|
| Bugfix / kleine aanpassing | `npm run release:patch` | 1.0.0 → 1.0.1 |
| Nieuwe functies | `npm run release:minor` | 1.0.0 → 1.1.0 |
| Grote herziening / breaking change | `npm run release:major` | 1.0.0 → 2.0.0 |

**Wat er automatisch gebeurt:**

1. Versienummer verhoogd in `package.json`
2. Commit aangemaakt met bericht `chore: release vX.Y.Z`
3. Versie-tag gepusht naar GitHub (`vX.Y.Z`)
4. **GitHub Actions** pikt de tag op en bouwt macOS + Windows installers
5. GitHub Release aangemaakt met alle bestanden
6. Gebruikers zien de update-melding binnen 10 seconden na het openen van de app

Voortgang bekijken: **https://github.com/wolkjesmelker/tender-tracker/actions**

---

## Hoe de auto-update werkt

```
Gebruiker opent app
    │
    ▼ (na 10 seconden)
App checkt GitHub Releases (latest-mac.yml / latest.yml)
    │
    ├── Geen nieuwe versie → niets
    │
    └── Nieuwe versie gevonden
            │
            ▼
        Update-modal verschijnt (in de app)
            │
            ▼
        Gebruiker klikt "Downloaden & installeren"
            │
            ▼
        Download op achtergrond (voortgangsbalk)
            │
            ▼
        "Nu herstarten en installeren"-knop verschijnt
            │
            ▼
        App herstart → nieuwe versie actief
        Data in ~/Library/Application Support/tender-tracker/ ongewijzigd ✓
```

---

## Locatie gebruikersdata

De database en instellingen staan **buiten** de app:

```
~/Library/Application Support/tender-tracker/
├── tender-tracker.db   ← alle aanbestedingen, scores, analyses
└── logs/               ← electron-log bestanden
```

Deze map wordt **nooit** overschreven door een update — data is altijd veilig.

---

## Alleen lokaal bouwen (zonder release)

```bash
npm run dist:mac     # macOS DMG in tender-tracker/release/
npm run dist:win     # Windows installer in tender-tracker/release/
```

---

## GitHub Actions instellen (eenmalig)

De workflow gebruikt `GITHUB_TOKEN` dat automatisch beschikbaar is in GitHub Actions — geen extra secrets nodig.

Optioneel, voor macOS code-signing (verwijdert Gatekeeper-waarschuwing):
1. Zet `CSC_LINK` (base64-gecodeerd .p12-certificaat) als GitHub-secret
2. Zet `CSC_KEY_PASSWORD` als GitHub-secret
3. De workflow pikt ze automatisch op

Zonder code-signing: gebruikers kiezen rechtermuisknop → **Openen** bij de eerste start.
