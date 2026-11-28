<div align="center">

<img src="assets/brand/zelyq-banner.png" alt="Zelyq: build, automate and ship software with AI" width="100%" />

[English](./README.md) · [Français](./README.fr.md) · [Deutsch](./README.de.md) · **Español** · [Português](./README.pt-BR.md) · [简体中文](./README.zh-CN.md) · [हिन्दी](./README.hi.md) · [Italiano](./README.it.md) · [日本語](./README.ja.md)

### La plataforma open source para crear, proteger, entregar y operar software, todo en un mismo lugar.

Crea apps con un agente de IA que trabaja como un ingeniero. Guarda cada credencial en un vault cifrado.
Prueba y despliega en tus propias máquinas, y deja que un ingeniero DevOps de IA cuide lo que está en marcha.
**Autoalojado o en la nube. Tu propio modelo. Sin telemetría.**

[![CI](https://github.com/CrowPus/Zelyq/actions/workflows/ci.yml/badge.svg)](https://github.com/CrowPus/Zelyq/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520.12-brightgreen.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)](./tsconfig.base.json)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-black.svg)](./CONTRIBUTING.md)

**[Sitio web](https://zelyq.dev)** · **[Pruébalo en línea](https://app.zelyq.dev)** · [Inicio rápido](#inicio-rápido) ·
[Tutorial](./docs/tutorial.md) · [Documentación](./docs/README.md) · [Autoalojamiento](./docs/self-hosting.md) ·
[Arquitectura](./docs/architecture.md) · [Hoja de ruta](./docs/roadmap.md) · [Contribuir](./CONTRIBUTING.md)

</div>

---

## Contenido

- [Por qué Zelyq](#por-qué-zelyq)
- [La plataforma](#la-plataforma): [Apps](#apps), [Studio](#studio), [Agentes](#agentes), [Vault](#vault),
  [Pipelines](#pipelines), [Despliegues](#despliegues), [Ops](#ops)
- [Equipos, planes e idiomas](#equipos-planes-e-idiomas)
- [Inicio rápido](#inicio-rápido) y [actualizar](#actualizar)
- [Tu propio modelo](#tu-propio-modelo)
- [Cómo funciona](#cómo-funciona)
- [Seguridad](#seguridad) · [Estado](#estado) · [Contribuir](#contribuir) · [Licencia](#licencia)

---

## Por qué Zelyq

Entregar software suele exigir varios productos: un generador de apps con IA, un gestor de
secretos, un servicio de CI, una herramienta de despliegue y alguien de guardia. Eso son varios
inicios de sesión, varias facturas y varios sitios por donde puede filtrarse una clave. Zelyq reúne
todo el recorrido en una sola plataforma, organizada como se hace el trabajo:

| | Módulo | Qué hace |
| --- | --- | --- |
| **Crear** | **[Apps](#apps)** | Describe una app. Un agente la planifica, la construye en archivos reales que son tuyos y la comprueba antes de darla por terminada |
| | **[Studio](#studio)** | Genera imágenes y video, para tus apps o por separado |
| | **[Agentes](#agentes)** | Deja que Claude Code, Cursor, VS Code, Gemini CLI o cualquier cliente MCP trabaje dentro de Zelyq, con su propio modelo |
| **Proteger** | **[Vault](#vault)** | Cada credencial guardada una vez, cifrada, versionada y auditada, y usada por apps, pipelines y tus propios servidores |
| **Entregar** | **[Pipelines](#pipelines)** | Prueba y construye siempre igual, en el servidor de Zelyq o en tus propias máquinas Linux, macOS y Windows |
| | **[Despliegues](#despliegues)** | Lleva las apps a tus máquinas por entorno, con aprobaciones, congelación y reversión automática |
| | **[Ops](#ops)** | Un ingeniero DevOps de IA con quien hablar: planifica, espera tu aprobación, demuestra cada cambio y vigila lo que está en marcha |

Todo pertenece a un **equipo**. Invita a personas, dale a cada una un rol, y cada módulo lo respeta.

---

## La plataforma

### Apps

Describe lo que quieres. El agente lee, planifica, escribe archivos, ejecuta comandos e inicia una
vista previa en vivo. Puedes ver cada llamada a herramientas y cada archivo que toca mientras
trabaja.

- **Comprobado, no solo generado.** Cuando el agente termina, Zelyq ejecuta la comprobación de tipos
  o la build del proyecto y revisa que la vista previa no falle. Un turno que rompió algo vuelve al
  agente para arreglarlo en vez de darse por terminado.
- **Claro sobre lo que sabe.** El *modo Ingeniero* separa lo verificado de lo supuesto, nombra la
  alternativa que no eligió y pregunta antes de cualquier cosa irreversible.
- **Planifica antes de construir.** El *modo Arquitecto* convierte una petición en un diseño que
  puedes revisar (requisitos, decisiones, modelo de datos, API, plan de construcción) y espera tu
  visto bueno. El *modo Auto* lleva a cabo después el plan por sí solo, hasta un límite fijado.
- **Especialistas disponibles.** Un diseñador (`DESIGN.md`), un ingeniero DevOps (CI, Dockerfile,
  configuración de despliegue), un ingeniero de seguridad/QA (pruebas y análisis de seguridad) y un
  ingeniero cinematográfico (páginas animadas con el desplazamiento).
- **Full stack.** React + Vite, React con backend en Python (FastAPI) o Expo React Native, cada uno
  partiendo de un sistema de diseño. Supabase Postgres con seguridad a nivel de fila por operación.
- **Empieza por lo que ya existe.** Importa un repositorio de GitHub, reconstruye un sitio en vivo
  con `/clone <url>` o parte de un frame de Figma y sus tokens de diseño con `/figma <enlace>`.
- **Cada turno se puede deshacer.** Una instantánea antes de cada turno, un diff exacto de lo que
  cambió y una reversión con un clic. Los proyectos son archivos normales en disco que puedes
  llevarte.

Consulta [Modos](./docs/modes.md) y [cómo se comporta el agente](./docs/agent-behaviour.md).

### Studio

- **Imagen**: OpenAI, Google o xAI, con imágenes de referencia y biblioteca privada.
- **Video**: Google Veo o xAI, a partir de texto o de una imagen fija.

Studio usa tus propias claves de proveedor, facturadas a tu propia cuenta. Actívalo para un proyecto
y el agente puede crear imágenes y metraje para la app que está construyendo, dentro de los límites
que fijes. Los clips se pueden dividir en secuencias de imágenes para páginas animadas con el
desplazamiento. Consulta [Studio: imagen](./docs/Image-gen/implementation.md) y
[Studio: video](./docs/Video-gen/README.md).

### Agentes

Trae la herramienta de IA que ya usas. Un **agente** permite que Claude Code, Cursor, VS Code,
Gemini CLI, ChatGPT o cualquier cliente MCP trabaje dentro de Zelyq con su propio modelo y su propia
suscripción. Zelyq solo le da acceso a las apps, pipelines y entornos que elijas.

- **Permisos que ajustas uno a uno**: Desactivado, Permitido o Requiere aprobación, para leer y
  escribir código, ejecutar comandos, hacer push, pipelines, despliegues, Studio y más.
- **Una persona aprueba lo importante.** Los push, las ejecuciones de pipelines y los cambios de
  despliegue son solicitudes que esperan en la bandeja de entrada.
- **Fácil de deshacer.** Se toma un punto de restauración antes de que el agente cambie una app.
- **Los valores secretos nunca se muestran.** El agente ve qué secretos recibe una app, solo por su
  nombre.

Consulta [Agentes](./docs/agents.md).

### Vault

Guarda cada credencial **una sola vez** y úsala en todas partes, sin pegarla en un archivo.

- **Cifrado en reposo** (AES-256-GCM), con **historial de versiones**, una marca **Protegido** para
  claves de producción y un registro de cada vez que se muestra o cambia.
- **Se usa por referencia.** Las variables de app, las claves de modelo, los pipelines y los
  entornos apuntan a `vault://NOMBRE`. El valor solo se rellena donde y cuando hace falta.
- **Enmascarado en los registros.** Un secreto que llega a un registro de pipeline aparece como
  `***`.
- **También para tus servidores.** Obtén secretos con una clave de servicio limitada, o ejecuta
  `zelyq vault run -- <comando>` para iniciar un proceso con ellos sin escribir nada en disco.
- **Múdate importando un `.env`.**

Consulta [Vault](./docs/vault.md).

### Pipelines

Un pipeline es un archivo YAML corto, o un diagrama que editas con clics. Las etapas se ejecutan en
orden, los pasos también, y cada paso es un comando o un bloque listo para usar.

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

- **Se ejecuta donde elijas.** En un contenedor desechable en el servidor de Zelyq, o en tus propias
  máquinas **Linux, macOS y Windows**. Una máquina se une con un solo comando de instalación y se
  conecta hacia Zelyq por HTTPS, sin abrir puertos. También se admiten máquinas por SSH.
- **Rápido y flexible.** Etapas a la vez, una máquina distinta por etapa, builds en matriz y
  plantillas compartidas entre pipelines.
- **Plugins.** Empaqueta un paso una vez, con entradas, secretos del Vault y salidas, y úsalo en
  cualquier pipeline. Consulta [Plugins de pipeline](./docs/pipeline-plugins.md).
- **Lo inicia cualquier cosa.** A mano, un git push (con filtros de rutas), un pull request, una
  programación, el fin de otro pipeline, un cambio de app del agente o cualquier CI con una clave de
  servicio.
- **Todo lo que necesita un pipeline de verdad.** Instalación de herramientas y cachés, contenedores
  de servicio (Postgres, Redis), salidas de pasos, informes JUnit, artefactos, aprobaciones,
  reintentos, tiempos límite y control de concurrencia.
- **Informa del resultado.** ✓ / ✗ en el commit y el pull request de GitHub o GitLab.

Consulta [Pipelines](./docs/pipelines.md).

### Despliegues

- **Entornos** como `staging` y `production`, cada uno en una de tus máquinas y con sus propias
  variables. La clave de prueba en staging y la de producción en production, ambas desde el Vault.
- **Despliega desde un pipeline**, para que una app esté probada antes de salir. Zelyq construye la
  imagen en tu máquina, a partir del `Dockerfile` de la app o de uno que escribe para Node, Python,
  Go y sitios estáticos. No hace falta registro.
- **Reversión automática.** Si la nueva versión no pasa su comprobación de salud, la anterior vuelve
  por sí sola.
- **Tu propio dominio con HTTPS**, sin cortes entre versiones.
- **Registros en vivo, CPU y memoria**, reinicio y parada, y vuelta a una versión anterior con un
  clic.
- **Promueve** a producción la imagen exacta probada en staging, sin volver a construirla.
- **Los entornos protegidos** esperan la aprobación de un administrador. **Congelar** detiene todos
  los despliegues durante una entrega.

Consulta [Desplegar](./docs/deploy.md).

### Ops

**Ops** es el ingeniero DevOps del equipo. Pídele, por escrito o en voz alta, que publique una app,
entregue una nueva versión, configure un dominio o explique por qué algo va lento.

- **Primero mira y muestra un plan.** Ops observa libremente, pero cada cambio es una lista de pasos
  exactos que espera tu aprobación. Un paso que no se puede deshacer se confirma por separado.
- **Demuestra cada cambio.** Zelyq comprueba el resultado por sí mismo. Un paso solo cuenta como
  hecho cuando su comprobación pasa.
- **Nunca deja de vigilar.** Sitios y apps se comprueban cada minuto, las máquinas cada cinco
  minutos, y certificados y dominios cada día, sin usar ningún modelo. Las alertas te llegan por
  correo, Telegram, Slack o Discord.
- **Solo llega a lo que le asignas.** Un administrador le da entornos, máquinas, pipelines y código,
  uno a uno, con un nivel de confianza para cada uno. Ve los nombres de los secretos, nunca sus
  valores.
- **Recuerda.** Las reglas que le das y las lecciones de lo que salió mal se guardan y se leen antes
  de cada tarea.
- **Tú mantienes el control.** Un límite de gasto mensual, y **Pausar Ops** lo detiene todo al
  instante.

---

## Equipos, planes e idiomas

| Rol | Puede |
| --- | --- |
| `viewer` | Ver apps, archivos, ejecuciones, entornos e historial de despliegues |
| `editor` | Todo lo anterior, además de pedir al agente, ejecutar pipelines y desplegar |
| `admin` | Todo lo anterior, además de miembros, agentes, entornos, aprobaciones y secretos protegidos |
| `owner` | Control total, incluido el propio equipo |

- **Actividad.** Cada cambio queda registrado en la Actividad del equipo: un secreto mostrado, un
  pipeline editado, un despliegue revertido.
- **Planes y uso.** Cada equipo tiene límites de apps, almacenamiento, ejecuciones de pipelines,
  miembros y vistas previas, fijados por el administrador del servidor.
- **Operar Zelyq para otros.** El [modo gestionado](./docs/managed-mode.md) pone el inicio de sesión
  detrás de tu propio servicio de cuentas, y la [API de administración](./docs/admin-api.md) permite
  a tus sistemas gestionar personas, equipos, planes y estado.
- **Nueve idiomas.** La interfaz y su ayuda integrada están en inglés, francés, alemán, español,
  portugués, chino, hindi, italiano y japonés, a elección de cada persona.
- **Las apps inactivas duermen.** Las apps que nadie ha abierto en un tiempo pueden pasar a un
  bucket compatible con S3 o a una carpeta, y despiertan solas al abrirlas. Consulta
  [Almacenamiento](./docs/storage.md).

---

## Inicio rápido

**Lo más rápido:** crea una cuenta en **[app.zelyq.dev](https://app.zelyq.dev)**. Hay un plan
gratuito y no hay nada que instalar.

**Para alojarlo tú mismo:**

```bash
# Requires Node >= 20.12 and pnpm >= 9
git clone https://github.com/CrowPus/Zelyq.git
cd Zelyq
cp .env.example .env    # your configuration: check it before the first start (below)
pnpm install
pnpm dev                # web :5173 · server :8787 · agent :8788
```

Abre <http://localhost:5173> y crea la primera cuenta, que administra la instancia. Añade la clave de
tu modelo en **Configuración → Modelo** (escrita o desde el Vault), abre **Apps**, crea una app y
describe lo que quieres.

**En una VM o un servidor remoto**, cambia esto en `.env` antes del primer arranque. Sustituye
`203.0.113.10` por la dirección o el dominio de tu máquina:

| Ajuste | Valor | Por qué |
| --- | --- | --- |
| `ZELYQ_WEB_HOST` | `0.0.0.0` | Si no, la interfaz solo responde en la propia máquina |
| `ZELYQ_PREVIEW_HOST` | `203.0.113.10` | Si no, las vistas previas de las apps rechazan tu navegador |
| `ZELYQ_CORS_ORIGIN` | `http://203.0.113.10:5173` | La dirección en la que abres Zelyq |
| `ZELYQ_PUBLIC_URL` | `http://203.0.113.10:5173` | Se usa en los enlaces de webhooks e inicio de sesión |
| `ZELYQ_ALLOW_REGISTRATION` | `false`, cuando tu cuenta ya exista | Si no, cualquiera que encuentre la dirección puede registrarse |

Abre el puerto 5173 y los puertos de vista previa (`ZELYQ_PREVIEW_PORT_MIN`–`MAX`, 4300–4399 por
defecto) en el cortafuegos. En una máquina accesible desde internet, pon Zelyq detrás de HTTPS:
consulta [Autoalojamiento](./docs/self-hosting.md). Todos los demás ajustes se explican en
`.env.example` y en [Configuración](./docs/configuration.md).

**Con Docker:** `docker compose -f docker/docker-compose.yml up`. Consulta
[Autoalojamiento](./docs/self-hosting.md).

**Siguiente paso:** el [tutorial](./docs/tutorial.md) lleva una app de Zelyq a producción paso a
paso: Vault, un pipeline, tu propia máquina, un despliegue con reversión, y push y pull requests de
GitHub.

### Actualizar

Tus datos se quedan donde están. La base de datos, los medios generados y la clave de cifrado están
en `data/`, tus apps en `workspace/` y tu configuración en `.env`. Git ignora los tres, y el servidor
aplica los cambios de base de datos por sí solo al arrancar.

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

Ejecútalo con el usuario que clonó Zelyq. Si Git se detiene con `detected dubious ownership`, cambia
a ese usuario con `su - <usuario>` en lugar de añadir una excepción `safe.directory`.

Con Docker: `git pull` y luego `docker compose -f docker/docker-compose.yml up -d --build`. Tus datos
están en el volumen `zelyq-data`, así que **nunca** ejecutes `docker compose down -v`, que lo borra.

Más detalles, incluido PostgreSQL: [Autoalojamiento → Actualización](./docs/self-hosting.md#upgrading).

---

## Tu propio modelo

| Proveedor | `ZELYQ_PROVIDER` | Modelo por defecto |
| --- | --- | --- |
| Claude | `anthropic` | `claude-opus-5-5` |
| Gemini | `google` | `gemini-pro-latest` |
| OpenAI | `openai` | `gpt-6.1-terra` |
| Grok (xAI) | `xai` | `grok-4.6` |
| DeepSeek | `deepseek` | `deepseek-v4-flash` |
| Mistral | `mistral` | `mistral-large-latest` |
| Groq | `groq` | `llama-3.3-70b-versatile` |
| OpenRouter | `openrouter` | `anthropic/claude-sonnet-4.6` |
| **El tuyo**: Ollama, vLLM, LM Studio, cualquier cosa compatible con OpenAI | `custom` | define `ZELYQ_MODEL` |

Configura las claves en **Configuración → Modelo**, escritas o desde el Vault, o deja que cada equipo
traiga las suyas en **Configuración del equipo → Claves de IA**. Un inicio de sesión de Claude Code o
Codex puede sustituir a una clave de API. Con `custom`, nada de tus proyectos sale de tu red.
Consulta [Configuración](./docs/configuration.md).

---

## Cómo funciona

Tres procesos y una herramienta de línea de comandos, sobre cuatro bibliotecas compartidas. A los
archivos y comandos de una app solo se llega por un camino, el `RuntimeDriver`, y por eso local,
contenedor y host remoto funcionan igual.

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

| Parte | Responsabilidad |
| --- | --- |
| [`apps/web`](./apps/web) | La interfaz: chat, editor y vista previa, Studio, Vault, Pipelines, Despliegues, Ops |
| [`apps/server`](./apps/server) | Equipos, apps, Vault, el motor de pipelines, los despliegues y Ops; el único proceso que habla con la base de datos |
| [`apps/agent`](./apps/agent) | El bucle del modelo. Nunca toca archivos por sí mismo: cada herramienta pasa por el `RuntimeDriver` |
| [`apps/runner`](./apps/runner) | El runner instalado en tus máquinas; se conecta a Zelyq y ejecuta pipelines y despliegues |
| [`apps/cli`](./apps/cli) | La línea de comandos `zelyq`, p. ej. `zelyq vault run` |
| [`apps/registry`](./apps/registry) | El registro de plugins firmados |
| [`@zelyq/core`](./packages/core) | Tipos de dominio, el formato de los archivos de pipeline y el protocolo |
| [`@zelyq/runtime`](./packages/runtime) | `RuntimeDriver` y sus implementaciones; el único código que inicia procesos |
| [`@zelyq/db`](./packages/db) | Esquema y migraciones de Drizzle: SQLite por defecto, PostgreSQL para escalar |
| [`@zelyq/tools`](./packages/tools) | Las herramientas del agente, escritas una vez para el `RuntimeDriver` |

Todos los detalles: [Arquitectura](./docs/architecture.md).

---

## Seguridad

Zelyq está hecho para ser inspeccionado: almacenamiento sencillo, archivos normales, sin telemetría,
y secretos cifrados en reposo que nunca pasan por una línea de comandos ni quedan en un registro.
Conoce estos límites antes de desplegar:

- **El modo de ejecución `local` no es un sandbox.** Los comandos del agente se ejecutan con el
  usuario del servidor. Úsalo para una persona de confianza en una sola máquina. Para cualquier uso
  compartido o expuesto a internet, define `ZELYQ_RUNTIME=container`.
- **La red de salida del modo contenedor está abierta por defecto.** Siempre bloquea el endpoint de
  metadatos de la nube y el tráfico entre proyectos. Define `ZELYQ_CONTAINER_EGRESS_ALLOWLIST` para
  restringir el resto, o usa el [sandbox estricto](./docs/strict-sandbox.md) para código no fiable.

Lee el [modelo de amenazas](./SECURITY.md#threat-model--read-this-before-deploying) antes de
desplegar, e informa de vulnerabilidades en privado como se explica en [SECURITY.md](./SECURITY.md).

## Estado

Zelyq es **joven y avanza rápido**. Apps, Studio, Agentes, Vault, Pipelines, Despliegues y Ops
funcionan de principio a fin y se usan a diario. Espera cambios incompatibles antes de la `1.0`.
Consulta la [hoja de ruta](./docs/roadmap.md).

## Contribuir

Las issues, discusiones y pull requests son bienvenidas. [CONTRIBUTING.md](./CONTRIBUTING.md) explica
el ciclo de desarrollo, la estructura del repositorio y dónde suele ir un cambio. Antes de abrir un
pull request, ejecuta `pnpm lint`, `pnpm typecheck` y `pnpm test`. Todas las personas que participan
siguen el [código de conducta](./CODE_OF_CONDUCT.md).

## Licencia

Zelyq es **open source** bajo la [GNU AGPL-3.0](./LICENSE): ejecútalo, modifícalo, alójalo tú mismo,
haz un fork. Si ofreces un Zelyq *modificado* como servicio a otros a través de una red, la AGPL te
obliga a ofrecerles tu código fuente.

Hay una **licencia comercial** (el mismo código sin la obligación de la AGPL de compartir el código
en red) para productos de código cerrado y organizaciones cuya política excluye el software AGPL:
**support@dee-empire.com**. Las funciones marcadas como "Zelyq Enterprise" (rutas `ee/`) son una
suscripción aparte bajo la [Zelyq Enterprise License](./LICENSE_EE.md). [LICENSING.md](./LICENSING.md)
lo explica con palabras sencillas. Las versiones hasta `v0.1.0` incluida siguen disponibles bajo
Apache-2.0.

<div align="center">
<br />

© 2026 [Dee Empire](https://dee-empire.com) · "Zelyq" y el logotipo de Zelyq son marcas de Dee Empire.

</div>
