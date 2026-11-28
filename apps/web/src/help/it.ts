import type { Articles } from "./articles";

export const articles: Articles = {
  start: {
    title: "Orientarsi in Zelyq",
    body: `Zelyq è organizzato per **team**. Tutto ciò che un team crea (le sue app, pipeline, ambienti e segreti) appartiene al team, e tutti i suoi membri possono vederlo.

- **Barra laterale.** A sinistra: **Home**, poi **Crea** (App, Studio, Agenti), **Rilascia** (Pipeline, Deploy, Ops) e **Proteggi** (Vault). Dentro un’app, la barra laterale mostra invece le sezioni di quell’app.
- **Barra superiore.** Il selettore del team e il percorso di navigazione mostrano dove ti trovi. La ricerca (**Ctrl K** o **⌘ K**) trova qualsiasi app, pipeline o ambiente, e ti porta a qualsiasi pagina, compresi Vault e le impostazioni.
- **Posta in arrivo.** La campanella raccoglie ciò che ti aspetta, come un deploy o la richiesta di un agente da approvare.
- **Aiuto.** Il menu **?** apre questi articoli, le scorciatoie da tastiera e la guida completa per principianti.

**Home** mostra prima ciò che richiede attenzione: ciò che non va o che ti aspetta, poi le tue app e le esecuzioni recenti.

Cambia team dal suo nome, in alto a sinistra. Il tuo account, la lingua e la sicurezza sono sotto la tua foto, in alto a destra.`,
  },
  apps: {
    title: "App",
    body: `Un’**app** è un progetto che l’agente costruisce con te: un sito web, un’applicazione web, un’API o un’app mobile. Ognuna ha i suoi file, la sua anteprima e la sua cronologia.

**Creane una** con **Nuova app**. Scegli un punto di partenza (uno **stack**, come React + Vite o FastAPI), dalle un nome e descrivi ciò che vuoi.

**Trovane una** con la casella di ricerca (premi **/** per andarci), oppure filtra per stato e stack. Passa da schede a elenco con i pulsanti a destra; l’elenco si può ordinare per qualsiasi colonna.

**Apri un’app** per continuare a costruirla. La sua **Panoramica** mostra l’anteprima, dove è online e i suoi dettagli; **Impostazioni** contiene il nome e ciò che l’agente può fare.

Le app appartengono al team: tutti i membri possono aprirle. Ciò che ognuno può modificare dipende dal suo ruolo (vedi **Membri e ruoli**).`,
  },
  build: {
    title: "Costruire con l’agente",
    body: `Qui si costruisce un’app. A sinistra parli con l’agente; a destra vedi il risultato.

- **Chat.** Descrivi ciò che vuoi con parole semplici. L’agente lavora in uno spazio di lavoro reale: ogni modifica è un file che puoi leggere in **Codice**.
- **Anteprima.** Una copia privata dell’app, in esecuzione qui. Usa l’ispettore per indicare qualcosa e chiedere una modifica proprio lì.
- **Modalità.** I pulsanti sotto la casella del messaggio attivano **Architetto** (prima pianifica un intero progetto), **Ingegnere** (modifiche attente e verificate) e **Auto** (va avanti finché il lavoro non è finito).
- **Menu /.** Digita **/** per vedere comandi come **/clone** e **/figma**, agenti specialisti (Design, DevOps, Sicurezza/QA), skill e modelli.

**Annullare.** **Snapshot** salva un punto di ripristino prima di ogni modifica, così puoi tornare a qualsiasi versione precedente.

**Variabili** contiene la configurazione e le chiavi dell’app; un valore può venire dal Vault per tenerlo in un unico posto. **Git** fa commit e push del codice dell’app verso un repository che colleghi.

Quando funziona, premi **Deploy** per metterla online, oppure configura una pipeline che la verifichi e la distribuisca a ogni modifica.`,
  },
  "app-settings": {
    title: "Panoramica e impostazioni di un’app",
    body: `**Panoramica** è l’app a colpo d’occhio: l’anteprima dal vivo, gli ambienti in cui gira e i loro indirizzi, e dettagli come lo stack, l’ID e quando è cambiata l’ultima volta.

**Impostazioni** è dove si modifica l’app stessa:

- **Nome dell’app.** Compare nell’elenco delle app, nel percorso di navigazione e nella scheda del browser.
- **Cosa può fare l’agente.** Generare immagini e generare video costano denaro con le chiavi IA del team, quindi entrambe le opzioni partono disattivate. Attivale qui.
- **Zona pericolosa.** Eliminare un’app rimuove i suoi file, la sua anteprima e la sua cronologia.

Ciò che ognuno può modificare dipende dal suo ruolo nel team.`,
  },
  pipelines: {
    title: "Pipeline",
    body: `Una **pipeline** verifica, costruisce e distribuisce un’app, sempre allo stesso modo. È un file di **fasi** eseguite in ordine; ogni fase ha dei **passaggi** (comandi, un checkout, una cache, un deploy).

**Creane una** con **Nuova pipeline** e un modello. Modificala in **Visuale** (clic su riquadri e campi) o in **YAML** (il file stesso); entrambe mostrano la stessa pipeline.

- **Viene eseguita su.** \`local\` la esegue sul server Zelyq, in un container buttato via al termine. Un **runner** è una delle tue macchine, aggiunta sotto **Runner** e raggiunta via SSH.
- **Origine.** Da dove vengono i file: un’app in Zelyq, un repository GitHub o una cartella su una macchina.
- **Segreti.** Non scrivere mai una chiave nel file. Usa \`vault://NOME\` e Zelyq la inserisce; i segreti sono mascherati in ogni log.
- **Trigger.** Avviala a mano, secondo una pianificazione, o a ogni push e pull request da GitHub.

Ogni pipeline conserva le sue versioni, quindi un file precedente si può ripristinare. I **Plugin** aggiungono passaggi già pronti.`,
  },
  runs: {
    title: "Leggere un’esecuzione di pipeline",
    body: `Un’esecuzione è un passaggio completo di una pipeline. Il diagramma mostra ogni **fase** come un riquadro, collegate nell’ordine in cui vengono eseguite; le fasi affiancate girano nello stesso momento.

- **Colori.** Verde superata, rosso fallita, blu in esecuzione, grigio in attesa o saltata.
- **Passaggi e output.** Fai clic su una fase per vederne i passaggi. Fai clic su un passaggio per leggere ciò che ha stampato. Se un passaggio è fallito, le ultime righe del suo output di solito dicono perché.
- **In attesa di approvazione.** Un deploy verso un ambiente protetto si ferma finché un amministratore non preme **Approva**. Compare anche nella Posta in arrivo.

**Esegui di nuovo** esegue lo stesso file un’altra volta. **Annulla** ferma un’esecuzione ancora in corso; ciò che ha già distribuito resta com’era.

Un’esecuzione registra chi o cosa l’ha avviata (una persona, una pianificazione, un push) e quanto è durata ogni fase.`,
  },
  deployments: {
    title: "Deploy e ambienti",
    body: `Un **ambiente** è un luogo in cui gira un’app: \`staging\` o \`production\`, su una delle tue macchine. **Deploy** elenca ogni ambiente con le app online al suo interno, quale versione, da quando e chi l’ha messa lì.

- **Deploy.** Il passaggio di deploy di una pipeline, o il pulsante **Deploy** in un’app, avvia l’app in Docker sulla macchina, verifica che risponda e mantiene la versione precedente se non risponde.
- **Log e controlli.** Sulla scheda di un’app, **Log · gestisci** mostra il suo output dal vivo con CPU e memoria, oltre a **Riavvia** e **Ferma**.
- **Ripristino.** **Cronologia** elenca ogni deploy; **Torna a questa** riporta indietro una versione precedente in pochi secondi.
- **Protetto.** Ogni deploy verso un ambiente protetto attende l’approvazione di un amministratore. **Congela** blocca tutti i deploy durante un rilascio.
- **Indirizzi.** Dai un dominio a un’app e Zelyq le procura un certificato HTTPS gratuito.

Le **Variabili** di un ambiente vengono date a ogni app al suo interno, e possono venire dal Vault.`,
  },
  vault: {
    title: "Vault",
    body: `Il **Vault** conserva le chiavi e le password del team una sola volta, cifrate, così possono essere usate ovunque senza copiarle: nelle Variabili di un’app, nelle impostazioni, nelle pipeline (\`vault://NOME\`) o dai tuoi server.

- **Aggiungi un segreto** con un nome come \`STRIPE_KEY_LIVE\`, il suo valore e una nota su a cosa serve. **Importa .env** ne aggiunge molti in una volta.
- **La tabella** mostra ogni segreto, dove è usato, quando è cambiato l’ultima volta e da chi. Quando sono più di cinque, puoi cercarli o mostrare solo quelli protetti o inutilizzati.
- **Mostra o copia un valore** dal menu della riga. Ti viene chiesta conferma prima, e viene registrato in **Attività** a tuo nome.
- **Cambia valore** salva una nuova versione; **Cronologia** elenca ogni versione e può ripristinarne una precedente. Tutto ciò che usa il segreto riceve il nuovo valore.
- I segreti **Protetti** possono essere mostrati, modificati o usati solo da amministratori e proprietari. Usalo per le chiavi di produzione.

Le **Chiavi di servizio** permettono a un server esterno a Zelyq di leggere i segreti a cui ha accesso, e nient’altro.`,
  },
  members: {
    title: "Membri e ruoli",
    body: `Tutti in un team vedono ogni app del team. Il loro **ruolo** decide cosa possono modificare:

- **Visualizzatore** legge le app, i loro file e le conversazioni, e non modifica nulla.
- **Editor** inoltre costruisce, modifica ed esegue le anteprime.
- **Amministratore** inoltre gestisce membri, agenti e impostazioni del team, ed elimina le app.
- **Proprietario** ha il pieno controllo, compreso il team stesso.

**Aggiungi qualcuno** via email. Chi ha già un account entra subito; chiunque altro riceve un invito valido per 7 giorni, se su questo server è configurata l’email. **In attesa di unirsi** elenca gli inviti non ancora usati.

**La tabella** si può ordinare, e cercare quando il team ha più di cinque persone. **Ultima attività** mostra quando ogni persona ha usato Zelyq l’ultima volta. Gli amministratori cambiano un ruolo sul posto; il menu della riga rimuove qualcuno, o ti permette di uscire.

**Chi ha cambiato cosa** elenca ogni modifica al team: chi è stato aggiunto o rimosso, quale ruolo è cambiato e da chi.`,
  },
  agents: {
    title: "Agenti esterni",
    body: `Un **agente** permette a uno strumento di IA esterno (Claude Code, Cursor, VS Code, Gemini CLI o qualsiasi cosa parli MCP) di lavorare dentro Zelyq, con il suo modello e il suo abbonamento. Zelyq gli dà accesso alle app, pipeline e ambienti che scegli, e a nient’altro.

**Creane uno** con **Nuovo agente**: dagli un nome e un compito (la prima cosa che legge), spunta ciò che può toccare e imposta ogni permesso su **Disattivato**, **Consentito** o **Richiede approvazione**.

- Leggere e scrivere codice crea prima un punto di annullamento, così il suo lavoro si può annullare.
- Push, esecuzione di pipeline e modifiche ai deploy sono sempre richieste che una persona approva, nella Posta in arrivo.
- Vede quali segreti riceve un’app, mai i loro valori.

La chiave viene mostrata una sola volta. Copia dalla pagina la configurazione per il tuo strumento, e sostituisci o revoca la chiave in qualsiasi momento. Solo amministratori e proprietari gestiscono gli agenti.`,
  },
  ops: {
    title: "Ops, il tuo DevOps engineer",
    body: `**Ops** si occupa delle macchine, degli ambienti e delle app del team. Parlagli come a un collega: chiedigli perché qualcosa è lento, cosa è cambiato, o di sistemarlo.

- **Parla.** Scrivi, oppure premi il microfono e parla; risponde a voce.
- **Piani.** Ops guarda liberamente, ma ogni modifica è un piano di passaggi precisi. **Approva** gli permette di fare quei passaggi e nient’altro; **Rifiuta** con un motivo, e se lo ricorda.
- **Stato.** Controllato ogni minuto da Zelyq stesso, senza IA e senza costi.
- **Avvisi.** Cosa è andato storto, quando, e cosa ha fatto Ops.
- **Memoria.** Regole che legge prima di ogni lavoro, come "mai fare deploy il venerdì pomeriggio". La parola di una persona vale più delle sue conclusioni.
- **Accesso.** Quali macchine e ambienti può raggiungere, e quanta fiducia ha su ciascuno.

**Impostazioni** contiene il suo limite di spesa mensile, e **Metti in pausa Ops** ferma subito tutto ciò che sta facendo.`,
  },
  studio: {
    title: "Studio",
    body: `**Studio** crea immagini e video per le tue app.

- **Immagine.** Descrivi l’immagine, scegli un modello e una dimensione, e aggiungi immagini di riferimento se il modello le accetta. Ogni risultato viene conservato nella cronologia delle immagini.
- **Video.** Descrivi una scena, o anima un’immagine a partire dal suo fotogramma iniziale. Una clip richiede qualche minuto, e costa molto più di un’immagine.
- **Usalo.** Scarica un risultato, o sceglilo da Studio mentre costruisci un’app.

Studio usa le chiavi per immagini e video del team, impostate in **Impostazioni del team**. Se non viene proposto alcun modello, prima un amministratore aggiunge una chiave.`,
  },
  "team-settings": {
    title: "Impostazioni del team",
    body: `Tutto ciò che un team decide da sé, raggruppato nel menu a sinistra. Amministratori e proprietari le modificano.

- **Utilizzo e piano.** Cosa usa il team: app, spazio, build, e quanto è vicino ai suoi limiti.
- **Chiavi IA.** Le chiavi del team per i modelli che costruiscono le app, Studio e la voce. Una chiave può venire dal Vault del team.
- **Creazione di app.** Quale modello usa l’agente e quanto ragiona.
- **Image Studio, Video Studio, Input vocale.** I modelli e le opzioni di ciascuno.
- **Ops.** Se il DevOps engineer del team è attivo, e i suoi limiti.
- **Email.** Il server di posta del team, per le email che Zelyq invia per suo conto.
- **Integrazioni.** GitHub, Figma, Supabase e altre.
- **Accesso dell’assistenza.** Permetti all’assistenza di Zelyq di esaminare il team per 48 ore; ogni accesso viene registrato.

Una modifica vale per tutto il team appena viene salvata.`,
  },
  account: {
    title: "Il tuo account",
    body: `Il tuo account è tuo in ogni team di cui fai parte.

- **Profilo.** Il tuo nome e l’email con cui accedi. **Elimina account** lo rimuove per sempre.
- **Sicurezza.** Cambia la password (ogni altro dispositivo viene disconnesso). Attiva l’**accesso in due passaggi** con un’app di autenticazione, e conserva i codici di recupero in un posto sicuro. **Dispositivi connessi** elenca ogni browser che usa il tuo account; disconnetti quello che vuoi.
- **Preferenze.** La tua lingua (inglese, francese, tedesco, spagnolo, portoghese, cinese, hindi, italiano o giapponese), il fuso orario e come vengono scritti date e numeri. Ogni dispositivo su cui accedi li segue.

Il tema (chiaro, scuro o come il sistema) è nel menu sotto la tua foto.`,
  },
  admin: {
    title: "Amministrazione del server",
    body: `L’amministrazione del server è per chi gestisce questo server Zelyq. Modifica le cose per ogni team.

- **Modelli e IA.** Con quale fornitore parla l’agente, la generazione di immagini e video, l’input vocale e il modello con cui ragiona Ops.
- **Runtime e anteprima.** Dove vengono eseguiti i comandi delle app, come si raggiungono le anteprime e le impostazioni predefinite delle pipeline.
- **Identità e accesso.** Chi può accedere e per quanto tempo, gli account su questo server e le chiavi API di amministrazione.
- **Comunicazione.** Il server di posta tramite cui Zelyq invia, e le integrazioni.
- **Piani.** Cosa può usare ogni team.
- **Stato dell’istanza.** La salute del server e delle sue parti.

Ogni team può comunque scegliere le proprie chiavi e i propri modelli nelle sue **Impostazioni del team**; quelli del server sono il valore predefinito.`,
  },
};
