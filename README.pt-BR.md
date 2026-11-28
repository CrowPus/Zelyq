<div align="center">

<img src="assets/brand/zelyq-banner.png" alt="Zelyq: build, automate and ship software with AI" width="100%" />

[English](./README.md) · [Français](./README.fr.md) · [Deutsch](./README.de.md) · [Español](./README.es.md) · **Português** · [简体中文](./README.zh-CN.md) · [हिन्दी](./README.hi.md) · [Italiano](./README.it.md) · [日本語](./README.ja.md)

### A plataforma open source para criar, proteger, entregar e operar software, tudo em um só lugar.

Crie apps com um agente de IA que trabalha como um engenheiro. Guarde cada credencial em um vault criptografado.
Teste e implante nas suas próprias máquinas, e deixe um engenheiro DevOps de IA cuidar do que está rodando.
**Auto-hospedado ou na nuvem. Seu próprio modelo. Sem telemetria.**

[![CI](https://github.com/CrowPus/Zelyq/actions/workflows/ci.yml/badge.svg)](https://github.com/CrowPus/Zelyq/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520.12-brightgreen.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)](./tsconfig.base.json)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-black.svg)](./CONTRIBUTING.md)

**[Site](https://zelyq.dev)** · **[Experimente online](https://app.zelyq.dev)** · [Início rápido](#início-rápido) ·
[Tutorial](./docs/tutorial.md) · [Documentação](./docs/README.md) · [Auto-hospedagem](./docs/self-hosting.md) ·
[Arquitetura](./docs/architecture.md) · [Roadmap](./docs/roadmap.md) · [Contribuir](./CONTRIBUTING.md)

</div>

---

## Conteúdo

- [Por que Zelyq](#por-que-zelyq)
- [A plataforma](#a-plataforma): [Apps](#apps), [Studio](#studio), [Agentes](#agentes), [Vault](#vault),
  [Pipelines](#pipelines), [Implantações](#implantações), [Ops](#ops)
- [Equipes, planos e idiomas](#equipes-planos-e-idiomas)
- [Início rápido](#início-rápido) e [atualização](#atualização)
- [Seu próprio modelo](#seu-próprio-modelo)
- [Como funciona](#como-funciona)
- [Segurança](#segurança) · [Situação](#situação) · [Contribuir](#contribuir) · [Licença](#licença)

---

## Por que Zelyq

Entregar software costuma exigir vários produtos: um criador de apps com IA, um gerenciador de
segredos, um serviço de CI, uma ferramenta de implantação e alguém de plantão. São vários logins,
várias faturas e vários lugares por onde uma chave pode vazar. O Zelyq reúne todo o caminho em uma
só plataforma, organizada do jeito que o trabalho acontece:

| | Módulo | O que faz |
| --- | --- | --- |
| **Criar** | **[Apps](#apps)** | Descreva um app. Um agente o planeja, constrói em arquivos reais que são seus e o verifica antes de dizer que terminou |
| | **[Studio](#studio)** | Gere imagens e vídeos, para seus apps ou separadamente |
| | **[Agentes](#agentes)** | Deixe Claude Code, Cursor, VS Code, Gemini CLI ou qualquer cliente MCP trabalhar dentro do Zelyq, com o próprio modelo |
| **Proteger** | **[Vault](#vault)** | Cada credencial guardada uma vez, criptografada, versionada e auditada, e usada por apps, pipelines e seus próprios servidores |
| **Entregar** | **[Pipelines](#pipelines)** | Teste e construa sempre do mesmo jeito, no servidor do Zelyq ou nas suas máquinas Linux, macOS e Windows |
| | **[Implantações](#implantações)** | Coloque apps nas suas máquinas por ambiente, com aprovações, congelamento e reversão automática |
| | **[Ops](#ops)** | Um engenheiro DevOps de IA com quem você conversa: ele planeja, espera sua aprovação, comprova cada mudança e vigia o que está rodando |

Tudo pertence a uma **equipe**. Convide pessoas, dê a cada uma um papel, e todos os módulos seguem
essa regra.

---

## A plataforma

### Apps

Descreva o que você quer. O agente lê, planeja, escreve arquivos, executa comandos e inicia uma
prévia ao vivo. Você vê cada chamada de ferramenta e cada arquivo que ele toca enquanto trabalha.

- **Verificado, não só gerado.** Quando o agente termina, o Zelyq roda a checagem de tipos ou o
  build do projeto e verifica se a prévia não quebra. Uma rodada que quebrou algo volta para o
  agente corrigir, em vez de ser dada como concluída.
- **Claro sobre o que sabe.** O *modo Engenheiro* separa o que foi verificado do que foi suposto,
  cita a alternativa que não escolheu e pergunta antes de qualquer coisa irreversível.
- **Planeja antes de construir.** O *modo Arquiteto* transforma um pedido em um projeto que você pode
  revisar (requisitos, decisões, modelo de dados, API, plano de construção) e espera seu sinal
  verde. O *modo Auto* então executa o plano sozinho, até um limite definido.
- **Especialistas à disposição.** Um designer (`DESIGN.md`), um engenheiro DevOps (CI, Dockerfile,
  configuração de implantação), um engenheiro de segurança/QA (testes e análise de segurança) e um
  engenheiro cinematográfico (páginas animadas com a rolagem).
- **Full stack.** React + Vite, React com backend em Python (FastAPI) ou Expo React Native, cada um
  partindo de um design system. Supabase Postgres com segurança em nível de linha por operação.
- **Comece pelo que já existe.** Importe um repositório do GitHub, recrie um site no ar com
  `/clone <url>` ou parta de um frame do Figma e seus design tokens com `/figma <link>`.
- **Toda rodada pode ser desfeita.** Um snapshot antes de cada rodada, um diff exato do que mudou e
  reversão com um clique. Os projetos são arquivos comuns no disco, que você pode levar com você.

Veja [Modos](./docs/modes.md) e [como o agente se comporta](./docs/agent-behaviour.md).

### Studio

- **Imagem**: OpenAI, Google ou xAI, com imagens de referência e biblioteca privada.
- **Vídeo**: Google Veo ou xAI, a partir de texto ou de uma imagem parada.

O Studio usa suas próprias chaves de provedor, cobradas na sua própria conta. Ative-o para um projeto
e o agente pode criar arte e vídeos para o app que está construindo, dentro dos limites que você
definir. Os clipes podem ser divididos em sequências de imagens para páginas animadas com a rolagem.
Veja [Studio: imagem](./docs/Image-gen/implementation.md) e [Studio: vídeo](./docs/Video-gen/README.md).

### Agentes

Traga a ferramenta de IA que você já usa. Um **agente** deixa Claude Code, Cursor, VS Code, Gemini
CLI, ChatGPT ou qualquer cliente MCP trabalhar dentro do Zelyq com o próprio modelo e a própria
assinatura. O Zelyq dá acesso apenas aos apps, pipelines e ambientes que você escolher.

- **Permissões ajustadas uma a uma**: Desativado, Permitido ou Precisa de aprovação, para ler e
  escrever código, executar comandos, fazer push, pipelines, implantações, Studio e mais.
- **Uma pessoa aprova o que importa.** Push, execuções de pipeline e mudanças de implantação são
  pedidos que esperam na caixa de entrada.
- **Fácil de desfazer.** Um ponto de restauração é criado antes de o agente alterar um app.
- **Valores secretos nunca aparecem.** O agente vê quais segredos um app recebe, só pelo nome.

Veja [Agentes](./docs/agents.md).

### Vault

Guarde cada credencial **uma única vez** e use em todo lugar, sem colar em um arquivo.

- **Criptografado em repouso** (AES-256-GCM), com **histórico de versões**, uma marca **Protegido**
  para chaves de produção e registro de cada exibição e alteração.
- **Usado por referência.** Variáveis de app, chaves de modelo, pipelines e ambientes apontam para
  `vault://NOME`. O valor só é preenchido onde e quando é necessário.
- **Mascarado nos logs.** Um segredo que chega a um log de pipeline aparece como `***`.
- **Seus próprios servidores também.** Busque segredos com uma chave de serviço limitada, ou rode
  `zelyq vault run -- <comando>` para iniciar um processo com eles sem gravar nada em disco.
- **Mude-se importando um `.env`.**

Veja [Vault](./docs/vault.md).

### Pipelines

Um pipeline é um arquivo YAML curto, ou um diagrama que você edita com cliques. As etapas rodam em
ordem, os passos também, e cada passo é um comando ou um bloco pronto.

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

- **Roda onde você escolher.** Em um contêiner descartável no servidor do Zelyq, ou nas suas próprias
  máquinas **Linux, macOS e Windows**. Uma máquina entra com um único comando de instalação e se
  conecta ao Zelyq por HTTPS, sem abrir portas. Máquinas via SSH também são suportadas.
- **Rápido e flexível.** Etapas ao mesmo tempo, uma máquina diferente por etapa, builds em matriz e
  modelos compartilhados entre pipelines.
- **Plugins.** Empacote um passo uma vez, com entradas, segredos do Vault e saídas, e use em
  qualquer pipeline. Veja [Plugins de pipeline](./docs/pipeline-plugins.md).
- **Iniciado por qualquer coisa.** À mão, um git push (com filtros de caminho), um pull request, um
  agendamento, o fim de outro pipeline, uma mudança de app feita pelo agente ou qualquer CI com uma
  chave de serviço.
- **Tudo o que um pipeline de verdade precisa.** Instalação de ferramentas e caches, contêineres de
  serviço (Postgres, Redis), saídas de passos, relatórios JUnit, artefatos, aprovações, novas
  tentativas, tempos limite e controle de concorrência.
- **Devolve o resultado.** ✓ / ✗ no commit e no pull request do GitHub ou GitLab.

Veja [Pipelines](./docs/pipelines.md).

### Implantações

- **Ambientes** como `staging` e `production`, cada um em uma das suas máquinas, cada um com suas
  próprias variáveis. A chave de teste no staging e a de produção na production, ambas do Vault.
- **Implante a partir de um pipeline**, para que o app seja testado antes de sair. O Zelyq constrói a
  imagem na sua máquina, a partir do `Dockerfile` do app ou de um que ele escreve para Node, Python,
  Go e sites estáticos. Não precisa de registry.
- **Reversão automática.** Se a nova versão falhar na verificação de saúde, a anterior volta
  sozinha.
- **Seu próprio domínio com HTTPS**, sem tempo fora do ar entre versões.
- **Logs ao vivo, CPU e memória**, reiniciar e parar, e voltar a uma versão anterior com um clique.
- **Promova** para produção a imagem exata testada no staging, sem construí-la de novo.
- **Ambientes protegidos** esperam a aprovação de um administrador. **Congelar** interrompe todas as
  implantações durante uma entrega.

Veja [Implantar](./docs/deploy.md).

### Ops

**Ops** é o engenheiro DevOps da equipe. Peça a ele, por texto ou em voz alta, para colocar um app no
ar, entregar uma nova versão, configurar um domínio ou explicar por que algo está lento.

- **Ele olha primeiro e mostra um plano.** O Ops observa livremente, mas toda mudança é uma lista de
  passos exatos que espera sua aprovação. Um passo que não pode ser desfeito é confirmado à parte.
- **Ele comprova cada mudança.** O próprio Zelyq verifica o resultado. Um passo só conta como feito
  quando sua verificação passa.
- **Ele nunca para de vigiar.** Sites e apps são verificados a cada minuto, máquinas a cada cinco
  minutos, certificados e domínios todo dia, sem usar modelo. Os alertas chegam por e-mail,
  Telegram, Slack ou Discord.
- **Ele só alcança o que você atribui.** Um administrador entrega ambientes, máquinas, pipelines e
  código, um a um, com um nível de confiança para cada. Ele vê os nomes dos segredos, nunca os
  valores.
- **Ele lembra.** As regras que você passa e as lições do que deu errado ficam guardadas e são lidas
  antes de cada tarefa.
- **Você continua no controle.** Um limite de gasto mensal, e **Pausar Ops** interrompe tudo na
  hora.

---

## Equipes, planos e idiomas

| Papel | Pode |
| --- | --- |
| `viewer` | Ver apps, arquivos, execuções, ambientes e histórico de implantações |
| `editor` | Tudo acima, mais pedir ao agente, rodar pipelines e implantar |
| `admin` | Tudo acima, mais membros, agentes, ambientes, aprovações e segredos protegidos |
| `owner` | Controle total, incluindo a própria equipe |

- **Atividade.** Toda mudança fica registrada na Atividade da equipe: um segredo exibido, um pipeline
  editado, uma implantação revertida.
- **Planos e uso.** Cada equipe tem limites de apps, armazenamento, execuções de pipeline, membros e
  prévias, definidos pelo administrador do servidor.
- **Operar o Zelyq para outros.** O [modo gerenciado](./docs/managed-mode.md) coloca o login atrás do
  seu próprio serviço de contas, e a [API de administração](./docs/admin-api.md) permite que seus
  sistemas gerenciem pessoas, equipes, planos e saúde.
- **Nove idiomas.** A interface e sua ajuda integrada estão em inglês, francês, alemão, espanhol,
  português, chinês, hindi, italiano e japonês, à escolha de cada pessoa.
- **Apps parados dormem.** Apps que ninguém abre há algum tempo podem ir para um bucket compatível
  com S3 ou uma pasta, e acordam sozinhos ao serem abertos. Veja [Armazenamento](./docs/storage.md).

---

## Início rápido

**O jeito mais rápido:** crie uma conta em **[app.zelyq.dev](https://app.zelyq.dev)**. Há um plano
gratuito e nada para instalar.

**Para rodar você mesmo:**

```bash
# Requires Node >= 20.12 and pnpm >= 9
git clone https://github.com/CrowPus/Zelyq.git
cd Zelyq
cp .env.example .env    # your configuration: check it before the first start (below)
pnpm install
pnpm dev                # web :5173 · server :8787 · agent :8788
```

Abra <http://localhost:5173> e crie a primeira conta, que administra a instância. Adicione a chave do
seu modelo em **Configurações → Modelo** (digitada ou do Vault), abra **Apps**, crie um app e
descreva o que você quer.

**Em uma VM ou servidor remoto**, altere isto no `.env` antes da primeira inicialização. Troque
`203.0.113.10` pelo endereço ou domínio da sua máquina:

| Configuração | Valor | Por quê |
| --- | --- | --- |
| `ZELYQ_WEB_HOST` | `0.0.0.0` | Senão a interface só responde na própria máquina |
| `ZELYQ_PREVIEW_HOST` | `203.0.113.10` | Senão as prévias dos apps recusam seu navegador |
| `ZELYQ_CORS_ORIGIN` | `http://203.0.113.10:5173` | O endereço em que você abre o Zelyq |
| `ZELYQ_PUBLIC_URL` | `http://203.0.113.10:5173` | Usado nos links de webhook e de login |
| `ZELYQ_ALLOW_REGISTRATION` | `false`, depois que sua conta existir | Senão qualquer pessoa que encontrar o endereço pode se cadastrar |

Abra a porta 5173 e as portas de prévia (`ZELYQ_PREVIEW_PORT_MIN`–`MAX`, 4300–4399 por padrão) no
firewall. Em uma máquina acessível pela internet, coloque o Zelyq atrás de HTTPS: veja
[Auto-hospedagem](./docs/self-hosting.md). Todas as outras configurações estão explicadas no
`.env.example` e em [Configuração](./docs/configuration.md).

**Com Docker:** `docker compose -f docker/docker-compose.yml up`. Veja
[Auto-hospedagem](./docs/self-hosting.md).

**Depois:** o [tutorial](./docs/tutorial.md) leva um app do Zelyq até a produção, passo a passo:
Vault, um pipeline, sua própria máquina, uma implantação com reversão, e push e pull requests do
GitHub.

### Atualização

Seus dados ficam onde estão. O banco de dados, as mídias geradas e a chave de criptografia ficam em
`data/`, seus apps em `workspace/` e suas configurações em `.env`. O Git ignora os três, e o servidor
aplica as mudanças de banco de dados sozinho ao iniciar.

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

Rode isso com o usuário que clonou o Zelyq. Se o Git parar com `detected dubious ownership`, troque
para esse usuário com `su - <usuário>` em vez de adicionar uma exceção `safe.directory`.

Com Docker: `git pull` e depois `docker compose -f docker/docker-compose.yml up -d --build`. Seus
dados ficam no volume `zelyq-data`, então **nunca** rode `docker compose down -v`, que o apaga.

Mais detalhes, incluindo PostgreSQL: [Auto-hospedagem → Atualização](./docs/self-hosting.md#upgrading).

---

## Seu próprio modelo

| Provedor | `ZELYQ_PROVIDER` | Modelo padrão |
| --- | --- | --- |
| Claude | `anthropic` | `claude-opus-5-5` |
| Gemini | `google` | `gemini-pro-latest` |
| OpenAI | `openai` | `gpt-6.1-terra` |
| Grok (xAI) | `xai` | `grok-4.6` |
| DeepSeek | `deepseek` | `deepseek-v4-flash` |
| Mistral | `mistral` | `mistral-large-latest` |
| Groq | `groq` | `llama-3.3-70b-versatile` |
| OpenRouter | `openrouter` | `anthropic/claude-sonnet-4.6` |
| **O seu**: Ollama, vLLM, LM Studio, qualquer coisa compatível com OpenAI | `custom` | defina `ZELYQ_MODEL` |

Configure as chaves em **Configurações → Modelo**, digitadas ou do Vault, ou deixe cada equipe trazer
as suas em **Configurações da equipe → Chaves de IA**. Um login do Claude Code ou do Codex pode
substituir uma chave de API. Com `custom`, nada dos seus projetos sai da sua rede. Veja
[Configuração](./docs/configuration.md).

---

## Como funciona

Três processos e uma ferramenta de linha de comando, sobre quatro bibliotecas compartilhadas. Os
arquivos e comandos de um app só são alcançados por um caminho, o `RuntimeDriver`, e é isso que faz
local, contêiner e host remoto funcionarem do mesmo jeito.

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

| Parte | Responsabilidade |
| --- | --- |
| [`apps/web`](./apps/web) | A interface: chat, editor e prévia, Studio, Vault, Pipelines, Implantações, Ops |
| [`apps/server`](./apps/server) | Equipes, apps, Vault, o motor de pipelines, as implantações e o Ops; o único processo que fala com o banco de dados |
| [`apps/agent`](./apps/agent) | O loop do modelo. Ele nunca mexe em arquivos sozinho: toda ferramenta passa pelo `RuntimeDriver` |
| [`apps/runner`](./apps/runner) | O runner instalado nas suas máquinas; ele se conecta ao Zelyq e executa pipelines e implantações |
| [`apps/cli`](./apps/cli) | A linha de comando `zelyq`, por exemplo `zelyq vault run` |
| [`apps/registry`](./apps/registry) | O registro de plugins assinados |
| [`@zelyq/core`](./packages/core) | Tipos de domínio, o formato dos arquivos de pipeline e o protocolo |
| [`@zelyq/runtime`](./packages/runtime) | `RuntimeDriver` e suas implementações; o único código que inicia processos |
| [`@zelyq/db`](./packages/db) | Esquema e migrações do Drizzle: SQLite por padrão, PostgreSQL para escalar |
| [`@zelyq/tools`](./packages/tools) | As ferramentas do agente, escritas uma vez para o `RuntimeDriver` |

Todos os detalhes: [Arquitetura](./docs/architecture.md).

---

## Segurança

O Zelyq é feito para ser inspecionado: armazenamento simples, arquivos comuns, sem telemetria, e
segredos criptografados em repouso que nunca passam por uma linha de comando nem vão para um log.
Conheça estes limites antes de implantar:

- **O modo de execução `local` não é um sandbox.** Os comandos do agente rodam com o usuário do
  servidor. Use-o para uma pessoa de confiança em uma só máquina. Para qualquer uso compartilhado ou
  exposto à internet, defina `ZELYQ_RUNTIME=container`.
- **A rede de saída do modo contêiner é aberta por padrão.** Ele sempre bloqueia o endpoint de
  metadados da nuvem e o tráfego entre projetos. Defina `ZELYQ_CONTAINER_EGRESS_ALLOWLIST` para
  restringir o resto, ou use o [sandbox estrito](./docs/strict-sandbox.md) para código não confiável.

Leia o [modelo de ameaças](./SECURITY.md#threat-model--read-this-before-deploying) antes de implantar,
e relate vulnerabilidades em particular como descrito em [SECURITY.md](./SECURITY.md).

## Situação

O Zelyq é **novo e avança rápido**. Apps, Studio, Agentes, Vault, Pipelines, Implantações e Ops
funcionam de ponta a ponta e são usados todos os dias. Espere mudanças incompatíveis antes da `1.0`.
Veja o [roadmap](./docs/roadmap.md).

## Contribuir

Issues, discussões e pull requests são bem-vindos. [CONTRIBUTING.md](./CONTRIBUTING.md) explica o
ciclo de desenvolvimento, a organização do repositório e onde uma mudança costuma ficar. Antes de
abrir um pull request, rode `pnpm lint`, `pnpm typecheck` e `pnpm test`. Todas as pessoas que
participam seguem o [código de conduta](./CODE_OF_CONDUCT.md).

## Licença

O Zelyq é **open source** sob a [GNU AGPL-3.0](./LICENSE): rode, modifique, hospede você mesmo, faça
um fork. Se você oferecer um Zelyq *modificado* como serviço a outras pessoas por uma rede, a AGPL
exige que você ofereça a elas o seu código-fonte.

Uma **licença comercial** (o mesmo código sem a exigência da AGPL de fornecer o código em rede) está
disponível para produtos de código fechado e organizações cuja política exclui software AGPL:
**support@dee-empire.com**. Os recursos marcados como "Zelyq Enterprise" (caminhos `ee/`) são uma
assinatura à parte sob a [Zelyq Enterprise License](./LICENSE_EE.md). [LICENSING.md](./LICENSING.md)
explica em linguagem simples. As versões até `v0.1.0`, inclusive, continuam disponíveis sob
Apache-2.0.

<div align="center">
<br />

© 2026 [Dee Empire](https://dee-empire.com) · "Zelyq" e o logotipo do Zelyq são marcas da Dee Empire.

</div>
