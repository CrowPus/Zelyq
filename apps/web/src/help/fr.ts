import type { Articles } from "./articles";

export const articles: Articles = {
  start: {
    title: "Se repérer dans Zelyq",
    body: `Zelyq s’organise par **équipe**. Tout ce qu’une équipe crée (ses apps, pipelines, environnements et secrets) lui appartient, et tous ses membres peuvent le voir.

- **Barre latérale.** À gauche : **Accueil**, puis **Build** (Apps, Studio, Agents), **Livrer** (Pipelines, Déploiements, Ops) et **Sécurisé** (Vault). Dans une app, la barre latérale liste plutôt les sections de cette app.
- **Barre du haut.** Le sélecteur d’équipe et le fil d’Ariane indiquent où vous êtes. La recherche (**Ctrl K** ou **⌘ K**) trouve n’importe quelle app, pipeline ou environnement, et mène à n’importe quelle page, Vault et paramètres compris.
- **Boîte de réception.** La cloche rassemble ce qui vous attend, comme un déploiement ou la demande d’un agent à approuver.
- **Aide.** Le menu **?** ouvre ces articles, les raccourcis clavier et le guide complet du débutant.

L’**Accueil** montre d’abord ce qui demande votre attention : ce qui échoue ou vous attend, puis vos apps et exécutions récentes.

Changez d’équipe depuis son nom en haut à gauche. Votre compte, votre langue et votre sécurité se trouvent sous votre photo, en haut à droite.`,
  },
  apps: {
    title: "Apps",
    body: `Une **app** est un projet que l’agent construit avec vous : un site, une application web, une API ou une app mobile. Chacune a ses propres fichiers, son propre aperçu et son propre historique.

**Créez-en une** avec **Nouvelle app**. Choisissez un point de départ (une **stack**, comme React + Vite ou FastAPI), donnez-lui un nom et décrivez ce que vous voulez.

**Retrouvez-en une** avec le champ de recherche (appuyez sur **/** pour y aller), ou filtrez par statut et par stack. Passez des cartes à une liste avec les boutons à droite ; la liste se trie par n’importe quelle colonne.

**Ouvrez une app** pour continuer à la construire. Sa **Vue d’ensemble** montre son aperçu, où elle est en ligne et ses détails ; ses **Paramètres** contiennent son nom et ce que l’agent peut faire.

Les apps appartiennent à l’équipe : chaque membre peut les ouvrir. Ce que chacun peut modifier dépend de son rôle (voir **Membres et rôles**).`,
  },
  build: {
    title: "Construire avec l’agent",
    body: `C’est ici qu’une app se fabrique. À gauche, vous parlez à l’agent ; à droite, vous voyez le résultat.

- **Discussion.** Décrivez ce que vous voulez avec des mots simples. L’agent travaille dans un vrai espace de travail : chaque modification est un fichier que vous pouvez lire dans **Code**.
- **Aperçu.** Une copie privée de l’app, qui tourne ici. Avec l’inspecteur, désignez un élément et demandez une modification précise.
- **Modes.** Les boutons sous la zone de message activent **Architecte** (planifie d’abord tout le projet), **Ingénieur** (modifications prudentes et vérifiées) et **Auto** (continue jusqu’à ce que le travail soit fini).
- **Menu /.** Tapez **/** pour les commandes comme **/clone** et **/figma**, les agents spécialistes (Designer, DevOps, Sécurité/QA), les skills et les modèles.

**Annuler.** **Instantanés** garde un point de restauration avant chaque modification : vous pouvez revenir à n’importe quelle version antérieure.

**Variables** contient les réglages et les clés de l’app ; une valeur peut venir de Vault pour être gardée à un seul endroit. **Git** enregistre et envoie le code de l’app vers un dépôt que vous connectez.

Quand tout fonctionne, appuyez sur **Déployer** pour la mettre en ligne, ou créez un pipeline qui la teste et la déploie à chaque modification.`,
  },
  "app-settings": {
    title: "Vue d’ensemble et paramètres d’une app",
    body: `La **Vue d’ensemble** présente l’app d’un coup d’œil : son aperçu en direct, les environnements où elle tourne et leurs adresses, et des détails comme sa stack, son identifiant et sa dernière modification.

Les **Paramètres** servent à modifier l’app elle-même :

- **Nom de l’app.** Affiché dans la liste des apps, le fil d’Ariane et l’onglet du navigateur.
- **Ce que l’agent peut faire.** Générer des images et générer des vidéos coûtent chacun de l’argent sur les clés d’IA de l’équipe ; les deux sont donc désactivés au départ. Activez-les ici.
- **Zone de danger.** Supprimer une app efface ses fichiers, son aperçu et son historique.

Ce que chacun peut modifier dépend de son rôle dans l’équipe.`,
  },
  pipelines: {
    title: "Pipelines",
    body: `Un **pipeline** teste, construit et déploie une app, chaque fois de la même façon. C’est un fichier d’**étapes** (stages) qui s’exécutent dans l’ordre ; chaque étape contient des **pas** (commandes, récupération du code, cache, déploiement).

**Créez-en un** avec **Nouveau pipeline** et un modèle. Modifiez-le en **Visuel** (cliquez sur les blocs et les champs) ou en **YAML** (le fichier lui-même) : les deux montrent le même pipeline.

- **S’exécute sur.** \`local\` l’exécute sur le serveur Zelyq, dans un conteneur jeté ensuite. Un **runner** est l’une de vos machines, ajoutée dans **Runners** et jointe en SSH.
- **Source.** D’où viennent les fichiers : une app dans Zelyq, un dépôt GitHub ou un dossier sur une machine.
- **Secrets.** N’écrivez jamais une clé dans le fichier. Utilisez \`vault://NOM\` et Zelyq la remplit ; les secrets sont masqués dans tous les journaux.
- **Déclencheurs.** Lancez-le à la main, selon un horaire, ou à chaque push et pull request depuis GitHub.

Chaque pipeline garde ses versions : un fichier antérieur peut être restauré. Les **plugins** ajoutent des étapes toutes prêtes.`,
  },
  runs: {
    title: "Lire l’exécution d’un pipeline",
    body: `Une exécution est un passage d’un pipeline. Le diagramme montre chaque **étape** comme un bloc, reliés dans leur ordre d’exécution ; les étapes côte à côte s’exécutent en même temps.

- **Couleurs.** Vert : réussi. Rouge : échoué. Bleu : en cours. Gris : en attente ou ignoré.
- **Pas et sortie.** Cliquez sur une étape pour voir ses pas. Cliquez sur un pas pour lire ce qu’il a affiché. Si un pas a échoué, les dernières lignes de sa sortie disent généralement pourquoi.
- **En attente d’approbation.** Un déploiement vers un environnement protégé s’arrête jusqu’à ce qu’un admin appuie sur **Approuver**. Il apparaît aussi dans la boîte de réception.

**Relancer** exécute à nouveau le même fichier. **Annuler** arrête une exécution en cours ; ce qu’elle a déjà déployé reste tel quel.

Une exécution indique qui ou quoi l’a lancée (une personne, un horaire, un push) et la durée de chaque étape.`,
  },
  deployments: {
    title: "Déploiements et environnements",
    body: `Un **environnement** est un endroit où une app tourne : \`staging\` ou \`production\`, sur l’une de vos machines. **Déploiements** liste chaque environnement avec les apps en ligne, leur version, depuis quand et qui les y a mises.

- **Déployer.** L’étape de déploiement d’un pipeline, ou le bouton **Déployer** d’une app, démarre l’app dans Docker sur la machine, vérifie qu’elle répond et garde la version précédente sinon.
- **Journaux et contrôles.** Sur la carte d’une app, **Journaux · gérer** montre sa sortie en direct avec son processeur et sa mémoire, ainsi que **Redémarrer** et **Arrêter**.
- **Revenir en arrière.** **Historique** liste chaque déploiement ; **Revenir à celui-ci** remet une version antérieure en quelques secondes.
- **Protégé.** Chaque déploiement vers un environnement protégé attend l’approbation d’un admin. **Geler** bloque tous les déploiements pendant une mise en production.
- **Adresses.** Donnez un domaine à une app et Zelyq lui obtient un certificat HTTPS gratuit.

Les **Variables** d’un environnement sont transmises à chaque app qui s’y trouve, et peuvent venir de Vault.`,
  },
  vault: {
    title: "Vault",
    body: `**Vault** garde une seule fois, chiffrés, les clés et mots de passe de l’équipe, pour les utiliser partout sans les copier : dans les Variables d’une app, dans les paramètres, dans les pipelines (\`vault://NOM\`) ou depuis vos propres serveurs.

- **Ajoutez un secret** avec un nom comme \`STRIPE_KEY_LIVE\`, sa valeur et une note sur son usage. **Importer un .env** en ajoute plusieurs d’un coup.
- **Le tableau** montre chaque secret, où il est utilisé, sa dernière modification et son auteur. Au-delà de cinq secrets, recherchez-y ou n’affichez que les secrets protégés ou inutilisés.
- **Afficher ou copier une valeur** depuis le menu de la ligne. Une confirmation vous est demandée, et l’action est enregistrée dans **Activité** à votre nom.
- **Modifier la valeur** enregistre une nouvelle version ; **Historique** liste toutes les versions et peut en restaurer une antérieure. Tout ce qui utilise le secret reçoit la nouvelle valeur.
- Les secrets **protégés** ne peuvent être affichés, modifiés ou utilisés que par les admins et les propriétaires. Utilisez-le pour les clés de production.

Les **clés de service** permettent à un serveur hors de Zelyq de lire les secrets qui lui sont permis, et rien d’autre.`,
  },
  members: {
    title: "Membres et rôles",
    body: `Chaque membre d’une équipe voit toutes ses apps. Son **rôle** décide de ce qu’il peut modifier :

- **Lecteur** lit les apps, leurs fichiers et les conversations, sans rien modifier.
- **Éditeur** peut aussi construire, modifier et lancer des aperçus.
- **Admin** gère aussi les membres, les agents et les paramètres de l’équipe, et supprime des apps.
- **Propriétaire** a tous les droits, y compris sur l’équipe elle-même.

**Ajoutez quelqu’un** par e-mail. Une personne qui a déjà un compte rejoint l’équipe tout de suite ; les autres reçoivent une invitation valable 7 jours, si l’e-mail est configuré sur ce serveur. **En attente d’adhésion** liste les invitations pas encore utilisées.

**Le tableau** se trie, et se recherche dès que l’équipe compte plus de cinq personnes. **Dernière activité** montre quand chacun a utilisé Zelyq pour la dernière fois. Les admins changent un rôle directement ; le menu de la ligne retire quelqu’un, ou vous permet de partir.

**Qui a modifié quoi** liste chaque changement dans l’équipe : qui a été ajouté ou retiré, quel rôle a changé et par qui.`,
  },
  agents: {
    title: "Agents externes",
    body: `Un **agent** permet à un outil d’IA externe (Claude Code, Cursor, VS Code, Gemini CLI ou tout outil qui parle MCP) de travailler dans Zelyq, avec son propre modèle et son propre abonnement. Zelyq lui donne la main sur les apps, pipelines et environnements que vous choisissez, et rien d’autre.

**Créez-en un** avec **Nouvel agent** : donnez-lui un nom et une mission (la première chose qu’il lit), cochez ce qu’il peut toucher, et réglez chaque permission sur **Désactivé**, **Autorisé** ou **Nécessite une approbation**.

- Lire et écrire du code crée d’abord un point de retour, pour pouvoir annuler son travail.
- Envoyer du code, lancer des pipelines et modifier des déploiements sont toujours des demandes qu’une personne approuve, dans la boîte de réception.
- Il voit quels secrets une app reçoit, jamais leurs valeurs.

La clé n’est affichée qu’une fois. Copiez depuis la page la configuration pour votre outil, et remplacez ou révoquez la clé à tout moment. Seuls les admins et les propriétaires gèrent les agents.`,
  },
  ops: {
    title: "Ops, votre ingénieur DevOps",
    body: `**Ops** s’occupe des machines, des environnements et des apps de l’équipe. Parlez-lui comme à un collègue : demandez pourquoi quelque chose est lent, ce qui a changé, ou de le réparer.

- **Parler.** Écrivez, ou appuyez sur le micro et parlez ; il répond à voix haute.
- **Plans.** Ops regarde librement, mais chaque modification est un plan d’étapes précises. **Approuver** lui permet de faire ces étapes et rien d’autre ; **Rejeter** avec une raison, et il s’en souvient.
- **Statut.** Vérifié chaque minute par Zelyq lui-même, sans IA et sans coût.
- **Alertes.** Ce qui a mal tourné, quand, et ce qu’Ops a fait.
- **Mémoire.** Des règles qu’il lit avant chaque tâche, comme « ne jamais déployer le vendredi après-midi ». La parole d’une personne prime sur ses propres conclusions.
- **Accès.** Les machines et environnements qu’il peut atteindre, et le niveau de confiance pour chacun.

Les **Paramètres** contiennent sa limite de dépenses mensuelle, et **Mettre Ops en pause** arrête d’un coup tout ce qu’il fait.`,
  },
  studio: {
    title: "Studio",
    body: `**Studio** crée des images et des vidéos pour vos apps.

- **Image.** Décrivez l’image, choisissez un modèle et une taille, et ajoutez des images de référence si le modèle les accepte. Chaque résultat est gardé dans l’historique des images.
- **Vidéo.** Décrivez une scène, ou animez une image à partir de son image de départ. Un clip prend quelques minutes et coûte bien plus qu’une image.
- **L’utiliser.** Téléchargez un résultat, ou choisissez-le dans Studio pendant que vous construisez une app.

Studio utilise les propres clés d’image et de vidéo de l’équipe, définies dans **Paramètres de l’équipe**. Si aucun modèle n’est proposé, un admin doit d’abord ajouter une clé.`,
  },
  "team-settings": {
    title: "Paramètres de l’équipe",
    body: `Tout ce qu’une équipe décide pour elle-même, regroupé dans le menu de gauche. Les admins et les propriétaires les modifient.

- **Utilisation et plan.** Ce que l’équipe utilise : apps, stockage, builds, et sa proximité avec ses limites.
- **Clés d’IA.** Les propres clés de l’équipe pour les modèles qui construisent les apps, Studio et la voix. Une clé peut venir du Vault de l’équipe.
- **Construction des apps.** Le modèle qu’utilise l’agent et l’intensité de sa réflexion.
- **Image Studio, Video Studio, Saisie vocale.** Les modèles et options de chacun.
- **Ops.** Si l’ingénieur DevOps de l’équipe est actif, et ses limites.
- **E-mail.** Le propre serveur de messagerie de l’équipe, pour les e-mails que Zelyq envoie en son nom.
- **Intégrations.** GitHub, Figma, Supabase et d’autres.
- **Accès du support.** Laissez le support de Zelyq consulter l’équipe pendant 48 heures ; chaque consultation est enregistrée.

Une modification s’applique à toute l’équipe dès qu’elle est enregistrée.`,
  },
  account: {
    title: "Votre compte",
    body: `Votre compte vous suit dans toutes vos équipes.

- **Profil.** Votre nom et l’e-mail avec lequel vous vous connectez. **Supprimer le compte** le supprime définitivement.
- **Sécurité.** Changez votre mot de passe (tous les autres appareils sont déconnectés). Activez la **connexion en deux étapes** avec une app d’authentification, et gardez les codes de récupération en lieu sûr. **Appareils connectés** liste chaque navigateur qui utilise votre compte ; déconnectez celui que vous voulez.
- **Préférences.** Votre langue (anglais, français, allemand, espagnol, portugais ou chinois), votre fuseau horaire et la façon d’écrire les dates et les nombres. Chaque appareil sur lequel vous vous connectez les suit.

Le thème (clair, sombre ou comme le système) se trouve dans le menu sous votre photo.`,
  },
  admin: {
    title: "Administration du serveur",
    body: `L’administration du serveur s’adresse aux personnes qui gèrent ce serveur Zelyq. Elle change les choses pour toutes les équipes.

- **Modèles et IA.** Le fournisseur auquel parle l’agent, la génération d’images et de vidéos, la saisie vocale, et le modèle avec lequel Ops réfléchit.
- **Exécution et aperçu.** Où s’exécutent les commandes des apps, comment on atteint les aperçus, et les réglages par défaut des pipelines.
- **Identité et accès.** Qui peut se connecter et pour combien de temps, les comptes de ce serveur, et les clés d’API d’administration.
- **Communication.** Le serveur de messagerie par lequel Zelyq envoie ses e-mails, et les intégrations.
- **Plans.** Ce que chaque équipe peut utiliser.
- **État de l’instance.** La santé du serveur et de ses composants.

Chaque équipe peut toujours choisir ses propres clés et modèles dans ses **Paramètres de l’équipe** ; ceux du serveur sont les valeurs par défaut.`,
  },
};
