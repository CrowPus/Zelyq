import type { Articles } from "./articles";

export const articles: Articles = {
  start: {
    title: "Como se orientar no Zelyq",
    body: `O Zelyq é organizado por **equipe**. Tudo o que uma equipe cria (seus apps, pipelines, ambientes e segredos) pertence a ela, e todos da equipe podem ver.

- **Barra lateral.** À esquerda: **Início**, depois **Criar** (Apps, Studio, Agentes), **Entregar** (Pipelines, Implantações, Ops) e **Proteger** (Vault). Dentro de um app, a barra lateral mostra as seções desse app.
- **Barra superior.** O seletor de equipe e a trilha de navegação mostram onde você está. A pesquisa (**Ctrl K** ou **⌘ K**) encontra qualquer app, pipeline ou ambiente, e leva a qualquer página, inclusive o Vault e as configurações.
- **Caixa de entrada.** O sino reúne o que está aguardando você, como uma implantação ou o pedido de um agente para aprovar.
- **Ajuda.** O menu **?** abre estes artigos, os atalhos de teclado e o guia completo para iniciantes.

O **Início** mostra primeiro o que precisa de atenção: o que está falhando ou aguardando você, depois seus apps e execuções recentes.

Troque de equipe pelo nome dela, no canto superior esquerdo. Sua conta, seu idioma e sua segurança ficam embaixo da sua foto, no canto superior direito.`,
  },
  apps: {
    title: "Apps",
    body: `Um **app** é um projeto que o agente constrói com você: um site, uma aplicação web, uma API ou um app para celular. Cada um tem os próprios arquivos, a própria pré-visualização e o próprio histórico.

**Crie um** com **Novo app**. Escolha um ponto de partida (uma **stack**, como React + Vite ou FastAPI), dê um nome e descreva o que você quer.

**Encontre um** com a caixa de pesquisa (aperte **/** para ir até ela), ou filtre por status e stack. Alterne entre cartões e lista com os botões à direita; a lista pode ser ordenada por qualquer coluna.

**Abra um app** para continuar construindo. A **Visão geral** dele mostra a pré-visualização, onde ele está no ar e os detalhes; as **Configurações** guardam o nome e o que o agente pode fazer.

Os apps pertencem à equipe: todos dela podem abri-los. O que cada pessoa pode alterar depende do papel dela (veja **Membros e papéis**).`,
  },
  build: {
    title: "Construindo com o agente",
    body: `É aqui que um app é feito. À esquerda você conversa com o agente; à direita você vê o resultado.

- **Chat.** Descreva o que você quer com palavras simples. O agente trabalha em um espaço de trabalho real: cada alteração é um arquivo que você pode ler em **Código**.
- **Pré-visualização.** Uma cópia privada do app, rodando aqui. Use o inspetor para apontar para algo e pedir uma alteração exatamente nisso.
- **Modos.** Os botões abaixo da caixa de mensagem ativam o **Arquiteto** (planeja um projeto inteiro primeiro), o **Engenheiro** (alterações cuidadosas e verificadas) e o **Auto** (continua até o trabalho terminar).
- **Menu /.** Digite **/** para ver comandos como **/clone** e **/figma**, agentes especialistas (Design, DevOps, Segurança/QA), skills e modelos.

**Desfazer.** **Snapshots** guarda um ponto de restauração antes de cada alteração, para você voltar a qualquer versão anterior.

**Variáveis** guarda as configurações e as chaves do app; um valor pode vir do Vault para ficar em um só lugar. **Git** faz commit e push do código do app para um repositório que você conectar.

Quando funcionar, clique em **Implantar** para colocá-lo no ar, ou configure um pipeline que o teste e implante a cada alteração.`,
  },
  "app-settings": {
    title: "Visão geral e configurações de um app",
    body: `A **Visão geral** é o app em um relance: a pré-visualização ao vivo, os ambientes em que ele roda e os endereços deles, e detalhes como a stack, o ID e quando ele mudou pela última vez.

As **Configurações** são onde o próprio app é alterado:

- **Nome do app.** Aparece na lista de apps, na trilha de navegação e na aba do navegador.
- **O que o agente pode fazer.** Gerar imagens e gerar vídeo gastam dinheiro das chaves de IA da equipe, por isso os dois começam desligados. Ligue-os aqui.
- **Zona de perigo.** Excluir um app remove os arquivos, a pré-visualização e o histórico dele.

O que cada pessoa pode alterar depende do papel dela na equipe.`,
  },
  pipelines: {
    title: "Pipelines",
    body: `Um **pipeline** testa, constrói e implanta um app, sempre do mesmo jeito. Ele é um arquivo de **fases** que rodam em ordem; cada fase tem **etapas** (comandos, um checkout, um cache, uma implantação).

**Crie um** com **Novo pipeline** e um modelo. Edite em **Visual** (clique em caixas e campos) ou em **YAML** (o próprio arquivo); os dois mostram o mesmo pipeline.

- **Roda em.** \`local\` roda no servidor do Zelyq, em um contêiner descartado depois. Um **runner** é uma das suas próprias máquinas, adicionada em **Runners** e acessada por SSH.
- **Origem.** De onde vêm os arquivos: um app no Zelyq, um repositório do GitHub ou uma pasta em uma máquina.
- **Segredos.** Nunca escreva uma chave no arquivo. Use \`vault://NOME\` e o Zelyq preenche; os segredos são mascarados em todos os logs.
- **Gatilhos.** Execute manualmente, em um agendamento ou a cada push e pull request do GitHub.

Cada pipeline guarda as próprias versões, então um arquivo anterior pode ser restaurado. Os **Plugins** adicionam etapas prontas.`,
  },
  runs: {
    title: "Lendo uma execução de pipeline",
    body: `Uma execução é uma rodada de um pipeline. O diagrama mostra cada **fase** como uma caixa, ligadas na ordem em que rodam; fases lado a lado rodam ao mesmo tempo.

- **Cores.** Verde deu certo, vermelho falhou, azul está rodando, cinza está aguardando ou foi ignorado.
- **Etapas e saída.** Clique em uma fase para ver as etapas dela. Clique em uma etapa para ler o que ela imprimiu. Se uma etapa falhou, as últimas linhas da saída costumam dizer por quê.
- **Aguardando aprovação.** Uma implantação em um ambiente protegido fica parada até um administrador clicar em **Aprovar**. Ela também aparece na caixa de entrada.

**Executar de novo** roda o mesmo arquivo mais uma vez. **Cancelar** para uma execução que ainda está em andamento; o que ela já implantou fica como estava.

Uma execução registra quem ou o que a iniciou (uma pessoa, um agendamento, um push) e quanto tempo cada fase levou.`,
  },
  deployments: {
    title: "Implantações e ambientes",
    body: `Um **ambiente** é um lugar onde um app roda: \`staging\` ou \`production\`, em uma das suas máquinas. **Implantações** lista cada ambiente com os apps no ar nele, qual versão, desde quando e quem a colocou lá.

- **Implantar.** A etapa de implantação de um pipeline, ou o botão **Implantar** de um app, inicia o app no Docker na máquina, verifica se ele responde e mantém a versão anterior se não responder.
- **Logs e controles.** No cartão de um app, **Logs · gerenciar** mostra a saída ao vivo com CPU e memória, além de **Reiniciar** e **Parar**.
- **Reverter.** **Histórico** lista cada implantação; **Voltar para este** traz uma anterior de volta em segundos.
- **Protegido.** Toda implantação em um ambiente protegido aguarda a aprovação de um administrador. **Congelar** para todas as implantações durante um release.
- **Endereços.** Dê um domínio a um app e o Zelyq consegue para ele um certificado HTTPS gratuito.

As **Variáveis** de um ambiente são passadas para todos os apps nele, e podem vir do Vault.`,
  },
  vault: {
    title: "Vault",
    body: `O **Vault** guarda uma só vez, criptografadas, as chaves e senhas da equipe, para que possam ser usadas em qualquer lugar sem serem copiadas: nas variáveis de um app, nas configurações, nos pipelines (\`vault://NOME\`) ou nos seus próprios servidores.

- **Adicione um segredo** com um nome como \`STRIPE_KEY_LIVE\`, o valor e uma nota sobre para que ele serve. **Importar .env** adiciona vários de uma vez.
- **A tabela** mostra cada segredo, onde ele é usado, quando mudou pela última vez e quem mudou. Quando há mais de cinco, pesquise nela ou mostre só os protegidos ou os não usados.
- **Mostre ou copie um valor** pelo menu da linha. Você é perguntado antes, e isso fica registrado em **Atividade** com o seu nome.
- **Alterar valor** salva uma nova versão; **Histórico** lista todas as versões e pode restaurar uma anterior. Tudo que usa o segredo recebe o novo valor.
- Segredos **Protegidos** só podem ser mostrados, alterados ou usados por administradores e proprietários. Use para chaves de produção.

As **Chaves de serviço** deixam um servidor fora do Zelyq ler os segredos que ele tem permissão para ler, e nada mais.`,
  },
  members: {
    title: "Membros e papéis",
    body: `Todos de uma equipe veem todos os apps dela. O **papel** de cada um decide o que ele pode alterar:

- **Leitor** lê os apps, os arquivos e as conversas deles, e não altera nada.
- **Editor** também constrói, edita e roda pré-visualizações.
- **Administrador** também gerencia membros, agentes e as configurações da equipe, e exclui apps.
- **Proprietário** tem controle total, inclusive da própria equipe.

**Adicione alguém** por e-mail. Quem já tem conta entra na hora; qualquer outra pessoa recebe um convite que funciona por 7 dias, quando o e-mail está configurado neste servidor. **Aguardando entrar** lista os convites ainda não usados.

**A tabela** pode ser ordenada, e dá para pesquisar nela quando a equipe tem mais de cinco pessoas. **Última atividade** mostra quando cada pessoa usou o Zelyq pela última vez. Administradores alteram um papel ali mesmo; o menu da linha remove alguém ou permite que você saia.

**Quem alterou o quê** lista cada alteração na equipe: quem foi adicionado ou removido, qual papel mudou e quem mudou.`,
  },
  agents: {
    title: "Agentes externos",
    body: `Um **agente** deixa uma ferramenta de IA externa (Claude Code, Cursor, VS Code, Gemini CLI ou qualquer coisa que fale MCP) trabalhar dentro do Zelyq, com o próprio modelo e a própria assinatura. O Zelyq dá a ela acesso aos apps, pipelines e ambientes que você escolher, e a nada mais.

**Crie um** com **Novo agente**: dê um nome e uma função (a primeira coisa que ele lê), marque o que ele pode acessar e defina cada permissão como **Desativado**, **Permitido** ou **Precisa de aprovação**.

- Ler e escrever código cria um ponto de restauração antes, para que o trabalho dele possa ser revertido.
- Fazer push, executar pipelines e alterar implantações são sempre pedidos que uma pessoa aprova, na caixa de entrada.
- Ele vê quais segredos um app recebe, nunca os valores.

A chave é mostrada uma vez. Copie da página a configuração para a sua ferramenta, e substitua ou revogue a chave quando quiser. Só administradores e proprietários gerenciam agentes.`,
  },
  ops: {
    title: "Ops, seu engenheiro de DevOps",
    body: `O **Ops** cuida das máquinas, dos ambientes e dos apps da equipe. Converse com ele como com um colega: pergunte por que algo está lento, o que mudou, ou peça para corrigir.

- **Conversar.** Digite, ou toque no microfone e fale; ele responde em voz alta.
- **Planos.** O Ops olha livremente, mas cada alteração é um plano de etapas exatas. **Aprovar** deixa ele fazer essas etapas e nada mais; **Rejeitar** com um motivo, e ele lembra.
- **Status.** Verificado a cada minuto pelo próprio Zelyq, sem IA e sem custo.
- **Alertas.** O que deu errado, quando, e o que o Ops fez a respeito.
- **Memória.** Regras que ele lê antes de cada tarefa, como "nunca implantar na sexta à tarde". A palavra de uma pessoa vale mais que as conclusões dele.
- **Acesso.** Quais máquinas e ambientes ele pode acessar, e o quanto ele é confiável em cada um.

As **Configurações** guardam o limite de gastos mensal dele, e **Pausar o Ops** interrompe na hora tudo o que ele está fazendo.`,
  },
  studio: {
    title: "Studio",
    body: `O **Studio** cria imagens e vídeos para os seus apps.

- **Imagem.** Descreva a imagem, escolha um modelo e um tamanho, e adicione imagens de referência se o modelo aceitar. Cada resultado fica no histórico de imagens.
- **Vídeo.** Descreva uma cena, ou anime uma imagem a partir do quadro inicial. Um clipe leva alguns minutos e custa bem mais que uma imagem.
- **Use.** Baixe um resultado, ou escolha-o no Studio enquanto constrói um app.

O Studio usa as chaves de imagem e vídeo da própria equipe, definidas em **Configurações da equipe**. Se nenhum modelo aparecer, um administrador precisa adicionar uma chave antes.`,
  },
  "team-settings": {
    title: "Configurações da equipe",
    body: `Tudo o que uma equipe decide por conta própria, agrupado no menu à esquerda. Administradores e proprietários alteram.

- **Uso e plano.** O que a equipe usa: apps, armazenamento, builds, e o quanto ela está perto dos limites.
- **Chaves de IA.** As chaves da própria equipe para os modelos que constroem apps, o Studio e a voz. Uma chave pode vir do Vault da equipe.
- **Construção de apps.** Qual modelo o agente usa e o quanto ele pensa.
- **Image Studio, Video Studio, Entrada de voz.** Os modelos e as opções de cada um.
- **Ops.** Se o engenheiro de DevOps da equipe está ligado, e os limites dele.
- **E-mail.** O servidor de e-mail da própria equipe, para os e-mails que o Zelyq envia em nome dela.
- **Integrações.** GitHub, Figma, Supabase e outras.
- **Acesso do suporte.** Deixe o suporte do Zelyq olhar a equipe por 48 horas; cada consulta fica registrada.

Uma alteração vale para a equipe inteira assim que é salva.`,
  },
  account: {
    title: "Sua conta",
    body: `Sua conta é sua em todas as equipes de que você participa.

- **Perfil.** Seu nome e o e-mail com que você entra. **Excluir conta** a remove de vez.
- **Segurança.** Altere sua senha (todos os outros dispositivos são desconectados). Ative o **login em duas etapas** com um app autenticador e guarde os códigos de recuperação em um lugar seguro. **Dispositivos conectados** lista todos os navegadores que usam sua conta; desconecte qualquer um deles.
- **Preferências.** Seu idioma (inglês, francês, alemão, espanhol, português ou chinês), seu fuso horário e como datas e números são escritos. Todos os dispositivos em que você entra seguem essas escolhas.

O tema (claro, escuro ou igual ao sistema) fica no menu embaixo da sua foto.`,
  },
  admin: {
    title: "Administração do servidor",
    body: `A administração do servidor é para as pessoas que operam este servidor do Zelyq. Ela altera coisas para todas as equipes.

- **Modelos e IA.** Com qual provedor o agente fala, geração de imagens e vídeo, entrada de voz e o modelo com que o Ops pensa.
- **Execução e pré-visualização.** Onde os comandos dos apps rodam, como as pré-visualizações são acessadas e os padrões dos pipelines.
- **Identidade e acesso.** Quem pode entrar e por quanto tempo, as contas deste servidor e as chaves da API de administração.
- **Comunicação.** O servidor de e-mail por onde o Zelyq envia, e as integrações.
- **Planos.** O que cada equipe pode usar.
- **Status da instância.** A saúde do servidor e das partes dele.

Cada equipe ainda pode escolher as próprias chaves e modelos nas **Configurações da equipe**; as do servidor são o padrão.`,
  },
};
