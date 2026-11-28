<div align="center">

<img src="assets/brand/zelyq-banner.png" alt="Zelyq: build, automate and ship software with AI" width="100%" />

[English](./README.md) · [Français](./README.fr.md) · [Deutsch](./README.de.md) · [Español](./README.es.md) · [Português](./README.pt-BR.md) · [简体中文](./README.zh-CN.md) · [हिन्दी](./README.hi.md) · **Italiano** · [日本語](./README.ja.md)

### La piattaforma open source per creare, proteggere, rilasciare e gestire software, in un unico posto.

Crea app con un agente IA che lavora come un ingegnere. Conserva ogni credenziale in un vault cifrato.
Testa e distribuisci sulle tue macchine, e lascia che un DevOps engineer IA si occupi di ciò che è in esecuzione.
**Ospitato da te o online. Il tuo modello. Nessuna telemetria.**

[![CI](https://github.com/CrowPus/Zelyq/actions/workflows/ci.yml/badge.svg)](https://github.com/CrowPus/Zelyq/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520.12-brightgreen.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)](./tsconfig.base.json)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-black.svg)](./CONTRIBUTING.md)

**[Sito web](https://zelyq.dev)** · **[Provalo online](https://app.zelyq.dev)** · [Avvio rapido](#avvio-rapido) ·
[Tutorial](./docs/tutorial.md) · [Documentazione](./docs/README.md) · [Self-hosting](./docs/self-hosting.md) ·
[Architettura](./docs/architecture.md) · [Roadmap](./docs/roadmap.md) · [Contribuire](./CONTRIBUTING.md)

</div>

---

## Indice

- [Perché Zelyq](#perché-zelyq)
- [La piattaforma](#la-piattaforma): [App](#app), [Studio](#studio), [Agenti](#agenti), [Vault](#vault),
  [Pipeline](#pipeline), [Deploy](#deploy), [Ops](#ops)
- [Team, piani e lingue](#team-piani-e-lingue)
- [Avvio rapido](#avvio-rapido) e [aggiornamento](#aggiornamento)
- [Il tuo modello](#il-tuo-modello)
- [Come funziona](#come-funziona)
- [Sicurezza](#sicurezza) · [Stato](#stato) · [Contribuire](#contribuire) · [Licenza](#licenza)

---

## Perché Zelyq

Rilasciare software richiede di solito diversi prodotti: un generatore di app con IA, un gestore di
segreti, un servizio di CI, uno strumento di deploy e qualcuno di reperibilità. Significa più
accessi, più fatture e più punti da cui una chiave può trapelare. Zelyq riunisce l’intero percorso
in un’unica piattaforma, organizzata come si svolge il lavoro:

| | Modulo | Cosa fa |
| --- | --- | --- |
| **Crea** | **[App](#app)** | Descrivi un’app. Un agente la pianifica, la costruisce in file reali che sono tuoi e la verifica prima di dichiararla finita |
| | **[Studio](#studio)** | Genera immagini e video, per le tue app o da soli |
| | **[Agenti](#agenti)** | Fai lavorare in Zelyq Claude Code, Cursor, VS Code, Gemini CLI o qualsiasi client MCP, con il suo modello |
| **Proteggi** | **[Vault](#vault)** | Ogni credenziale salvata una volta, cifrata, versionata e tracciata, usata da app, pipeline e dai tuoi server |
| **Rilascia** | **[Pipeline](#pipeline)** | Testa e costruisci sempre allo stesso modo, sul server Zelyq o sulle tue macchine Linux, macOS e Windows |
| | **[Deploy](#deploy)** | Porta le app sulle tue macchine per ambiente, con approvazioni, blocco dei rilasci e ripristino automatico |
| | **[Ops](#ops)** | Un DevOps engineer IA con cui parlare: pianifica, attende la tua approvazione, dimostra ogni modifica e sorveglia ciò che gira |

Tutto appartiene a un **team**. Invita persone, assegna a ciascuna un ruolo, e ogni modulo lo
rispetta.

---

## La piattaforma

### App

Descrivi ciò che vuoi. L’agente legge, pianifica, scrive file, esegue comandi e avvia un’anteprima
dal vivo. Vedi ogni chiamata agli strumenti e ogni file che tocca mentre lavora.

- **Verificato, non solo generato.** Quando l’agente ha finito, Zelyq esegue il typecheck o la build
  del progetto e controlla che l’anteprima non vada in crash. Un turno che ha rotto qualcosa torna
  all’agente per essere corretto, invece di essere dato per concluso.
- **Chiaro su ciò che sa.** La *modalità Ingegnere* separa ciò che è stato verificato da ciò che è
  stato supposto, indica l’alternativa che non ha scelto e chiede prima di qualunque azione
  irreversibile.
- **Pianifica prima di costruire.** La *modalità Architetto* trasforma una richiesta in un progetto
  che puoi rivedere (requisiti, decisioni, modello dei dati, API, piano di costruzione) e attende il
  tuo via libera. La *modalità Auto* poi esegue il piano da sola, fino a un limite stabilito.
- **Specialisti a disposizione.** Un designer (`DESIGN.md`), un DevOps engineer (CI, Dockerfile,
  configurazione di deploy), un ingegnere sicurezza/QA (test e analisi di sicurezza) e un ingegnere
  cinematico (pagine animate allo scorrimento).
- **Full stack.** React + Vite, React con backend Python (FastAPI) o Expo React Native, ciascuno con
  un design system di partenza. Supabase Postgres con sicurezza a livello di riga per ogni
  operazione.
- **Parti da ciò che esiste.** Importa un repository GitHub, ricostruisci un sito online con
  `/clone <url>`, o parti da un frame Figma e dai suoi design token con `/figma <link>`.
- **Ogni turno si può annullare.** Uno snapshot prima di ogni turno, un diff esatto di ciò che è
  cambiato e un ripristino con un clic. I progetti sono normali file su disco, che puoi portare con
  te.

Vedi [Modalità](./docs/modes.md) e [come si comporta l’agente](./docs/agent-behaviour.md).

### Studio

- **Immagine**: OpenAI, Google o xAI, con immagini di riferimento e una libreria privata.
- **Video**: Google Veo o xAI, da un testo o da un’immagine fissa.

Studio usa le tue chiavi dei provider, fatturate sul tuo account. Attivalo per un progetto e
l’agente può creare grafica e riprese per l’app che sta costruendo, entro i limiti che imposti. Le
clip si possono dividere in sequenze di immagini per pagine animate allo scorrimento. Vedi
[Studio: immagini](./docs/Image-gen/implementation.md) e [Studio: video](./docs/Video-gen/README.md).

### Agenti

Porta lo strumento di IA che usi già. Un **agente** permette a Claude Code, Cursor, VS Code, Gemini
CLI, ChatGPT o qualsiasi client MCP di lavorare in Zelyq con il proprio modello e il proprio
abbonamento. Zelyq gli dà accesso solo alle app, alle pipeline e agli ambienti che scegli.

- **Permessi impostati uno per uno**: Disattivato, Consentito o Richiede approvazione, per leggere e
  scrivere codice, eseguire comandi, fare push, pipeline, deploy, Studio e altro.
- **Ciò che conta lo approva una persona.** Push, esecuzioni di pipeline e modifiche ai deploy sono
  richieste che attendono nella posta in arrivo.
- **Facile da annullare.** Prima che l’agente modifichi un’app viene creato un punto di
  annullamento.
- **I valori segreti non vengono mai mostrati.** L’agente vede quali segreti riceve un’app, solo per
  nome.

Vedi [Agenti](./docs/agents.md).

### Vault

Salva ogni credenziale **una sola volta** e usala ovunque, senza incollarla in un file.

- **Cifrato a riposo** (AES-256-GCM), con **cronologia delle versioni**, un contrassegno
  **Protetto** per le chiavi di produzione e una traccia di ogni visualizzazione e modifica.
- **Usato per riferimento.** Variabili delle app, chiavi dei modelli, pipeline e ambienti puntano a
  `vault://NOME`. Il valore viene inserito solo dove e quando serve.
- **Mascherato nei log.** Un segreto che arriva in un log di pipeline appare come `***`.
- **Anche per i tuoi server.** Recupera i segreti con una chiave di servizio dai permessi limitati,
  oppure esegui `zelyq vault run -- <comando>` per avviare un processo con essi, senza scrivere nulla
  su disco.
- **Trasloca importando un `.env`.**

Vedi [Vault](./docs/vault.md).

### Pipeline

Una pipeline è un breve file YAML, o uno schema che modifichi con un clic. Le fasi vengono eseguite
in ordine, i passaggi anche, e ogni passaggio è un comando o un blocco già pronto.

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

- **Gira dove scegli tu.** In un container usa e getta sul server Zelyq, o sulle tue macchine
  **Linux, macOS e Windows**. Una macchina si aggiunge con un solo comando di installazione e si
  collega a Zelyq in HTTPS, senza porte da aprire. Sono supportate anche macchine raggiunte via SSH.
- **Veloce e flessibile.** Fasi in parallelo, una macchina diversa per fase, build a matrice e
  modelli condivisi tra pipeline.
- **Plugin.** Impacchetta un passaggio una volta, con input, segreti dal Vault e output, e usalo in
  qualsiasi pipeline. Vedi [Plugin per pipeline](./docs/pipeline-plugins.md).
- **Avviata da qualsiasi cosa.** A mano, da un git push (con filtri sui percorsi), da una pull
  request, da una pianificazione, dalla fine di un’altra pipeline, da una modifica dell’agente a
  un’app, o da qualsiasi CI con una chiave di servizio.
- **Tutto ciò che serve a una vera pipeline.** Installazione degli strumenti e cache, container di
  servizio (Postgres, Redis), output dei passaggi, report JUnit, artefatti, approvazioni, nuovi
  tentativi, timeout e controllo della concorrenza.
- **Riporta il risultato.** ✓ / ✗ sul commit e sulla pull request in GitHub o GitLab.

Vedi [Pipeline](./docs/pipelines.md).

### Deploy

- **Ambienti** come `staging` e `production`, ciascuno su una delle tue macchine, ciascuno con le
  sue variabili. La chiave di test in staging e quella di produzione in production, entrambe dal
  Vault.
- **Distribuisci da una pipeline**, così un’app viene testata prima del rilascio. Zelyq costruisce
  l’immagine sulla tua macchina, dal `Dockerfile` dell’app o da uno che scrive per Node, Python, Go e
  siti statici. Nessun registry necessario.
- **Ripristino automatico.** Se la nuova versione non supera il controllo di salute, quella
  precedente torna da sola.
- **Il tuo dominio con HTTPS**, senza interruzioni tra una versione e l’altra.
- **Log dal vivo, CPU e memoria**, riavvio e arresto, e ritorno a una versione precedente con un
  clic.
- **Promuovi** in produzione esattamente l’immagine testata in staging, senza ricostruirla.
- **Gli ambienti protetti** attendono l’approvazione di un amministratore. **Il blocco dei rilasci**
  ferma tutti i deploy durante un rilascio.

Vedi [Deploy](./docs/deploy.md).

### Ops

**Ops** è il DevOps engineer del team. Chiedigli, per iscritto o a voce, di mettere online un’app,
rilasciare una nuova versione, configurare un dominio o spiegare perché qualcosa è lento.

- **Prima guarda e mostra un piano.** Ops osserva liberamente, ma ogni modifica è un elenco di
  passaggi precisi che attende la tua approvazione. Un passaggio irreversibile viene confermato a
  parte.
- **Dimostra ogni modifica.** Zelyq verifica il risultato da sé. Un passaggio conta come fatto solo
  quando il suo controllo è superato.
- **Non smette mai di sorvegliare.** Siti e app controllati ogni minuto, macchine ogni cinque
  minuti, certificati e domini ogni giorno, senza usare alcun modello. Gli avvisi ti raggiungono via
  email, Telegram, Slack o Discord.
- **Raggiunge solo ciò che gli assegni.** Un amministratore gli affida ambienti, macchine, pipeline
  e codice, uno per uno, con un livello di fiducia per ciascuno. Vede i nomi dei segreti, mai i loro
  valori.
- **Si ricorda.** Le regole che gli dai e le lezioni da ciò che è andato storto vengono conservate e
  rilette prima di ogni attività.
- **Il controllo resta a te.** Un limite di spesa mensile, e **Metti in pausa Ops** ferma tutto
  subito.

---

## Team, piani e lingue

| Ruolo | Può |
| --- | --- |
| `viewer` | Vedere app, file, esecuzioni, ambienti e cronologia dei deploy |
| `editor` | Tutto quanto sopra, più dare istruzioni all’agente, eseguire pipeline e distribuire |
| `admin` | Tutto quanto sopra, più membri, agenti, ambienti, approvazioni e segreti protetti |
| `owner` | Controllo completo, compreso il team stesso |

- **Attività.** Ogni modifica viene registrata nell’Attività del team: un segreto mostrato, una
  pipeline modificata, un deploy ripristinato.
- **Piani e utilizzo.** Ogni team ha limiti per app, spazio, esecuzioni di pipeline, membri e
  anteprime, stabiliti dall’amministratore del server.
- **Gestire Zelyq per altri.** La [modalità gestita](./docs/managed-mode.md) mette l’accesso dietro
  il tuo servizio di account, e l’[API di amministrazione](./docs/admin-api.md) permette ai tuoi
  sistemi di gestire persone, team, piani e stato di salute.
- **Nove lingue.** L’interfaccia e la sua guida integrata sono in inglese, francese, tedesco,
  spagnolo, portoghese, cinese, hindi, italiano e giapponese, a scelta di ciascuno.
- **Le app inattive dormono.** Le app che nessuno apre da un po’ possono spostarsi in un bucket
  compatibile con S3 o in una cartella, e si risvegliano da sole quando vengono aperte. Vedi
  [Archiviazione](./docs/storage.md).

---

## Avvio rapido

**Il modo più veloce:** crea un account su **[app.zelyq.dev](https://app.zelyq.dev)**. C’è un piano
gratuito e niente da installare.

**Per gestirlo tu:**

```bash
# Requires Node >= 20.12 and pnpm >= 9
git clone https://github.com/CrowPus/Zelyq.git
cd Zelyq
cp .env.example .env    # your configuration: check it before the first start (below)
pnpm install
pnpm dev                # web :5173 · server :8787 · agent :8788
```

Apri <http://localhost:5173> e crea il primo account: è quello che amministra l’istanza. Aggiungi la
chiave del tuo modello in **Impostazioni → Modello** (digitata o dal Vault), apri **App**, crea
un’app e descrivi ciò che vuoi.

**Su una VM o un server remoto**, modifica questi valori in `.env` prima del primo avvio. Sostituisci
`203.0.113.10` con l’indirizzo o il dominio della tua macchina:

| Impostazione | Valore | Perché |
| --- | --- | --- |
| `ZELYQ_WEB_HOST` | `0.0.0.0` | Altrimenti l’interfaccia risponde solo sulla macchina stessa |
| `ZELYQ_PREVIEW_HOST` | `203.0.113.10` | Altrimenti le anteprime delle app rifiutano il tuo browser |
| `ZELYQ_CORS_ORIGIN` | `http://203.0.113.10:5173` | L’indirizzo da cui apri Zelyq |
| `ZELYQ_PUBLIC_URL` | `http://203.0.113.10:5173` | Usato nei link dei webhook e di accesso |
| `ZELYQ_ALLOW_REGISTRATION` | `false`, una volta creato il tuo account | Altrimenti chiunque trovi l’indirizzo può registrarsi |

Apri la porta 5173 e le porte delle anteprime (`ZELYQ_PREVIEW_PORT_MIN`–`MAX`, 4300–4399 per
impostazione predefinita) nel firewall. Su una macchina raggiungibile da internet, metti Zelyq
dietro HTTPS: vedi [Self-hosting](./docs/self-hosting.md). Tutte le altre impostazioni sono spiegate
in `.env.example` e in [Configurazione](./docs/configuration.md).

**Con Docker:** `docker compose -f docker/docker-compose.yml up`. Vedi
[Self-hosting](./docs/self-hosting.md).

**Poi:** il [tutorial](./docs/tutorial.md) porta un’app da Zelyq alla produzione, passo dopo passo:
Vault, una pipeline, la tua macchina, un deploy con ripristino, e push e pull request da GitHub.

### Aggiornamento

I tuoi dati restano dove sono. Database, media generati e chiave di cifratura si trovano in `data/`,
le tue app in `workspace/` e le tue impostazioni in `.env`. Git li ignora tutti e tre, e il server
applica da sé le modifiche al database all’avvio.

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

Esegui questi comandi con l’utente che ha clonato Zelyq. Se Git si ferma con
`detected dubious ownership`, passa a quell’utente con `su - <utente>` invece di aggiungere
un’eccezione `safe.directory`.

Con Docker: `git pull`, poi `docker compose -f docker/docker-compose.yml up -d --build`. I tuoi dati
sono nel volume `zelyq-data`: non eseguire **mai** `docker compose down -v`, che lo elimina.

Più dettagli, anche per PostgreSQL: [Self-hosting → Aggiornamento](./docs/self-hosting.md#upgrading).

---

## Il tuo modello

| Provider | `ZELYQ_PROVIDER` | Modello predefinito |
| --- | --- | --- |
| Claude | `anthropic` | `claude-opus-5-5` |
| Gemini | `google` | `gemini-pro-latest` |
| OpenAI | `openai` | `gpt-6.1-terra` |
| Grok (xAI) | `xai` | `grok-4.6` |
| DeepSeek | `deepseek` | `deepseek-v4-flash` |
| Mistral | `mistral` | `mistral-large-latest` |
| Groq | `groq` | `llama-3.3-70b-versatile` |
| OpenRouter | `openrouter` | `anthropic/claude-sonnet-4.6` |
| **Il tuo**: Ollama, vLLM, LM Studio, qualsiasi cosa compatibile con OpenAI | `custom` | imposta `ZELYQ_MODEL` |

Imposta le chiavi in **Impostazioni → Modello**, digitate o dal Vault, oppure lascia che ogni team
porti le sue in **Impostazioni del team → Chiavi IA**. Un accesso con Claude Code o Codex può
sostituire una chiave API. Con `custom`, nulla dei tuoi progetti lascia la tua rete. Vedi
[Configurazione](./docs/configuration.md).

---

## Come funziona

Tre processi e uno strumento da riga di comando, costruiti su quattro librerie condivise. File e
comandi di un’app si raggiungono da un’unica strada, il `RuntimeDriver`: è questo che fa funzionare
allo stesso modo locale, container e host remoto.

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

| Parte | Compito |
| --- | --- |
| [`apps/web`](./apps/web) | L’interfaccia: chat, editor e anteprima, Studio, Vault, Pipeline, Deploy, Ops |
| [`apps/server`](./apps/server) | Team, app, Vault, il motore delle pipeline, i deploy e Ops; l’unico processo che parla con il database |
| [`apps/agent`](./apps/agent) | Il ciclo del modello. Non tocca mai i file da solo: ogni strumento passa dal `RuntimeDriver` |
| [`apps/runner`](./apps/runner) | Il runner installato sulle tue macchine; si collega a Zelyq ed esegue pipeline e deploy |
| [`apps/cli`](./apps/cli) | La riga di comando `zelyq`, ad es. `zelyq vault run` |
| [`apps/registry`](./apps/registry) | Il registro dei plugin firmati |
| [`@zelyq/core`](./packages/core) | Tipi del dominio, formato dei file di pipeline e protocollo |
| [`@zelyq/runtime`](./packages/runtime) | `RuntimeDriver` e le sue implementazioni; l’unico codice che avvia processi |
| [`@zelyq/db`](./packages/db) | Schema e migrazioni Drizzle: SQLite per impostazione predefinita, PostgreSQL per crescere |
| [`@zelyq/tools`](./packages/tools) | Gli strumenti dell’agente, scritti una volta per il `RuntimeDriver` |

Tutti i dettagli: [Architettura](./docs/architecture.md).

---

## Sicurezza

Zelyq è fatto per essere ispezionato: archiviazione semplice, file normali, nessuna telemetria, e
segreti cifrati a riposo che non finiscono mai su una riga di comando o in un log. Conosci questi
limiti prima di distribuire:

- **La modalità di esecuzione `local` non è una sandbox.** I comandi dell’agente girano con l’utente
  del server. Usala per una persona fidata su una sola macchina. Per qualsiasi uso condiviso o
  esposto a internet, imposta `ZELYQ_RUNTIME=container`.
- **La rete in uscita della modalità container è aperta per impostazione predefinita.** Blocca
  sempre l’endpoint dei metadati del cloud e il traffico tra progetti. Imposta
  `ZELYQ_CONTAINER_EGRESS_ALLOWLIST` per limitare il resto, o usa la
  [sandbox rigorosa](./docs/strict-sandbox.md) per codice non fidato.

Leggi il [modello delle minacce](./SECURITY.md#threat-model--read-this-before-deploying) prima di
distribuire, e segnala le vulnerabilità in privato come descritto in [SECURITY.md](./SECURITY.md).

## Stato

Zelyq è **giovane e cresce in fretta**. App, Studio, Agenti, Vault, Pipeline, Deploy e Ops
funzionano dall’inizio alla fine e vengono usati ogni giorno. Aspettati modifiche incompatibili prima
della `1.0`. Vedi la [roadmap](./docs/roadmap.md).

## Contribuire

Issue, discussioni e pull request sono benvenute. [CONTRIBUTING.md](./CONTRIBUTING.md) descrive il
ciclo di sviluppo, la struttura del repository e dove va di solito una modifica. Prima di aprire una
pull request, esegui `pnpm lint`, `pnpm typecheck` e `pnpm test`. Chi partecipa segue il
[codice di condotta](./CODE_OF_CONDUCT.md).

## Licenza

Zelyq è **open source** con licenza [GNU AGPL-3.0](./LICENSE): eseguilo, modificalo, ospitalo tu,
fanne un fork. Se offri a terzi via rete uno Zelyq *modificato* come servizio, la AGPL ti obbliga a
rendere loro disponibile il tuo codice sorgente.

Una **licenza commerciale** (lo stesso codice senza l’obbligo AGPL di fornire il sorgente in rete) è
disponibile per prodotti closed source e organizzazioni la cui politica esclude il software AGPL:
**support@dee-empire.com**. Le funzionalità contrassegnate "Zelyq Enterprise" (percorsi `ee/`) sono
un abbonamento separato con la [Zelyq Enterprise License](./LICENSE_EE.md).
[LICENSING.md](./LICENSING.md) lo spiega in parole semplici. Le versioni fino a `v0.1.0` inclusa
restano disponibili con licenza Apache-2.0.

<div align="center">
<br />

© 2026 [Dee Empire](https://dee-empire.com) · "Zelyq" e il logo Zelyq sono marchi di Dee Empire.

</div>
