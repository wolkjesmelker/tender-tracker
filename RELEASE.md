# TenderTracker — Release-handleiding

## Vereisten

- Node.js 20+, npm
- macOS met Xcode Command Line Tools (`xcode-select --install`)
- Toegang tot de release-server: `https://releases.questric.eu/tendertracker/`

---

## Nieuwe versie uitbrengen (vanuit Cursor)

### Stap 1 — Versienummer verhogen

Open een terminal in `tender-tracker/` en kies het juiste commando:

| Type wijziging | Commando | Voorbeeld |
|---|---|---|
| Bugfix / kleine aanpassing | `npm run release:patch` | 1.0.0 → 1.0.1 |
| Nieuwe functies | `npm run release:minor` | 1.0.0 → 1.1.0 |
| Grote herziening / breaking change | `npm run release:major` | 1.0.0 → 2.0.0 |

Dit commando:
1. Verhoogt automatisch het versienummer in `package.json`
2. Bouwt de volledige Electron-app (renderer + main + preload)
3. Genereert een `.dmg` installatiepakket in `tender-tracker/release/`

### Stap 2 — Bestanden uploaden naar de release-server

Upload de volgende bestanden vanuit `tender-tracker/release/` naar:
`https://releases.questric.eu/tendertracker/`

| Bestand | Omschrijving |
|---|---|
| `TenderTracker-X.Y.Z-mac-x64.dmg` | Installer voor Intel Mac |
| `TenderTracker-X.Y.Z-mac-arm64.dmg` | Installer voor Apple Silicon (M1/M2/M3) |
| `TenderTracker-X.Y.Z-mac-x64.zip` | Zip voor auto-update (Intel) |
| `TenderTracker-X.Y.Z-mac-arm64.zip` | Zip voor auto-update (Apple Silicon) |
| `latest-mac.yml` | **Verplicht** — bevat versienummer en checksums voor auto-update |

> **Belangrijk:** `latest-mac.yml` moet altijd worden geüpload — dit is het bestand dat de draaiende app gebruikt om te controleren of er een update beschikbaar is.

### Stap 3 — Klaar

Gebruikers met een geïnstalleerde versie krijgen binnen 10 seconden na het openen van de app een update-melding te zien.

---

## Hoe de auto-update werkt

```
Gebruiker opent app
    │
    ▼ (na 10 seconden)
App checkt latest-mac.yml op releases.questric.eu
    │
    ├── Geen nieuwe versie → niets
    │
    └── Nieuwe versie gevonden
            │
            ▼
        Update-modal verschijnt
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

## Alleen de DMG bouwen (zonder versie verhogen)

```bash
 run dist:macnpm
```

De DMG staat daarna in `tender-tracker/release/`.

---

## Automatisch publiceren (optioneel)

Als de release-server een write-API of SCP-toegang heeft, kun je instellen dat
`electron-builder` direct publiceert:

```bash
npm run release:publish
```

Dit vereist dat `GH_TOKEN` of een custom publicatie-plugin geconfigureerd is in `electron-builder.yml`.
Zie: https://www.electron.build/configuration/publish
