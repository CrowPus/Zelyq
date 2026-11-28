import type { Articles } from "./articles";

export const articles: Articles = {
  start: {
    title: "Sich in Zelyq zurechtfinden",
    body: `Zelyq ist nach **Teams** organisiert. Alles, was ein Team erstellt (seine Apps, Pipelines, Umgebungen und Secrets), gehört ihm, und alle im Team können es sehen.

- **Seitenleiste.** Links: **Start**, dann **Build** (Apps, Studio, Agenten), **Ausliefern** (Pipelines, Bereitstellungen, Ops) und **Sicher** (Vault). In einer App zeigt die Seitenleiste stattdessen die Bereiche dieser App.
- **Obere Leiste.** Teamauswahl und Pfadnavigation zeigen, wo Sie sind. Die Suche (**Strg K** oder **⌘ K**) findet jede App, Pipeline und Umgebung und führt zu jeder Seite, auch zu Vault und den Einstellungen.
- **Posteingang.** Die Glocke sammelt, was auf Sie wartet, etwa eine Bereitstellung oder die Anfrage eines Agenten zur Freigabe.
- **Hilfe.** Das Menü **?** öffnet diese Artikel, die Tastenkürzel und den vollständigen Einsteigerleitfaden.

**Start** zeigt zuerst, was Ihre Aufmerksamkeit braucht: was fehlschlägt oder auf Sie wartet, dann Ihre letzten Apps und Ausführungen.

Das Team wechseln Sie über seinen Namen oben links. Ihr Konto, Ihre Sprache und Ihre Sicherheit finden Sie unter Ihrem Bild oben rechts.`,
  },
  apps: {
    title: "Apps",
    body: `Eine **App** ist ein Projekt, das der Agent mit Ihnen baut: eine Website, eine Web-App, eine API oder eine mobile App. Jede hat ihre eigenen Dateien, ihre eigene Vorschau und ihren eigenen Verlauf.

**Legen Sie eine an** mit **Neue App**. Wählen Sie einen Ausgangspunkt (einen **Stack**, etwa React + Vite oder FastAPI), geben Sie ihr einen Namen und beschreiben Sie, was Sie möchten.

**Finden Sie eine** über das Suchfeld (mit **/** springen Sie hinein) oder filtern Sie nach Status und Stack. Mit den Schaltflächen rechts wechseln Sie zwischen Karten und Liste; die Liste lässt sich nach jeder Spalte sortieren.

**Öffnen Sie eine App**, um weiterzubauen. Ihre **Übersicht** zeigt die Vorschau, wo sie live ist, und ihre Details; in den **Einstellungen** stehen ihr Name und was der Agent darf.

Apps gehören dem Team: Alle im Team können sie öffnen. Was jemand ändern darf, hängt von seiner Rolle ab (siehe **Mitglieder und Rollen**).`,
  },
  build: {
    title: "Mit dem Agenten bauen",
    body: `Hier entsteht eine App. Links sprechen Sie mit dem Agenten, rechts sehen Sie das Ergebnis.

- **Chat.** Beschreiben Sie in einfachen Worten, was Sie möchten. Der Agent arbeitet in einem echten Arbeitsbereich: Jede Änderung ist eine Datei, die Sie unter **Code** lesen können.
- **Vorschau.** Eine private Kopie der App, die hier läuft. Mit dem Inspektor zeigen Sie auf etwas und bitten genau dort um eine Änderung.
- **Modi.** Die Schaltflächen unter dem Eingabefeld schalten **Architekt** (plant zuerst das ganze Projekt), **Engineer** (sorgfältige, geprüfte Änderungen) und **Auto** (arbeitet weiter, bis alles fertig ist) ein.
- **Menü /.** Tippen Sie **/** für Befehle wie **/clone** und **/figma**, Spezialagenten (Designer, DevOps, Sicherheit/QA), Skills und Modelle.

**Rückgängig.** **Snapshots** legt vor jeder Änderung einen Wiederherstellungspunkt an, sodass Sie zu jeder früheren Version zurückkehren können.

**Variablen** enthält die Einstellungen und Schlüssel der App; ein Wert kann aus dem Vault kommen und so an einer Stelle gepflegt werden. **Git** committet und pusht den Code der App in ein Repository, das Sie verbinden.

Wenn alles läuft, drücken Sie **Bereitstellen**, um sie online zu bringen, oder richten Sie eine Pipeline ein, die sie bei jeder Änderung testet und bereitstellt.`,
  },
  "app-settings": {
    title: "Übersicht und Einstellungen einer App",
    body: `Die **Übersicht** zeigt die App auf einen Blick: ihre Live-Vorschau, die Umgebungen, in denen sie läuft, mit ihren Adressen, und Details wie Stack, ID und letzte Änderung.

In den **Einstellungen** ändern Sie die App selbst:

- **App-Name.** Erscheint in der App-Liste, in der Pfadnavigation und im Browser-Tab.
- **Was der Agent darf.** Bilder erzeugen und Videos erzeugen kosten jeweils Geld über die KI-Schlüssel des Teams, deshalb sind beide zunächst aus. Hier schalten Sie sie ein.
- **Gefahrenbereich.** Das Löschen einer App entfernt ihre Dateien, ihre Vorschau und ihren Verlauf.

Was jemand ändern darf, hängt von seiner Rolle im Team ab.`,
  },
  pipelines: {
    title: "Pipelines",
    body: `Eine **Pipeline** testet, baut und stellt eine App bereit, jedes Mal auf dieselbe Weise. Sie ist eine Datei mit **Stufen**, die nacheinander laufen; jede Stufe hat **Schritte** (Befehle, Checkout, Cache, Bereitstellung).

**Legen Sie eine an** mit **Neue Pipeline** und einer Vorlage. Bearbeiten Sie sie **Visuell** (Kästen und Felder anklicken) oder als **YAML** (die Datei selbst); beide zeigen dieselbe Pipeline.

- **Läuft auf.** \`local\` führt sie auf dem Zelyq-Server aus, in einem Container, der danach verworfen wird. Ein **Runner** ist einer Ihrer eigenen Rechner, unter **Runner** hinzugefügt und per SSH erreicht.
- **Quelle.** Woher die Dateien kommen: eine App in Zelyq, ein GitHub-Repository oder ein Ordner auf einem Rechner.
- **Secrets.** Schreiben Sie nie einen Schlüssel in die Datei. Verwenden Sie \`vault://NAME\`, Zelyq setzt ihn ein; Secrets werden in jedem Log maskiert.
- **Auslöser.** Starten Sie sie von Hand, nach Zeitplan oder bei jedem Push und Pull Request von GitHub.

Jede Pipeline behält ihre Versionen, eine frühere Datei lässt sich wiederherstellen. **Plugins** fügen fertige Schritte hinzu.`,
  },
  runs: {
    title: "Eine Pipeline-Ausführung lesen",
    body: `Eine Ausführung ist ein Durchlauf einer Pipeline. Das Diagramm zeigt jede **Stufe** als Kasten, verbunden in der Reihenfolge, in der sie laufen; nebeneinanderliegende Stufen laufen gleichzeitig.

- **Farben.** Grün bestanden, Rot fehlgeschlagen, Blau läuft, Grau wartet oder übersprungen.
- **Schritte und Ausgabe.** Klicken Sie auf eine Stufe, um ihre Schritte zu sehen, und auf einen Schritt, um seine Ausgabe zu lesen. Ist ein Schritt fehlgeschlagen, sagen die letzten Zeilen seiner Ausgabe meist, warum.
- **Wartet auf Freigabe.** Eine Bereitstellung in eine geschützte Umgebung hält an, bis ein Admin **Freigeben** drückt. Sie erscheint auch im Posteingang.

**Erneut ausführen** startet dieselbe Datei noch einmal. **Abbrechen** stoppt eine laufende Ausführung; was sie schon bereitgestellt hat, bleibt, wie es ist.

Eine Ausführung hält fest, wer oder was sie gestartet hat (eine Person, ein Zeitplan, ein Push) und wie lange jede Stufe gedauert hat.`,
  },
  deployments: {
    title: "Bereitstellungen und Umgebungen",
    body: `Eine **Umgebung** ist ein Ort, an dem eine App läuft: \`staging\` oder \`production\`, auf einem Ihrer Rechner. **Bereitstellungen** zeigt jede Umgebung mit den Apps, die dort live sind: welche Version, seit wann und wer sie bereitgestellt hat.

- **Bereitstellen.** Der Bereitstellungsschritt einer Pipeline oder die Schaltfläche **Bereitstellen** einer App startet die App in Docker auf dem Rechner, prüft, ob sie antwortet, und behält sonst die vorherige Version.
- **Logs und Steuerung.** Auf der Karte einer App zeigt **Logs · verwalten** ihre Live-Ausgabe mit CPU und Arbeitsspeicher, dazu **Neu starten** und **Stoppen**.
- **Zurücksetzen.** **Verlauf** listet jede Bereitstellung; **Hierauf zurücksetzen** holt eine frühere in Sekunden zurück.
- **Geschützt.** Jede Bereitstellung in eine geschützte Umgebung wartet auf die Freigabe eines Admins. **Einfrieren** stoppt während eines Releases alle Bereitstellungen.
- **Adressen.** Geben Sie einer App eine Domain, und Zelyq besorgt ihr ein kostenloses HTTPS-Zertifikat.

**Variablen** einer Umgebung erhält jede App darin; sie können aus dem Vault kommen.`,
  },
  vault: {
    title: "Vault",
    body: `Im **Vault** liegen die Schlüssel und Passwörter des Teams einmal und verschlüsselt, damit sie überall genutzt werden können, ohne sie zu kopieren: in den Variablen einer App, in Einstellungen, in Pipelines (\`vault://NAME\`) oder auf Ihren eigenen Servern.

- **Fügen Sie ein Secret hinzu** mit einem Namen wie \`STRIPE_KEY_LIVE\`, seinem Wert und einer Notiz, wofür es ist. **.env importieren** fügt viele auf einmal hinzu.
- **Die Tabelle** zeigt jedes Secret, wo es verwendet wird, wann es zuletzt geändert wurde und von wem. Ab mehr als fünf Secrets können Sie sie durchsuchen oder nur geschützte oder ungenutzte anzeigen.
- **Wert anzeigen oder kopieren:** über das Menü der Zeile. Sie werden vorher gefragt, und es wird unter Ihrem Namen in der **Aktivität** festgehalten.
- **Wert ändern** speichert eine neue Version; **Verlauf** listet alle Versionen und kann eine frühere wiederherstellen. Alles, was das Secret nutzt, erhält den neuen Wert.
- **Geschützte** Secrets können nur Admins und Inhaber anzeigen, ändern oder verwenden. Nutzen Sie das für Live-Schlüssel.

**Dienstschlüssel** erlauben einem Server außerhalb von Zelyq, die Secrets zu lesen, die er darf, und sonst nichts.`,
  },
  members: {
    title: "Mitglieder und Rollen",
    body: `Alle in einem Team sehen jede App darin. Die **Rolle** entscheidet, was jemand ändern darf:

- **Betrachter** lesen Apps, ihre Dateien und Unterhaltungen und ändern nichts.
- **Bearbeiter** bauen und bearbeiten außerdem und starten Vorschauen.
- **Admins** verwalten außerdem Mitglieder, Agenten und die Teameinstellungen und löschen Apps.
- **Inhaber** haben volle Kontrolle, auch über das Team selbst.

**Fügen Sie jemanden** per E-Mail hinzu. Wer schon ein Konto hat, tritt sofort bei; alle anderen erhalten eine Einladung, die 7 Tage gilt, sofern auf diesem Server E-Mail eingerichtet ist. **Wartet auf Beitritt** listet noch nicht genutzte Einladungen.

**Die Tabelle** lässt sich sortieren und, sobald das Team mehr als fünf Personen hat, durchsuchen. **Zuletzt aktiv** zeigt, wann jemand Zelyq zuletzt genutzt hat. Admins ändern eine Rolle direkt in der Zeile; über das Menü der Zeile entfernen Sie jemanden oder verlassen das Team.

**Wer was geändert hat** listet jede Änderung im Team: wer hinzugefügt oder entfernt wurde, welche Rolle sich geändert hat und durch wen.`,
  },
  agents: {
    title: "Externe Agenten",
    body: `Ein **Agent** lässt ein externes KI-Werkzeug (Claude Code, Cursor, VS Code, Gemini CLI oder alles, was MCP spricht) in Zelyq arbeiten, mit eigenem Modell und eigenem Abonnement. Zelyq gibt ihm Zugriff auf die Apps, Pipelines und Umgebungen, die Sie auswählen, und auf nichts anderes.

**Legen Sie einen an** mit **Neuer Agent**: Geben Sie ihm einen Namen und eine Aufgabe (das Erste, was er liest), haken Sie an, was er anfassen darf, und stellen Sie jede Berechtigung auf **Aus**, **Erlaubt** oder **Braucht Freigabe**.

- Bevor er Code liest und schreibt, wird ein Rückkehrpunkt angelegt, sodass seine Arbeit zurückgenommen werden kann.
- Pushen, Pipelines ausführen und Bereitstellungen ändern sind immer Anfragen, die eine Person im Posteingang freigibt.
- Er sieht, welche Secrets eine App erhält, nie ihre Werte.

Der Schlüssel wird nur einmal angezeigt. Kopieren Sie die Einrichtung für Ihr Werkzeug von der Seite, und ersetzen oder widerrufen Sie den Schlüssel jederzeit. Nur Admins und Inhaber verwalten Agenten.`,
  },
  ops: {
    title: "Ops, Ihr DevOps-Engineer",
    body: `**Ops** kümmert sich um die Rechner, Umgebungen und Apps des Teams. Sprechen Sie mit ihm wie mit einem Kollegen: Fragen Sie, warum etwas langsam ist, was sich geändert hat, oder lassen Sie es beheben.

- **Sprechen.** Tippen Sie, oder drücken Sie das Mikrofon und sprechen Sie; er antwortet laut.
- **Pläne.** Ops schaut sich frei um, aber jede Änderung ist ein Plan aus genauen Schritten. **Freigeben** erlaubt ihm genau diese Schritte und nichts anderes; **Ablehnen** mit Begründung, und er merkt es sich.
- **Status.** Jede Minute von Zelyq selbst geprüft, ohne KI und ohne Kosten.
- **Warnungen.** Was schiefging, wann, und was Ops dagegen getan hat.
- **Gedächtnis.** Regeln, die er vor jeder Aufgabe liest, etwa „nie am Freitagnachmittag bereitstellen“. Das Wort einer Person zählt mehr als seine eigenen Schlüsse.
- **Zugriff.** Welche Rechner und Umgebungen er erreichen darf und wie weit ihm jeweils vertraut wird.

In den **Einstellungen** steht sein monatliches Ausgabenlimit, und **Ops pausieren** stoppt sofort alles, was er tut.`,
  },
  studio: {
    title: "Studio",
    body: `**Studio** erstellt Bilder und Videos für Ihre Apps.

- **Bild.** Beschreiben Sie das Bild, wählen Sie Modell und Größe, und fügen Sie Referenzbilder hinzu, wenn das Modell sie annimmt. Jedes Ergebnis bleibt im Bildverlauf.
- **Video.** Beschreiben Sie eine Szene oder animieren Sie ein Bild ab seinem Startbild. Ein Clip dauert einige Minuten und kostet weit mehr als ein Bild.
- **Verwenden.** Laden Sie ein Ergebnis herunter oder wählen Sie es beim Bauen einer App aus dem Studio.

Studio nutzt die eigenen Bild- und Videoschlüssel des Teams, festgelegt in den **Teameinstellungen**. Wird kein Modell angeboten, muss ein Admin zuerst einen Schlüssel hinzufügen.`,
  },
  "team-settings": {
    title: "Teameinstellungen",
    body: `Alles, was ein Team selbst entscheidet, gruppiert im Menü links. Admins und Inhaber ändern es.

- **Nutzung und Plan.** Was das Team nutzt: Apps, Speicher, Builds, und wie nah es an seinen Grenzen ist.
- **KI-Schlüssel.** Die eigenen Schlüssel des Teams für die Modelle, die Apps bauen, für Studio und Sprache. Ein Schlüssel kann aus dem Vault des Teams kommen.
- **Apps bauen.** Welches Modell der Agent nutzt und wie gründlich er nachdenkt.
- **Image Studio, Video Studio, Spracheingabe.** Die Modelle und Optionen für jedes davon.
- **Ops.** Ob der DevOps-Engineer des Teams eingeschaltet ist, und seine Grenzen.
- **E-Mail.** Der eigene Mailserver des Teams, für die E-Mails, die Zelyq in seinem Namen sendet.
- **Integrationen.** GitHub, Figma, Supabase und weitere.
- **Support-Zugriff.** Lassen Sie den Zelyq-Support 48 Stunden lang auf das Team schauen; jeder Blick wird festgehalten.

Eine Änderung gilt für das ganze Team, sobald sie gespeichert ist.`,
  },
  account: {
    title: "Ihr Konto",
    body: `Ihr Konto gilt für alle Teams, in denen Sie sind.

- **Profil.** Ihr Name und die E-Mail, mit der Sie sich anmelden. **Konto löschen** entfernt es endgültig.
- **Sicherheit.** Ändern Sie Ihr Passwort (alle anderen Geräte werden abgemeldet). Schalten Sie die **Zwei-Faktor-Anmeldung** mit einer Authenticator-App ein, und bewahren Sie die Wiederherstellungscodes sicher auf. **Angemeldete Geräte** listet jeden Browser, der Ihr Konto nutzt; melden Sie jeden davon ab.
- **Einstellungen.** Ihre Sprache (Englisch, Französisch, Deutsch, Spanisch, Portugiesisch oder Chinesisch), Ihre Zeitzone und wie Daten und Zahlen geschrieben werden. Jedes Gerät, auf dem Sie sich anmelden, übernimmt sie.

Das Design (hell, dunkel oder wie das System) finden Sie im Menü unter Ihrem Bild.`,
  },
  admin: {
    title: "Serververwaltung",
    body: `Die Serververwaltung ist für die Personen, die diesen Zelyq-Server betreiben. Sie ändert Dinge für alle Teams.

- **Modelle und KI.** Mit welchem Anbieter der Agent spricht, Bild- und Videoerzeugung, Spracheingabe und das Modell, mit dem Ops denkt.
- **Laufzeit und Vorschau.** Wo App-Befehle laufen, wie Vorschauen erreicht werden, und die Standards für Pipelines.
- **Identität und Zugriff.** Wer sich anmelden darf und wie lange, die Konten auf diesem Server und Admin-API-Schlüssel.
- **Kommunikation.** Der Mailserver, über den Zelyq sendet, und Integrationen.
- **Pläne.** Was jedes Team nutzen darf.
- **Status der Instanz.** Der Zustand des Servers und seiner Teile.

Jedes Team kann in seinen **Teameinstellungen** weiterhin eigene Schlüssel und Modelle wählen; die des Servers sind die Vorgabe.`,
  },
};
