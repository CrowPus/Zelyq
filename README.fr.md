<div align="center">

<img src="assets/brand/zelyq-banner.png" alt="Zelyq: build, automate and ship software with AI" width="100%" />

[English](./README.md) · **Français** · [Deutsch](./README.de.md) · [Español](./README.es.md) · [Português](./README.pt-BR.md) · [简体中文](./README.zh-CN.md) · [हिन्दी](./README.hi.md) · [Italiano](./README.it.md) · [日本語](./README.ja.md)

### La plateforme open source pour créer, sécuriser, livrer et faire tourner vos logiciels, au même endroit.

Créez des apps avec un agent IA qui travaille comme un ingénieur. Gardez chaque identifiant dans un coffre chiffré.
Testez et déployez sur vos propres machines, et laissez un ingénieur DevOps IA veiller sur ce qui tourne.
**Auto-hébergé ou hébergé. Votre propre modèle. Aucune télémétrie.**

[![CI](https://github.com/CrowPus/Zelyq/actions/workflows/ci.yml/badge.svg)](https://github.com/CrowPus/Zelyq/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520.12-brightgreen.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)](./tsconfig.base.json)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-black.svg)](./CONTRIBUTING.md)

**[Site web](https://zelyq.dev)** · **[Essayer en ligne](https://app.zelyq.dev)** · [Démarrage rapide](#démarrage-rapide) ·
[Tutoriel](./docs/tutorial.md) · [Documentation](./docs/README.md) · [Auto-hébergement](./docs/self-hosting.md) ·
[Architecture](./docs/architecture.md) · [Feuille de route](./docs/roadmap.md) · [Contribuer](./CONTRIBUTING.md)

</div>

---

## Sommaire

- [Pourquoi Zelyq](#pourquoi-zelyq)
- [La plateforme](#la-plateforme) : [Apps](#apps), [Studio](#studio), [Agents](#agents), [Vault](#vault),
  [Pipelines](#pipelines), [Déploiements](#déploiements), [Ops](#ops)
- [Équipes, offres et langues](#équipes-offres-et-langues)
- [Démarrage rapide](#démarrage-rapide) et [mise à jour](#mise-à-jour)
- [Votre propre modèle](#votre-propre-modèle)
- [Comment ça marche](#comment-ça-marche)
- [Sécurité](#sécurité) · [État du projet](#état-du-projet) · [Contribuer](#contribuer) · [Licence](#licence)

---

## Pourquoi Zelyq

Livrer un logiciel demande d’habitude plusieurs produits : un générateur d’apps IA, un gestionnaire de
secrets, un service de CI, un outil de déploiement et quelqu’un d’astreinte. Autant de connexions,
de factures et d’endroits où une clé peut fuiter. Zelyq réunit tout le parcours dans une seule
plateforme, organisée comme le travail se fait :

| | Module | Ce qu’il fait |
| --- | --- | --- |
| **Créer** | **[Apps](#apps)** | Décrivez une app. Un agent la planifie, la construit dans de vrais fichiers qui vous appartiennent et la vérifie avant de dire qu’elle est terminée |
| | **[Studio](#studio)** | Générez des images et des vidéos, pour vos apps ou indépendamment |
| | **[Agents](#agents)** | Laissez Claude Code, Cursor, VS Code, Gemini CLI ou tout client MCP travailler dans Zelyq, avec son propre modèle |
| **Protéger** | **[Vault](#vault)** | Chaque identifiant enregistré une fois, chiffré, versionné et audité, utilisé par les apps, les pipelines et vos propres serveurs |
| **Livrer** | **[Pipelines](#pipelines)** | Testez et construisez toujours de la même façon, sur le serveur Zelyq ou vos propres machines Linux, macOS et Windows |
| | **[Déploiements](#déploiements)** | Mettez vos apps sur vos machines par environnement, avec approbations, gel et retour arrière automatique |
| | **[Ops](#ops)** | Un ingénieur DevOps IA à qui parler : il planifie, attend votre accord, prouve chaque changement et surveille ce qui tourne |

Tout appartient à une **équipe**. Invitez des personnes, donnez à chacune un rôle, et chaque module
le respecte.

---

## La plateforme

### Apps

Décrivez ce que vous voulez. L’agent lit, planifie, écrit des fichiers, lance des commandes et
démarre un aperçu en direct. Vous voyez chaque appel d’outil et chaque fichier qu’il touche pendant
qu’il travaille.

- **Vérifié, pas seulement généré.** Quand l’agent a fini, Zelyq lance la vérification de types ou
  la build du projet et contrôle que l’aperçu ne plante pas. Un tour qui a cassé quelque chose
  retourne à l’agent pour être corrigé, au lieu d’être annoncé comme terminé.
- **Clair sur ce qu’il sait.** Le *mode Ingénieur* sépare ce qui a été vérifié de ce qui a été
  supposé, cite l’alternative qu’il n’a pas retenue et demande avant toute action irréversible.
- **Il planifie avant de construire.** Le *mode Architecte* transforme une demande en une conception
  que vous pouvez relire (exigences, décisions, modèle de données, API, plan de construction) et
  attend votre feu vert. Le *mode Auto* exécute ensuite le plan seul, jusqu’à une limite fixée.
- **Des spécialistes à disposition.** Un designer (`DESIGN.md`), un ingénieur DevOps (CI,
  Dockerfile, configuration de déploiement), un ingénieur sécurité/QA (tests et analyse de
  sécurité) et un ingénieur cinématique (pages animées au défilement).
- **Full stack.** React + Vite, React avec un backend Python (FastAPI) ou Expo React Native, chacun
  partant d’un design system. Supabase Postgres avec sécurité au niveau des lignes pour chaque
  opération.
- **Partir de l’existant.** Importez un dépôt GitHub, reconstruisez un site en ligne avec
  `/clone <url>`, ou partez d’un cadre Figma et de ses design tokens avec `/figma <lien>`.
- **Chaque tour peut être annulé.** Un instantané avant chaque tour, un diff exact de ce qui a
  changé et un retour en un clic. Les projets sont des fichiers ordinaires sur disque, que vous
  pouvez emporter.

Voir [Modes](./docs/modes.md) et [comment l’agent se comporte](./docs/agent-behaviour.md).

### Studio

- **Image** : OpenAI, Google ou xAI, avec images de référence et bibliothèque privée.
- **Vidéo** : Google Veo ou xAI, à partir d’un texte ou d’une image fixe.

Studio utilise vos propres clés de fournisseur, facturées sur votre propre compte. Activez-le pour
un projet et l’agent peut créer visuels et séquences pour l’app qu’il construit, dans les limites
que vous fixez. Les clips peuvent être découpés en suites d’images pour des pages animées au
défilement. Voir [Studio : image](./docs/Image-gen/implementation.md) et
[Studio : vidéo](./docs/Video-gen/README.md).

### Agents

Apportez l’outil IA que vous utilisez déjà. Un **agent** permet à Claude Code, Cursor, VS Code,
Gemini CLI, ChatGPT ou tout client MCP de travailler dans Zelyq avec son propre modèle et son propre
abonnement. Zelyq ne lui donne accès qu’aux apps, pipelines et environnements que vous choisissez.

- **Des permissions réglées une à une** : désactivé, autorisé ou soumis à approbation, pour lire et
  écrire du code, lancer des commandes, pousser, les pipelines, les déploiements, Studio et plus.
- **Une personne approuve ce qui compte.** Les push, les exécutions de pipeline et les changements
  de déploiement sont des demandes qui attendent dans la boîte de réception.
- **Facile à annuler.** Un point d’annulation est pris avant que l’agent modifie une app.
- **Les valeurs secrètes ne sont jamais montrées.** L’agent voit quels secrets une app reçoit,
  uniquement par leur nom.

Voir [Agents](./docs/agents.md).

### Vault

Enregistrez chaque identifiant **une seule fois** et utilisez-le partout, sans le coller dans un
fichier.

- **Chiffré au repos** (AES-256-GCM), avec **historique des versions**, un indicateur **Protégé**
  pour les clés de production et une trace de chaque affichage et modification.
- **Utilisé par référence.** Les variables d’app, les clés de modèle, les pipelines et les
  environnements pointent vers `vault://NOM`. La valeur n’est fournie qu’où et quand elle est
  nécessaire.
- **Masqué dans les journaux.** Un secret qui arrive dans un journal de pipeline s’affiche `***`.
- **Vos propres serveurs aussi.** Récupérez les secrets avec une clé de service limitée, ou lancez
  `zelyq vault run -- <commande>` pour démarrer un processus avec eux, sans rien écrire sur disque.
- **Emménagez en important un `.env`.**

Voir [Vault](./docs/vault.md).

### Pipelines

Un pipeline est un court fichier YAML, ou un schéma que vous modifiez en cliquant. Les étapes
s’exécutent dans l’ordre, les pas aussi, et chaque pas est une commande ou un bloc prêt à l’emploi.

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

- **Il tourne où vous voulez.** Dans un conteneur jetable sur le serveur Zelyq, ou sur vos propres
  machines **Linux, macOS et Windows**. Une machine rejoint Zelyq avec une seule commande
  d’installation et se connecte vers l’extérieur en HTTPS : aucun port à ouvrir. Les machines
  jointes en SSH sont aussi prises en charge.
- **Rapide et souple.** Des étapes en parallèle, une machine différente par étape, des builds en
  matrice et des modèles partagés entre pipelines.
- **Plugins.** Empaquetez un pas une fois, avec ses entrées, ses secrets du Vault et ses sorties,
  puis utilisez-le dans n’importe quel pipeline. Voir [Plugins de pipeline](./docs/pipeline-plugins.md).
- **Déclenché par tout.** À la main, par un git push (avec filtres de chemins), une pull request,
  une planification, la fin d’un autre pipeline, un changement d’app par l’agent, ou toute CI munie
  d’une clé de service.
- **Tout ce qu’un vrai pipeline demande.** Installation d’outils et caches, conteneurs de service
  (Postgres, Redis), sorties de pas, rapports JUnit, artefacts, approbations, nouvelles tentatives,
  délais et contrôle de la concurrence.
- **Il rend compte.** ✓ / ✗ sur le commit et la pull request dans GitHub ou GitLab.

Voir [Pipelines](./docs/pipelines.md).

### Déploiements

- **Des environnements** comme `staging` et `production`, chacun sur une de vos machines, chacun
  avec ses propres variables. La clé de test sur staging, la clé de production sur production,
  toutes deux issues du Vault.
- **Déployez depuis un pipeline**, pour qu’une app soit testée avant d’être livrée. Zelyq construit
  l’image sur votre machine, à partir du `Dockerfile` de l’app ou d’un qu’il écrit pour Node, Python,
  Go et les sites statiques. Aucun registre nécessaire.
- **Retour arrière automatique.** Si la nouvelle version échoue à son contrôle de santé, la
  précédente revient d’elle-même.
- **Votre propre domaine en HTTPS**, sans interruption entre les versions.
- **Journaux en direct, CPU et mémoire**, redémarrage et arrêt, et retour en un clic à une version
  antérieure.
- **Promouvez** l’image exacte testée sur staging vers la production, sans la reconstruire.
- **Les environnements protégés** attendent l’accord d’un administrateur. **Le gel** bloque tous
  les déploiements pendant une mise en production.

Voir [Déployer](./docs/deploy.md).

### Ops

**Ops** est l’ingénieur DevOps de l’équipe. Demandez-lui, par écrit ou à voix haute, de mettre une
app en ligne, de livrer une nouvelle version, de configurer un domaine ou d’expliquer pourquoi
quelque chose est lent.

- **Il regarde d’abord et montre un plan.** Ops observe librement, mais chaque changement est une
  liste d’étapes précises qui attend votre accord. Une étape irréversible est confirmée à part.
- **Il prouve chaque changement.** Zelyq vérifie lui-même le résultat. Une étape ne compte comme
  faite que lorsque son contrôle réussit.
- **Il ne cesse jamais de surveiller.** Sites et apps vérifiés chaque minute, machines toutes les
  cinq minutes, certificats et domaines chaque jour, sans utiliser de modèle. Les alertes vous
  parviennent par e-mail, Telegram, Slack ou Discord.
- **Il n’atteint que ce que vous lui confiez.** Un administrateur lui attribue environnements,
  machines, pipelines et code, un par un, avec un niveau de confiance pour chacun. Il voit les noms
  des secrets, jamais leurs valeurs.
- **Il se souvient.** Les règles que vous lui donnez et les leçons tirées des incidents sont
  conservées et relues avant chaque tâche.
- **Vous gardez la main.** Une limite de dépenses mensuelle, et **Mettre Ops en pause** arrête tout
  immédiatement.

---

## Équipes, offres et langues

| Rôle | Peut |
| --- | --- |
| `viewer` | Voir les apps, les fichiers, les exécutions, les environnements et l’historique des déploiements |
| `editor` | Tout ce qui précède, plus solliciter l’agent, lancer des pipelines et déployer |
| `admin` | Tout ce qui précède, plus les membres, les agents, les environnements, les approbations et les secrets protégés |
| `owner` | Contrôle total, y compris sur l’équipe elle-même |

- **Activité.** Chaque changement est consigné dans l’Activité de l’équipe : un secret affiché, un
  pipeline modifié, un déploiement annulé.
- **Offres et utilisation.** Chaque équipe a des limites pour les apps, le stockage, les exécutions
  de pipeline, les membres et les aperçus, fixées par l’administrateur du serveur.
- **Faire tourner Zelyq pour d’autres.** Le [mode géré](./docs/managed-mode.md) place la connexion
  derrière votre propre service de comptes, et l’[API d’administration](./docs/admin-api.md)
  permet à vos systèmes de gérer personnes, équipes, offres et état de santé.
- **Neuf langues.** L’interface et son aide intégrée existent en anglais, français, allemand,
  espagnol, portugais, chinois, hindi, italien et japonais, au choix de chaque personne.
- **Les apps inactives dorment.** Les apps que personne n’a ouvertes depuis un moment peuvent
  rejoindre un bucket compatible S3 ou un dossier, et se réveillent seules à l’ouverture. Voir
  [Stockage](./docs/storage.md).

---

## Démarrage rapide

**Le plus rapide :** créez un compte sur **[app.zelyq.dev](https://app.zelyq.dev)**. Il existe une
offre gratuite, et rien à installer.

**Pour l’héberger vous-même :**

```bash
# Requires Node >= 20.12 and pnpm >= 9
git clone https://github.com/CrowPus/Zelyq.git
cd Zelyq
cp .env.example .env    # your configuration: check it before the first start (below)
pnpm install
pnpm dev                # web :5173 · server :8787 · agent :8788
```

Ouvrez <http://localhost:5173> et créez le premier compte : il administre l’instance. Ajoutez la
clé de votre modèle dans **Paramètres → Modèle** (saisie ou depuis le Vault), ouvrez **Apps**,
créez une app et décrivez ce que vous voulez.

**Sur une VM ou un serveur distant**, modifiez ces réglages dans `.env` avant le premier démarrage.
Remplacez `203.0.113.10` par l’adresse ou le domaine de votre machine :

| Réglage | Valeur | Pourquoi |
| --- | --- | --- |
| `ZELYQ_WEB_HOST` | `0.0.0.0` | Sinon l’interface ne répond que sur la machine elle-même |
| `ZELYQ_PREVIEW_HOST` | `203.0.113.10` | Sinon les aperçus d’apps refusent votre navigateur |
| `ZELYQ_CORS_ORIGIN` | `http://203.0.113.10:5173` | L’adresse à laquelle vous ouvrez Zelyq |
| `ZELYQ_PUBLIC_URL` | `http://203.0.113.10:5173` | Utilisée dans les liens de webhook et de connexion |
| `ZELYQ_ALLOW_REGISTRATION` | `false`, une fois votre compte créé | Sinon n’importe qui trouvant l’adresse peut s’inscrire |

Ouvrez le port 5173 et les ports d’aperçu (`ZELYQ_PREVIEW_PORT_MIN`–`MAX`, 4300–4399 par défaut)
dans le pare-feu. Sur une machine joignable depuis Internet, placez Zelyq derrière HTTPS : voir
[Auto-hébergement](./docs/self-hosting.md). Tous les autres réglages sont expliqués dans
`.env.example` et dans [Configuration](./docs/configuration.md).

**Avec Docker :** `docker compose -f docker/docker-compose.yml up`. Voir
[Auto-hébergement](./docs/self-hosting.md).

**Ensuite :** le [tutoriel](./docs/tutorial.md) mène une app de Zelyq à la production, pas à pas :
Vault, un pipeline, votre propre machine, un déploiement avec retour arrière, et les push et pull
requests GitHub.

### Mise à jour

Vos données restent où elles sont. La base de données, les médias générés et la clé de chiffrement
sont dans `data/`, vos apps dans `workspace/` et vos réglages dans `.env`. Git ignore les trois, et
le serveur applique lui-même les changements de base de données au démarrage.

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

Lancez ces commandes avec l’utilisateur qui a cloné Zelyq. Si Git s’arrête avec
`detected dubious ownership`, passez à cet utilisateur avec `su - <utilisateur>` plutôt que
d’ajouter une exception `safe.directory`.

Avec Docker : `git pull`, puis `docker compose -f docker/docker-compose.yml up -d --build`. Vos
données sont dans le volume `zelyq-data` : ne lancez **jamais** `docker compose down -v`, qui le
supprime.

Plus de détails, y compris pour PostgreSQL :
[Auto-hébergement → Mise à niveau](./docs/self-hosting.md#upgrading).

---

## Votre propre modèle

| Fournisseur | `ZELYQ_PROVIDER` | Modèle par défaut |
| --- | --- | --- |
| Claude | `anthropic` | `claude-opus-5-5` |
| Gemini | `google` | `gemini-pro-latest` |
| OpenAI | `openai` | `gpt-6.1-terra` |
| Grok (xAI) | `xai` | `grok-4.6` |
| DeepSeek | `deepseek` | `deepseek-v4-flash` |
| Mistral | `mistral` | `mistral-large-latest` |
| Groq | `groq` | `llama-3.3-70b-versatile` |
| OpenRouter | `openrouter` | `anthropic/claude-sonnet-4.6` |
| **Le vôtre** : Ollama, vLLM, LM Studio, tout ce qui est compatible OpenAI | `custom` | réglez `ZELYQ_MODEL` |

Réglez les clés dans **Paramètres → Modèle**, saisies ou depuis le Vault, ou laissez chaque équipe
apporter les siennes dans **Paramètres de l’équipe → Clés IA**. Une connexion Claude Code ou Codex
peut remplacer une clé API. Avec `custom`, rien de vos projets ne quitte votre réseau. Voir
[Configuration](./docs/configuration.md).

---

## Comment ça marche

Trois processus et un outil en ligne de commande, bâtis sur quatre bibliothèques partagées. Les
fichiers et commandes d’une app ne sont accessibles que par un seul chemin, le `RuntimeDriver` :
c’est ce qui fait fonctionner de la même façon le mode local, le conteneur et l’hôte distant.

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

| Partie | Rôle |
| --- | --- |
| [`apps/web`](./apps/web) | L’interface : chat, éditeur et aperçu, Studio, Vault, Pipelines, Déploiements, Ops |
| [`apps/server`](./apps/server) | Équipes, apps, Vault, le moteur de pipelines, les déploiements et Ops ; le seul processus qui parle à la base de données |
| [`apps/agent`](./apps/agent) | La boucle du modèle. Il ne touche jamais lui-même aux fichiers : chaque outil passe par le `RuntimeDriver` |
| [`apps/runner`](./apps/runner) | Le runner installé sur vos machines ; il se connecte à Zelyq et exécute pipelines et déploiements |
| [`apps/cli`](./apps/cli) | La ligne de commande `zelyq`, par ex. `zelyq vault run` |
| [`apps/registry`](./apps/registry) | Le registre de plugins signés |
| [`@zelyq/core`](./packages/core) | Types du domaine, format des fichiers de pipeline et protocole d’échange |
| [`@zelyq/runtime`](./packages/runtime) | `RuntimeDriver` et ses implémentations ; le seul code qui lance des processus |
| [`@zelyq/db`](./packages/db) | Schéma Drizzle et migrations : SQLite par défaut, PostgreSQL pour monter en charge |
| [`@zelyq/tools`](./packages/tools) | Les outils de l’agent, écrits une fois pour le `RuntimeDriver` |

Tous les détails : [Architecture](./docs/architecture.md).

---

## Sécurité

Zelyq est fait pour être inspecté : un stockage simple, des fichiers ordinaires, aucune télémétrie,
et des secrets chiffrés au repos, jamais passés en ligne de commande ni écrits dans un journal.
Connaissez ces limites avant de déployer :

- **Le mode d’exécution `local` n’est pas un bac à sable.** Les commandes de l’agent s’exécutent
  avec l’utilisateur du serveur. Réservez-le à un développeur de confiance sur une seule machine.
  Pour tout usage partagé ou exposé à Internet, réglez `ZELYQ_RUNTIME=container`.
- **Le réseau sortant du mode conteneur est ouvert par défaut.** Il bloque toujours le point de
  métadonnées du cloud et le trafic entre projets. Réglez `ZELYQ_CONTAINER_EGRESS_ALLOWLIST` pour
  restreindre le reste, ou utilisez le [bac à sable strict](./docs/strict-sandbox.md) pour du code
  non fiable.

Lisez le [modèle de menaces](./SECURITY.md#threat-model--read-this-before-deploying) avant de
déployer, et signalez les vulnérabilités en privé comme décrit dans [SECURITY.md](./SECURITY.md).

## État du projet

Zelyq est **jeune et avance vite**. Apps, Studio, Agents, Vault, Pipelines, Déploiements et Ops
fonctionnent de bout en bout et servent au quotidien. Attendez-vous à des changements incompatibles
avant la `1.0`. Voir la [feuille de route](./docs/roadmap.md).

## Contribuer

Les issues, discussions et pull requests sont les bienvenues. [CONTRIBUTING.md](./CONTRIBUTING.md)
décrit la boucle de développement, l’organisation du dépôt et où une modification a généralement sa
place. Avant d’ouvrir une pull request, lancez `pnpm lint`, `pnpm typecheck` et `pnpm test`. Toute
personne qui participe suit le [code de conduite](./CODE_OF_CONDUCT.md).

## Licence

Zelyq est **open source** sous [GNU AGPL-3.0](./LICENSE) : exécutez-le, modifiez-le,
auto-hébergez-le, forkez-le. Si vous proposez un Zelyq *modifié* comme service à d’autres via un
réseau, l’AGPL vous oblige à leur fournir votre code source.

Une **licence commerciale** (le même code sans l’obligation de fournir le source en réseau) est
disponible pour les produits propriétaires et les organisations dont la politique exclut les
logiciels AGPL : **support@dee-empire.com**. Les fonctionnalités marquées « Zelyq Enterprise »
(chemins `ee/`) relèvent d’un abonnement séparé sous la
[licence Zelyq Enterprise](./LICENSE_EE.md). [LICENSING.md](./LICENSING.md) l’explique simplement.
Les versions jusqu’à `v0.1.0` incluse restent disponibles sous Apache-2.0.

<div align="center">
<br />

© 2026 [Dee Empire](https://dee-empire.com) · « Zelyq » et le logo Zelyq sont des marques de Dee Empire.

</div>
