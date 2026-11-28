import type { Articles } from "./articles";

export const articles: Articles = {
  start: {
    title: "Cómo moverse por Zelyq",
    body: `Zelyq se organiza por **equipo**. Todo lo que crea un equipo (sus apps, pipelines, entornos y secretos) le pertenece, y todos sus miembros pueden verlo.

- **Barra lateral.** A la izquierda: **Inicio**, luego **Crear** (Apps, Studio, Agentes), **Entregar** (Pipelines, Despliegues, Ops) y **Proteger** (Vault). Dentro de una app, la barra lateral muestra en su lugar las secciones de esa app.
- **Barra superior.** El selector de equipo y la ruta de navegación muestran dónde estás. La búsqueda (**Ctrl K** o **⌘ K**) encuentra cualquier app, pipeline o entorno, y te lleva a cualquier página, incluidos Vault y la configuración.
- **Bandeja de entrada.** La campana reúne lo que te espera, como un despliegue o la solicitud de un agente que aprobar.
- **Ayuda.** El menú **?** abre estos artículos, los atajos de teclado y la guía completa para principiantes.

**Inicio** muestra primero lo que requiere atención: lo que falla o te espera, y después tus apps y ejecuciones recientes.

Cambia de equipo desde su nombre, arriba a la izquierda. Tu cuenta, tu idioma y tu seguridad están bajo tu foto, arriba a la derecha.`,
  },
  apps: {
    title: "Apps",
    body: `Una **app** es un proyecto que el agente construye contigo: un sitio web, una aplicación web, una API o una app móvil. Cada una tiene sus propios archivos, su propia vista previa y su propio historial.

**Crea una** con **Nueva app**. Elige un punto de partida (un **stack**, como React + Vite o FastAPI), ponle un nombre y describe lo que quieres.

**Encuentra una** con el cuadro de búsqueda (pulsa **/** para ir a él), o filtra por estado y stack. Cambia entre tarjetas y lista con los botones de la derecha; la lista se puede ordenar por cualquier columna.

**Abre una app** para seguir construyéndola. Su **Resumen** muestra su vista previa, dónde está en línea y sus detalles; **Configuración** contiene su nombre y lo que puede hacer el agente.

Las apps pertenecen al equipo: todos sus miembros pueden abrirlas. Lo que cada persona puede cambiar depende de su rol (consulta **Miembros y roles**).`,
  },
  build: {
    title: "Construir con el agente",
    body: `Aquí es donde se hace una app. A la izquierda hablas con el agente; a la derecha ves el resultado.

- **Chat.** Describe lo que quieres con palabras sencillas. El agente trabaja en un espacio de trabajo real: cada cambio es un archivo que puedes leer en **Código**.
- **Vista previa.** Una copia privada de la app, en marcha aquí. Usa el inspector para señalar algo y pedir un cambio justo en eso.
- **Modos.** Los botones bajo el cuadro de mensaje activan **Arquitecto** (planifica primero un proyecto entero), **Ingeniero** (cambios cuidadosos y comprobados) y **Auto** (sigue hasta terminar el trabajo).
- **Menú /.** Escribe **/** para ver comandos como **/clone** y **/figma**, agentes especialistas (Diseño, DevOps, Seguridad/QA), skills y modelos.

**Deshacer.** **Instantáneas** guarda un punto de restauración antes de cada cambio, para que puedas volver a cualquier versión anterior.

**Variables** contiene la configuración y las claves de la app; un valor puede venir de Vault para tenerlo en un solo lugar. **Git** confirma y envía el código de la app a un repositorio que conectes.

Cuando funcione, pulsa **Desplegar** para ponerla en línea, o configura un pipeline que la pruebe y la despliegue con cada cambio.`,
  },
  "app-settings": {
    title: "Resumen y configuración de una app",
    body: `**Resumen** es la app de un vistazo: su vista previa en directo, los entornos donde se ejecuta y sus direcciones, y detalles como su stack, su ID y cuándo cambió por última vez.

**Configuración** es donde se cambia la propia app:

- **Nombre de la app.** Se muestra en la lista de apps, la ruta de navegación y la pestaña del navegador.
- **Qué puede hacer el agente.** Generar imágenes y generar video gastan dinero con las claves de IA del equipo, por eso ambas opciones empiezan desactivadas. Actívalas aquí.
- **Zona de peligro.** Eliminar una app quita sus archivos, su vista previa y su historial.

Lo que cada persona puede cambiar depende de su rol en el equipo.`,
  },
  pipelines: {
    title: "Pipelines",
    body: `Un **pipeline** prueba, construye y despliega una app, siempre de la misma forma. Es un archivo de **fases** que se ejecutan en orden; cada fase tiene **pasos** (comandos, un checkout, una caché, un despliegue).

**Crea uno** con **Nuevo pipeline** y una plantilla. Edítalo en **Visual** (haz clic en recuadros y campos) o en **YAML** (el propio archivo); ambos muestran el mismo pipeline.

- **Se ejecuta en.** \`local\` lo ejecuta en el servidor de Zelyq, en un contenedor que se desecha después. Un **runner** es una de tus propias máquinas, añadida en **Runners** y a la que se accede por SSH.
- **Origen.** De dónde vienen los archivos: una app de Zelyq, un repositorio de GitHub o una carpeta de una máquina.
- **Secretos.** Nunca escribas una clave en el archivo. Usa \`vault://NOMBRE\` y Zelyq la rellena; los secretos se ocultan en todos los registros.
- **Disparadores.** Ejecútalo a mano, según una programación o con cada push y pull request de GitHub.

Cada pipeline guarda sus versiones, así que se puede restaurar un archivo anterior. Los **Plugins** añaden pasos ya preparados.`,
  },
  runs: {
    title: "Leer una ejecución de pipeline",
    body: `Una ejecución es una pasada de un pipeline. El diagrama muestra cada **fase** como un recuadro, unidas en el orden en que se ejecutan; las fases que están una al lado de otra se ejecutan a la vez.

- **Colores.** Verde es correcto, rojo es fallido, azul está en marcha, gris está esperando u omitido.
- **Pasos y salida.** Haz clic en una fase para ver sus pasos. Haz clic en un paso para leer lo que imprimió. Si un paso falló, las últimas líneas de su salida suelen decir por qué.
- **Esperando aprobación.** Un despliegue a un entorno protegido se detiene hasta que un administrador pulsa **Aprobar**. También aparece en la bandeja de entrada.

**Volver a ejecutar** ejecuta el mismo archivo otra vez. **Cancelar** detiene una ejecución que sigue en marcha; lo que ya desplegó se queda como estaba.

Una ejecución registra quién o qué la inició (una persona, una programación, un push) y cuánto tardó cada fase.`,
  },
  deployments: {
    title: "Despliegues y entornos",
    body: `Un **entorno** es un lugar donde se ejecuta una app: \`staging\` o \`production\`, en una de tus máquinas. **Despliegues** lista cada entorno con las apps en línea en él, qué versión, desde cuándo y quién la puso ahí.

- **Desplegar.** El paso de despliegue de un pipeline, o el botón **Desplegar** de una app, inicia la app en Docker en la máquina, comprueba que responde y conserva la versión anterior si no lo hace.
- **Registros y controles.** En la tarjeta de una app, **Registros · gestionar** muestra su salida en directo con su CPU y su memoria, y **Reiniciar** y **Detener**.
- **Revertir.** **Historial** lista cada despliegue; **Volver a este** recupera uno anterior en segundos.
- **Protegido.** Cada despliegue a un entorno protegido espera la aprobación de un administrador. **Congelar** detiene todos los despliegues durante una publicación.
- **Direcciones.** Da un dominio a una app y Zelyq le consigue un certificado HTTPS gratuito.

Las **Variables** de un entorno se dan a todas las apps que hay en él, y pueden venir de Vault.`,
  },
  vault: {
    title: "Vault",
    body: `**Vault** guarda una sola vez, cifradas, las claves y contraseñas del equipo, para usarlas en cualquier parte sin copiarlas: en las variables de una app, en la configuración, en los pipelines (\`vault://NOMBRE\`) o desde tus propios servidores.

- **Añade un secreto** con un nombre como \`STRIPE_KEY_LIVE\`, su valor y una nota sobre para qué sirve. **Importar .env** añade muchos a la vez.
- **La tabla** muestra cada secreto, dónde se usa, cuándo cambió por última vez y quién lo cambió. Cuando hay más de cinco, busca en ella o muestra solo los protegidos o los que no se usan.
- **Muestra o copia un valor** desde el menú de la fila. Primero se te pregunta, y queda registrado en **Actividad** con tu nombre.
- **Cambiar valor** guarda una versión nueva; **Historial** lista todas las versiones y puede restaurar una anterior. Todo lo que usa el secreto recibe el valor nuevo.
- Los secretos **Protegidos** solo pueden mostrarlos, cambiarlos o usarlos los administradores y propietarios. Úsalo para las claves de producción.

Las **Claves de servicio** permiten que un servidor fuera de Zelyq lea los secretos que tiene permitidos, y nada más.`,
  },
  members: {
    title: "Miembros y roles",
    body: `Todos los miembros de un equipo ven todas sus apps. Su **rol** decide lo que pueden cambiar:

- **Lector** lee las apps, sus archivos y conversaciones, y no cambia nada.
- **Editor** además construye, edita y ejecuta vistas previas.
- **Administrador** además gestiona los miembros, los agentes y la configuración del equipo, y elimina apps.
- **Propietario** tiene el control total, incluido el propio equipo.

**Añade a alguien** por correo. Quien ya tiene cuenta se une al momento; cualquier otra persona recibe una invitación válida durante 7 días, si el correo está configurado en este servidor. **Pendientes de unirse** lista las invitaciones aún sin usar.

**La tabla** se puede ordenar, y se puede buscar en ella cuando el equipo tiene más de cinco personas. **Última actividad** muestra cuándo usó Zelyq cada persona por última vez. Los administradores cambian un rol ahí mismo; el menú de la fila quita a alguien o te permite salir.

**Quién cambió qué** lista cada cambio en el equipo: a quién se añadió o quitó, qué rol cambió y quién lo hizo.`,
  },
  agents: {
    title: "Agentes externos",
    body: `Un **agente** permite que una herramienta de IA externa (Claude Code, Cursor, VS Code, Gemini CLI o cualquier cosa que hable MCP) trabaje dentro de Zelyq, con su propio modelo y su propia suscripción. Zelyq le da acceso a las apps, pipelines y entornos que elijas, y a nada más.

**Crea uno** con **Nuevo agente**: dale un nombre y una tarea (lo primero que lee), marca a qué puede acceder y pon cada permiso en **Desactivado**, **Permitido** o **Requiere aprobación**.

- Leer y escribir código guarda antes un punto de restauración, para que su trabajo se pueda deshacer.
- Hacer push, ejecutar pipelines y cambiar despliegues son siempre solicitudes que aprueba una persona, en la bandeja de entrada.
- Ve qué secretos recibe una app, nunca sus valores.

La clave se muestra una vez. Copia de la página la configuración para tu herramienta, y reemplaza o revoca la clave cuando quieras. Solo los administradores y propietarios gestionan los agentes.`,
  },
  ops: {
    title: "Ops, tu ingeniero DevOps",
    body: `**Ops** cuida de las máquinas, los entornos y las apps del equipo. Háblale como a un compañero: pregúntale por qué algo va lento, qué ha cambiado, o pídele que lo arregle.

- **Hablar.** Escribe, o pulsa el micrófono y habla; responde en voz alta.
- **Planes.** Ops mira libremente, pero cada cambio es un plan de pasos exactos. **Aprobar** le permite hacer esos pasos y nada más; **Rechazar** con un motivo, y lo recordará.
- **Estado.** Lo comprueba el propio Zelyq cada minuto, sin IA y sin coste.
- **Alertas.** Qué salió mal, cuándo y qué hizo Ops al respecto.
- **Memoria.** Reglas que lee antes de cada tarea, como "no desplegar nunca el viernes por la tarde". La palabra de una persona pesa más que sus propias conclusiones.
- **Acceso.** A qué máquinas y entornos puede llegar, y cuánta confianza tiene en cada uno.

**Configuración** contiene su límite de gasto mensual, y **Pausar Ops** detiene al instante todo lo que está haciendo.`,
  },
  studio: {
    title: "Studio",
    body: `**Studio** crea imágenes y videos para tus apps.

- **Imagen.** Describe la imagen, elige un modelo y un tamaño, y añade imágenes de referencia si el modelo las admite. Cada resultado se guarda en el historial de imágenes.
- **Video.** Describe una escena, o anima una imagen a partir de su fotograma inicial. Un clip tarda unos minutos y cuesta mucho más que una imagen.
- **Úsalo.** Descarga un resultado, o elígelo desde Studio mientras construyes una app.

Studio usa las claves de imagen y video propias del equipo, definidas en **Configuración del equipo**. Si no se ofrece ningún modelo, un administrador debe añadir antes una clave.`,
  },
  "team-settings": {
    title: "Configuración del equipo",
    body: `Todo lo que un equipo decide por sí mismo, agrupado en el menú de la izquierda. Los administradores y propietarios lo cambian.

- **Uso y plan.** Lo que usa el equipo: apps, almacenamiento, compilaciones, y lo cerca que está de sus límites.
- **Claves de IA.** Las claves propias del equipo para los modelos que construyen apps, Studio y la voz. Una clave puede venir del Vault del equipo.
- **Construcción de apps.** Qué modelo usa el agente y cuánto piensa.
- **Image Studio, Video Studio, Entrada de voz.** Los modelos y las opciones de cada uno.
- **Ops.** Si el ingeniero DevOps del equipo está activado, y sus límites.
- **Correo.** El servidor de correo propio del equipo, para los correos que Zelyq envía en su nombre.
- **Integraciones.** GitHub, Figma, Supabase y otras.
- **Acceso de soporte.** Deja que el soporte de Zelyq mire el equipo durante 48 horas; cada consulta queda registrada.

Un cambio se aplica a todo el equipo en cuanto se guarda.`,
  },
  account: {
    title: "Tu cuenta",
    body: `Tu cuenta es tuya en todos los equipos de los que formas parte.

- **Perfil.** Tu nombre y el correo con el que inicias sesión. **Eliminar cuenta** la borra para siempre.
- **Seguridad.** Cambia tu contraseña (se cierra la sesión en todos los demás dispositivos). Activa el **inicio de sesión en dos pasos** con una app de autenticación y guarda los códigos de recuperación en un lugar seguro. **Dispositivos con sesión iniciada** lista todos los navegadores que usan tu cuenta; cierra la sesión en cualquiera de ellos.
- **Preferencias.** Tu idioma (inglés, francés, alemán, español, portugués o chino), tu zona horaria y cómo se escriben las fechas y los números. Todos los dispositivos en los que inicias sesión los siguen.

El tema (claro, oscuro o igual que el sistema) está en el menú bajo tu foto.`,
  },
  admin: {
    title: "Administración del servidor",
    body: `La administración del servidor es para quienes gestionan este servidor de Zelyq. Cambia cosas para todos los equipos.

- **Modelos e IA.** Con qué proveedor habla el agente, la generación de imágenes y video, la entrada de voz y el modelo con el que piensa Ops.
- **Ejecución y vista previa.** Dónde se ejecutan los comandos de las apps, cómo se accede a las vistas previas y los valores predeterminados de los pipelines.
- **Identidad y acceso.** Quién puede iniciar sesión y durante cuánto tiempo, las cuentas de este servidor y las claves de la API de administración.
- **Comunicación.** El servidor de correo por el que envía Zelyq, y las integraciones.
- **Planes.** Lo que puede usar cada equipo.
- **Estado de la instancia.** La salud del servidor y de sus partes.

Cada equipo puede seguir eligiendo sus propias claves y modelos en su **Configuración del equipo**; las del servidor son las predeterminadas.`,
  },
};
