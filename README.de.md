<div align="center">

<img src="assets/brand/zelyq-banner.png" alt="Zelyq: build, automate and ship software with AI" width="100%" />

[English](./README.md) · [Français](./README.fr.md) · **Deutsch** · [Español](./README.es.md) · [Português](./README.pt-BR.md) · [简体中文](./README.zh-CN.md) · [हिन्दी](./README.hi.md) · [Italiano](./README.it.md) · [日本語](./README.ja.md)

### Die Open-Source-Plattform, um Software zu bauen, abzusichern, auszuliefern und zu betreiben, an einem Ort.

Baue Apps mit einem KI-Agenten, der wie ein Ingenieur arbeitet. Bewahre jedes Zugangsdatum in einem verschlüsselten Tresor auf.
Teste und deploye auf deinen eigenen Maschinen und lass einen KI-DevOps-Engineer auf das aufpassen, was läuft.
**Selbst gehostet oder gehostet. Dein eigenes Modell. Keine Telemetrie.**

[![CI](https://github.com/CrowPus/Zelyq/actions/workflows/ci.yml/badge.svg)](https://github.com/CrowPus/Zelyq/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520.12-brightgreen.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)](./tsconfig.base.json)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-black.svg)](./CONTRIBUTING.md)

**[Website](https://zelyq.dev)** · **[Online ausprobieren](https://app.zelyq.dev)** · [Schnellstart](#schnellstart) ·
[Tutorial](./docs/tutorial.md) · [Dokumentation](./docs/README.md) · [Selbst hosten](./docs/self-hosting.md) ·
[Architektur](./docs/architecture.md) · [Roadmap](./docs/roadmap.md) · [Mitmachen](./CONTRIBUTING.md)

</div>

---

## Inhalt

- [Warum Zelyq](#warum-zelyq)
- [Die Plattform](#die-plattform): [Apps](#apps), [Studio](#studio), [Agenten](#agenten), [Vault](#vault),
  [Pipelines](#pipelines), [Deployments](#deployments), [Ops](#ops)
- [Teams, Tarife und Sprachen](#teams-tarife-und-sprachen)
- [Schnellstart](#schnellstart) und [Aktualisieren](#aktualisieren)
- [Dein eigenes Modell](#dein-eigenes-modell)
- [So funktioniert es](#so-funktioniert-es)
- [Sicherheit](#sicherheit) · [Stand](#stand) · [Mitmachen](#mitmachen) · [Lizenz](#lizenz)

---

## Warum Zelyq

Software auszuliefern braucht meist mehrere Produkte: einen KI-App-Builder, einen Secrets-Manager,
einen CI-Dienst, ein Deploy-Werkzeug und jemanden in Rufbereitschaft. Das heißt mehrere Logins,
mehrere Rechnungen und mehrere Stellen, an denen ein Schlüssel durchsickern kann. Zelyq bringt den
ganzen Weg in eine Plattform, geordnet so, wie die Arbeit tatsächlich abläuft:

| | Modul | Was es tut |
| --- | --- | --- |
| **Bauen** | **[Apps](#apps)** | Beschreib eine App. Ein Agent plant sie, baut sie in echten Dateien, die dir gehören, und prüft sie, bevor er sie fertig meldet |
| | **[Studio](#studio)** | Bilder und Videos erzeugen, für deine Apps oder für sich |
| | **[Agenten](#agenten)** | Lass Claude Code, Cursor, VS Code, Gemini CLI oder jeden MCP-Client in Zelyq arbeiten, mit seinem eigenen Modell |
| **Schützen** | **[Vault](#vault)** | Jedes Zugangsdatum einmal gespeichert, verschlüsselt, versioniert und protokolliert, genutzt von Apps, Pipelines und deinen eigenen Servern |
| **Ausliefern** | **[Pipelines](#pipelines)** | Jedes Mal gleich testen und bauen, auf dem Zelyq-Server oder deinen eigenen Linux-, macOS- und Windows-Maschinen |
| | **[Deployments](#deployments)** | Apps je Umgebung auf deine Maschinen bringen, mit Freigaben, Einfrieren und automatischem Zurückrollen |
| | **[Ops](#ops)** | Ein KI-DevOps-Engineer zum Ansprechen: Er plant, wartet auf dein Okay, belegt jede Änderung und behält im Blick, was läuft |

Alles gehört zu einem **Team**. Lade Leute ein, gib jeder Person eine Rolle, und jedes Modul hält
sich daran.

---

## Die Plattform

### Apps

Beschreib, was du willst. Der Agent liest, plant, schreibt Dateien, führt Befehle aus und startet
eine Live-Vorschau. Du siehst jeden Werkzeugaufruf und jede Datei, die er anfasst, während er
arbeitet.

- **Geprüft, nicht nur erzeugt.** Wenn der Agent fertig ist, führt Zelyq den Typecheck oder Build
  des Projekts aus und prüft die Vorschau auf Abstürze. Ein Durchgang, der etwas kaputt gemacht hat,
  geht zum Reparieren zurück an den Agenten, statt als fertig gemeldet zu werden.
- **Klar darüber, was er weiß.** Der *Engineer-Modus* trennt Geprüftes von Angenommenem, nennt die
  Alternative, die er nicht gewählt hat, und fragt vor allem, was sich nicht rückgängig machen lässt.
- **Er plant, bevor er baut.** Der *Architect-Modus* macht aus einer Anfrage einen Entwurf, den du
  prüfen kannst (Anforderungen, Entscheidungen, Datenmodell, API, Bauplan), und wartet auf dein
  Okay. Der *Auto-Modus* setzt den Plan danach selbst um, bis zu einer festen Grenze.
- **Spezialisten auf Abruf.** Ein Designer (`DESIGN.md`), ein DevOps-Engineer (CI, Dockerfile,
  Deploy-Konfiguration), ein Security/QA-Engineer (Tests und Sicherheitsscan) und ein
  Cinematic-Engineer (Seiten, die sich beim Scrollen bewegen).
- **Full Stack.** React + Vite, React mit Python-Backend (FastAPI) oder Expo React Native, jeweils
  mit einem Designsystem. Supabase Postgres mit Row-Level-Security für jede Operation.
- **Mit Bestehendem starten.** Ein GitHub-Repository importieren, eine Live-Website mit
  `/clone <url>` nachbauen oder mit `/figma <link>` aus einem Figma-Frame und seinen Design-Tokens
  bauen.
- **Jeder Durchgang lässt sich rückgängig machen.** Vor jedem Durchgang ein Snapshot, ein genauer
  Diff der Änderungen und Zurücksetzen per Klick. Projekte sind normale Dateien auf der Platte, die
  du mitnehmen kannst.

Siehe [Modi](./docs/modes.md) und [wie sich der Agent verhält](./docs/agent-behaviour.md).

### Studio

- **Bild**: OpenAI, Google oder xAI, mit Referenzbildern und privater Bibliothek.
- **Video**: Google Veo oder xAI, aus Text oder aus einem Standbild.

Studio nutzt deine eigenen Anbieter-Schlüssel, abgerechnet über dein eigenes Konto. Schalte es für
ein Projekt ein, und der Agent kann Bildmaterial und Videos für die App erstellen, die er baut,
innerhalb der Grenzen, die du setzt. Clips lassen sich in Bildfolgen für Scroll-Animationen
zerlegen. Siehe [Studio: Bild](./docs/Image-gen/implementation.md) und
[Studio: Video](./docs/Video-gen/README.md).

### Agenten

Bring das KI-Werkzeug mit, das du schon nutzt. Ein **Agent** lässt Claude Code, Cursor, VS Code,
Gemini CLI, ChatGPT oder jeden MCP-Client mit eigenem Modell und eigenem Abo in Zelyq arbeiten.
Zelyq gibt ihm nur Zugriff auf die Apps, Pipelines und Umgebungen, die du auswählst.

- **Rechte einzeln einstellbar**: Aus, Erlaubt oder Freigabe nötig, für Code lesen und schreiben,
  Befehle ausführen, Pushen, Pipelines, Deployments, Studio und mehr.
- **Was zählt, gibt eine Person frei.** Pushes, Pipeline-Läufe und Änderungen an Deployments sind
  Anfragen, die im Posteingang warten.
- **Sicher rückgängig zu machen.** Bevor der Agent eine App ändert, wird ein Wiederherstellungspunkt
  angelegt.
- **Geheime Werte werden nie gezeigt.** Der Agent sieht, welche Secrets eine App bekommt, nur mit
  Namen.

Siehe [Agenten](./docs/agents.md).

### Vault

Speichere jedes Zugangsdatum **einmal** und nutze es überall, ohne es in eine Datei zu kopieren.

- **Verschlüsselt gespeichert** (AES-256-GCM), mit **Versionsverlauf**, einer Markierung
  **Geschützt** für Live-Schlüssel und einem Protokoll jeder Anzeige und Änderung.
- **Per Verweis genutzt.** App-Variablen, Modellschlüssel, Pipelines und Umgebungen verweisen auf
  `vault://NAME`. Der Wert wird nur dort und dann eingesetzt, wo er gebraucht wird.
- **In Logs maskiert.** Ein Secret, das in einem Pipeline-Log landet, erscheint als `***`.
- **Auch für deine eigenen Server.** Hol Secrets mit einem eingeschränkten Service-Schlüssel, oder
  starte mit `zelyq vault run -- <befehl>` einen Prozess damit, ohne etwas auf die Platte zu
  schreiben.
- **Umziehen per `.env`-Import.**

Siehe [Vault](./docs/vault.md).

### Pipelines

Eine Pipeline ist eine kurze YAML-Datei oder ein Bild, das du per Klick bearbeitest. Stages laufen
nacheinander, Schritte laufen nacheinander, und jeder Schritt ist ein Befehl oder ein fertiger
Baustein.

```yaml
name: Shop
runs-on: local                      # the Zelyq server, or one of your machines
source: { app: Shop }
stages:
  - name: Test
    matrix: { node: [20, 22] }      # one copy per version, at the same time
    steps:
      - checkout: true
      - setup: node@${{ matrix.node }}
      - run: npm ci && npm test
        tests: reports/*.xml        # JUnit: passed / failed on the step
  - name: Deploy
    steps:
      - deploy: { to: production, port: 3000 }
```

- **Läuft, wo du willst.** In einem Wegwerf-Container auf dem Zelyq-Server oder auf deinen eigenen
  **Linux-, macOS- und Windows**-Maschinen. Eine Maschine kommt mit einem Installationsbefehl dazu
  und verbindet sich per HTTPS nach außen zu Zelyq, ganz ohne offene Ports. Maschinen per SSH werden
  ebenfalls unterstützt.
- **Schnell und flexibel.** Gleichzeitige Stages, je Stage eine andere Maschine, Matrix-Builds und
  Vorlagen, die sich Pipelines teilen.
- **Plugins.** Pack einen Schritt einmal, mit Eingaben, Secrets aus dem Vault und Ausgaben, und nutze
  ihn in jeder Pipeline. Siehe [Pipeline-Plugins](./docs/pipeline-plugins.md).
- **Von allem gestartet.** Von Hand, durch einen Git-Push (mit Pfadfiltern), einen Pull Request,
  einen Zeitplan, das Ende einer anderen Pipeline, eine App-Änderung des Agenten oder jede CI mit
  einem Service-Schlüssel.
- **Alles, was eine echte Pipeline braucht.** Werkzeug-Setup und Caches, Service-Container (Postgres,
  Redis), Schritt-Ausgaben, JUnit-Berichte, Artefakte, Freigaben, Wiederholungen, Zeitlimits und
  Steuerung paralleler Läufe.
- **Meldet zurück.** ✓ / ✗ am Commit und am Pull Request in GitHub oder GitLab.

Siehe [Pipelines](./docs/pipelines.md).

### Deployments

- **Umgebungen** wie `staging` und `production`, jede auf einer deiner Maschinen, jede mit eigenen
  Variablen. Der Testschlüssel auf Staging, der Live-Schlüssel auf Production, beide aus dem Vault.
- **Aus einer Pipeline deployen**, damit eine App getestet ist, bevor sie rausgeht. Zelyq baut das
  Image auf deiner Maschine, aus dem `Dockerfile` der App oder einem, das es für Node, Python, Go
  und statische Seiten schreibt. Keine Registry nötig.
- **Automatisches Zurückrollen.** Besteht die neue Version ihren Health-Check nicht, kommt die
  vorherige von selbst zurück.
- **Deine eigene Domain mit HTTPS**, ohne Ausfallzeit zwischen Versionen.
- **Live-Logs, CPU und Speicher**, Neustart und Stopp, und Zurückrollen auf eine frühere Version per
  Klick.
- **Befördere** genau das auf Staging getestete Image nach Production, ohne es neu zu bauen.
- **Geschützte Umgebungen** warten auf die Freigabe eines Admins. **Einfrieren** stoppt während
  eines Releases alle Deployments.

Siehe [Deployen](./docs/deploy.md).

### Ops

**Ops** ist der DevOps-Engineer des Teams. Bitte ihn, schriftlich oder per Sprache, eine App online
zu bringen, eine neue Version auszuliefern, eine Domain einzurichten oder zu erklären, warum etwas
langsam ist.

- **Er schaut zuerst und zeigt einen Plan.** Ops schaut sich frei um, aber jede Änderung ist eine
  Liste genauer Schritte, die auf dein Okay wartet. Ein Schritt, der sich nicht rückgängig machen
  lässt, wird einzeln bestätigt.
- **Er belegt jede Änderung.** Zelyq prüft das Ergebnis selbst. Ein Schritt gilt erst als erledigt,
  wenn seine Prüfung besteht.
- **Er hört nie auf hinzusehen.** Websites und Apps werden jede Minute geprüft, Maschinen alle fünf
  Minuten, Zertifikate und Domains täglich, ganz ohne Modell. Warnungen erreichen dich per E-Mail,
  Telegram, Slack oder Discord.
- **Er erreicht nur, was du ihm zuweist.** Ein Admin gibt ihm Umgebungen, Maschinen, Pipelines und
  Code, eins nach dem anderen, jeweils mit einer Vertrauensstufe. Er sieht die Namen von Secrets,
  nie ihre Werte.
- **Er merkt sich Dinge.** Regeln, die du ihm gibst, und Lehren aus Fehlern werden aufbewahrt und
  vor jedem Auftrag gelesen.
- **Du behältst die Kontrolle.** Ein monatliches Ausgabenlimit, und **Ops pausieren** stoppt sofort
  alles.

---

## Teams, Tarife und Sprachen

| Rolle | Darf |
| --- | --- |
| `viewer` | Apps, Dateien, Läufe, Umgebungen und Deploy-Verlauf sehen |
| `editor` | Alles darüber, plus dem Agenten Aufträge geben, Pipelines starten und deployen |
| `admin` | Alles darüber, plus Mitglieder, Agenten, Umgebungen, Freigaben und geschützte Secrets |
| `owner` | Volle Kontrolle, auch über das Team selbst |

- **Aktivität.** Jede Änderung steht in der Aktivität des Teams: ein angezeigtes Secret, eine
  bearbeitete Pipeline, ein zurückgerolltes Deployment.
- **Tarife und Nutzung.** Jedes Team hat Grenzen für Apps, Speicher, Pipeline-Läufe, Mitglieder und
  Vorschauen, festgelegt vom Admin des Servers.
- **Zelyq für andere betreiben.** Der [verwaltete Modus](./docs/managed-mode.md) legt die Anmeldung
  hinter deinen eigenen Kontendienst, und mit der [Admin-API](./docs/admin-api.md) verwalten deine
  Systeme Personen, Teams, Tarife und Zustand.
- **Neun Sprachen.** Die Oberfläche und ihre eingebaute Hilfe gibt es auf Englisch, Französisch,
  Deutsch, Spanisch, Portugiesisch, Chinesisch, Hindi, Italienisch und Japanisch, für jede Person
  wählbar.
- **Ungenutzte Apps schlafen.** Apps, die länger niemand geöffnet hat, können in einen S3-kompatiblen
  Bucket oder einen Ordner wandern und wachen beim Öffnen von selbst auf. Siehe
  [Speicher](./docs/storage.md).

---

## Schnellstart

**Am schnellsten:** Leg ein Konto auf **[app.zelyq.dev](https://app.zelyq.dev)** an. Es gibt einen
kostenlosen Tarif, und nichts muss installiert werden.

**Zum Selbstbetreiben:**

```bash
# Requires Node >= 20.12 and pnpm >= 9
git clone https://github.com/CrowPus/Zelyq.git
cd Zelyq
cp .env.example .env    # your configuration: check it before the first start (below)
pnpm install
pnpm dev                # web :5173 · server :8787 · agent :8788
```

Öffne <http://localhost:5173> und leg das erste Konto an. Dieses Konto verwaltet die Instanz. Trag
den Schlüssel deines Modells unter **Einstellungen → Modell** ein (getippt oder aus dem Vault),
öffne **Apps**, leg eine App an und beschreib, was du willst.

**Auf einer VM oder einem entfernten Server** ändere diese Werte in `.env` vor dem ersten Start.
Ersetze `203.0.113.10` durch die Adresse oder Domain deiner Maschine:

| Einstellung | Wert | Warum |
| --- | --- | --- |
| `ZELYQ_WEB_HOST` | `0.0.0.0` | Sonst antwortet die Oberfläche nur auf der Maschine selbst |
| `ZELYQ_PREVIEW_HOST` | `203.0.113.10` | Sonst lehnen App-Vorschauen deinen Browser ab |
| `ZELYQ_CORS_ORIGIN` | `http://203.0.113.10:5173` | Die Adresse, unter der du Zelyq öffnest |
| `ZELYQ_PUBLIC_URL` | `http://203.0.113.10:5173` | Wird in Webhook- und Anmeldelinks verwendet |
| `ZELYQ_ALLOW_REGISTRATION` | `false`, sobald dein Konto existiert | Sonst kann sich jeder registrieren, der die Adresse findet |

Öffne Port 5173 und die Vorschau-Ports (`ZELYQ_PREVIEW_PORT_MIN`–`MAX`, standardmäßig 4300–4399) in
der Firewall. Auf einer Maschine, die aus dem Internet erreichbar ist, gehört Zelyq hinter HTTPS:
siehe [Selbst hosten](./docs/self-hosting.md). Alle weiteren Einstellungen sind in `.env.example`
und unter [Konfiguration](./docs/configuration.md) erklärt.

**Mit Docker:** `docker compose -f docker/docker-compose.yml up`. Siehe
[Selbst hosten](./docs/self-hosting.md).

**Als Nächstes:** Das [Tutorial](./docs/tutorial.md) bringt eine App Schritt für Schritt von Zelyq in
die Produktion: Vault, eine Pipeline, deine eigene Maschine, ein Deployment mit Zurückrollen sowie
GitHub-Pushes und Pull Requests.

### Aktualisieren

Deine Daten bleiben, wo sie sind. Datenbank, erzeugte Medien und der Verschlüsselungsschlüssel
liegen in `data/`, deine Apps in `workspace/` und deine Einstellungen in `.env`. Git ignoriert alle
drei, und der Server wendet Datenbankänderungen beim Start selbst an.

```bash
cd ~/Zelyq                                    # wherever you cloned it
# 1. Stop Zelyq (Ctrl+C if it runs as `pnpm dev`)

# 2. Back up first
cp -a data ~/zelyq-data-backup-$(date +%F)
cp -a workspace ~/zelyq-workspace-backup-$(date +%F) 2>/dev/null
cp .env ~/zelyq-env-backup-$(date +%F) 2>/dev/null

# 3. Get the new version and rebuild
git pull
pnpm install
pnpm build

# 4. Start Zelyq again the same way as before
```

Führe das als der Benutzer aus, der Zelyq geklont hat. Bricht Git mit `detected dubious ownership`
ab, wechsle mit `su - <benutzer>` zu diesem Benutzer, statt eine `safe.directory`-Ausnahme
hinzuzufügen.

Mit Docker: `git pull`, dann `docker compose -f docker/docker-compose.yml up -d --build`. Deine Daten
liegen im Volume `zelyq-data`: Führe **niemals** `docker compose down -v` aus, das löscht es.

Mehr dazu, auch zu PostgreSQL: [Selbst hosten → Upgrade](./docs/self-hosting.md#upgrading).

---

## Dein eigenes Modell

| Anbieter | `ZELYQ_PROVIDER` | Standardmodell |
| --- | --- | --- |
| Claude | `anthropic` | `claude-opus-5-5` |
| Gemini | `google` | `gemini-pro-latest` |
| OpenAI | `openai` | `gpt-6.1-terra` |
| Grok (xAI) | `xai` | `grok-4.6` |
| DeepSeek | `deepseek` | `deepseek-v4-flash` |
| Mistral | `mistral` | `mistral-large-latest` |
| Groq | `groq` | `llama-3.3-70b-versatile` |
| OpenRouter | `openrouter` | `anthropic/claude-sonnet-4.6` |
| **Dein eigenes**: Ollama, vLLM, LM Studio, alles OpenAI-Kompatible | `custom` | `ZELYQ_MODEL` setzen |

Schlüssel trägst du unter **Einstellungen → Modell** ein, getippt oder aus dem Vault, oder jedes Team
bringt seine eigenen unter **Team-Einstellungen → KI-Schlüssel** mit. Eine Claude-Code- oder
Codex-Anmeldung kann einen API-Schlüssel ersetzen. Mit `custom` verlässt nichts über deine Projekte
dein Netzwerk. Siehe [Konfiguration](./docs/configuration.md).

---

## So funktioniert es

Drei Prozesse und ein Kommandozeilenwerkzeug auf vier gemeinsamen Bibliotheken. Die Dateien und
Befehle einer App erreicht man nur über einen Weg, den `RuntimeDriver`. Deshalb funktionieren lokal,
Container und entfernter Host gleich.

```
   Browser                                 zelyq CLI  (zelyq vault run …)
      │                                        │
      │  REST + WebSocket                      │  HTTPS, service key
      ▼                                        ▼
 ┌──────────────────────────────────────────────────────────┐
 │ apps/server   Fastify · owns the database                │
 │ teams · apps · Vault · pipelines · deploys · Ops         │
 └────┬───────────────────────┬─────────────────────┬───────┘
      │ HTTP + SSE            │                     │ outgoing HTTPS or SSH
      ▼                       │                     ▼
 ┌──────────────┐             │             ┌────────────────────────────┐
 │ apps/agent   │             │             │ Runners and environments   │
 │ model loop,  │             │             │ your Linux, macOS, Windows │
 │ tools        │             │             │ machines: pipelines,deploys│
 └──────┬───────┘             │             └────────────────────────────┘
        │                     │  files, previews, snapshots
        ▼                     ▼
 ┌──────────────────────────────────────────────────────────┐
 │ RuntimeDriver   the only path to disk and shell          │
 │ local · container (one per project) · remote host        │
 └──────────────────────────────────────────────────────────┘
```

| Teil | Aufgabe |
| --- | --- |
| [`apps/web`](./apps/web) | Die Oberfläche: Chat, Editor und Vorschau, Studio, Vault, Pipelines, Deployments, Ops |
| [`apps/server`](./apps/server) | Teams, Apps, Vault, die Pipeline-Engine, Deployments und Ops; der einzige Prozess, der mit der Datenbank spricht |
| [`apps/agent`](./apps/agent) | Die Modellschleife. Er fasst selbst keine Dateien an: Jedes Werkzeug läuft über den `RuntimeDriver` |
| [`apps/runner`](./apps/runner) | Der Runner auf deinen Maschinen; er verbindet sich zu Zelyq und führt Pipelines und Deployments aus |
| [`apps/cli`](./apps/cli) | Die Kommandozeile `zelyq`, z. B. `zelyq vault run` |
| [`apps/registry`](./apps/registry) | Die Registry für signierte Plugins |
| [`@zelyq/core`](./packages/core) | Domänentypen, das Format der Pipeline-Dateien und das Protokoll |
| [`@zelyq/runtime`](./packages/runtime) | `RuntimeDriver` und seine Umsetzungen; der einzige Code, der Prozesse startet |
| [`@zelyq/db`](./packages/db) | Drizzle-Schema und Migrationen: standardmäßig SQLite, PostgreSQL zum Skalieren |
| [`@zelyq/tools`](./packages/tools) | Die Werkzeuge des Agenten, einmal gegen den `RuntimeDriver` geschrieben |

Alle Details: [Architektur](./docs/architecture.md).

---

## Sicherheit

Zelyq ist gebaut, um geprüft zu werden: einfache Speicherung, normale Dateien, keine Telemetrie und
Secrets, die verschlüsselt gespeichert und nie auf eine Kommandozeile oder in ein Log geschrieben
werden. Kenne diese Grenzen, bevor du deployst:

- **Der Laufzeitmodus `local` ist keine Sandbox.** Befehle des Agenten laufen als Benutzer des
  Servers. Nutze ihn für eine vertrauenswürdige Person auf einer Maschine. Für alles Geteilte oder
  aus dem Internet Erreichbare setze `ZELYQ_RUNTIME=container`.
- **Ausgehender Netzverkehr im Container-Modus ist standardmäßig offen.** Gesperrt sind immer der
  Cloud-Metadaten-Endpunkt und Verkehr zwischen Projekten. Setze `ZELYQ_CONTAINER_EGRESS_ALLOWLIST`,
  um den Rest einzuschränken, oder nutze für nicht vertrauenswürdigen Code die
  [strenge Sandbox](./docs/strict-sandbox.md).

Lies vor dem Deployen das [Bedrohungsmodell](./SECURITY.md#threat-model--read-this-before-deploying)
und melde Schwachstellen vertraulich wie in [SECURITY.md](./SECURITY.md) beschrieben.

## Stand

Zelyq ist **jung und entwickelt sich schnell**. Apps, Studio, Agenten, Vault, Pipelines, Deployments
und Ops funktionieren durchgängig und sind täglich im Einsatz. Rechne vor `1.0` mit inkompatiblen
Änderungen. Siehe [Roadmap](./docs/roadmap.md).

## Mitmachen

Issues, Diskussionen und Pull Requests sind willkommen. [CONTRIBUTING.md](./CONTRIBUTING.md)
beschreibt den Entwicklungsablauf, den Aufbau des Repositorys und wohin eine Änderung meist gehört.
Führe vor einem Pull Request `pnpm lint`, `pnpm typecheck` und `pnpm test` aus. Alle Beteiligten
halten sich an den [Verhaltenskodex](./CODE_OF_CONDUCT.md).

## Lizenz

Zelyq ist **Open Source** unter der [GNU AGPL-3.0](./LICENSE): betreiben, ändern, selbst hosten,
forken. Wer ein *verändertes* Zelyq über ein Netzwerk als Dienst für andere betreibt, muss diesen
Nutzern nach der AGPL den Quellcode anbieten.

Eine **kommerzielle Lizenz** (derselbe Code ohne die Netzwerk-Quellcode-Pflicht der AGPL) gibt es für
Closed-Source-Produkte und Organisationen, deren Richtlinien AGPL-Software ausschließen:
**support@dee-empire.com**. Funktionen mit der Kennzeichnung „Zelyq Enterprise“ (`ee/`-Pfade) sind
ein eigenes Abonnement unter der [Zelyq Enterprise License](./LICENSE_EE.md).
[LICENSING.md](./LICENSING.md) erklärt das in einfachen Worten. Versionen bis einschließlich `v0.1.0`
bleiben unter Apache-2.0 verfügbar.

<div align="center">
<br />

© 2026 [Dee Empire](https://dee-empire.com) · „Zelyq“ und das Zelyq-Logo sind Marken von Dee Empire.

</div>
