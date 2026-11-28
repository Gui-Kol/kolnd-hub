/**
 * Base de conhecimento do Kolnd Hub para o Absolem (task 35).
 *
 * Fonte da verdade: README raiz, `kolnd-hub/README.md`, `docs/architecture.md`,
 * `CHANGELOG.md` e as telas reais do Hub. Nada aqui é deduzido: recurso que não
 * está documentado deve ser respondido como "não documentado". Cada seção tem
 * `body` curto (≤ 600 caracteres) para caber no orçamento de resposta do
 * `hub_help`; o bloco compacto do prompt vem de `buildHubOverview()`.
 */

export const HUB_KNOWLEDGE_VERSION = '1.0.0'

export interface HubKnowledgeSection {
  readonly id: string
  readonly title: string
  readonly body: string
  /** Termos de busca (não vão para o modelo). */
  readonly keywords: readonly string[]
}

export interface HubKnowledgeTopic {
  readonly id: string
  readonly title: string
}

export interface HubKnowledgeSearchResult {
  /** Seções que casaram com a busca (até `limit`), sem `keywords`. */
  readonly sections: HubKnowledgeTopicBody[]
  /** Bloco compacto sempre presente no prompt. */
  readonly overview: string
  /** Todos os tópicos disponíveis — usado quando não há resultado. */
  readonly topics: readonly HubKnowledgeTopic[]
}

export interface HubKnowledgeTopicBody extends HubKnowledgeTopic {
  readonly body: string
}

export interface HubKnowledgeSearchOptions {
  /** Quantidade máxima de seções devolvidas (padrão 2). */
  readonly limit?: number
}

/** Ordem fixa das 13 seções. */
export const HUB_KNOWLEDGE_SECTIONS: readonly HubKnowledgeSection[] = [
  {
    id: 'visao-geral',
    title: 'Visão geral',
    body:
      'O Kolnd Hub é a central de controle do ecossistema Kolnd no Windows. ' +
      'A barra superior tem cinco páginas: Ferramentas, Biblioteca, Chat, Meu PC e Configurações. ' +
      'Em Ferramentas ficam os cards dos programas (Absolem e Kloud Games), com iniciar, parar, detalhes e logs. ' +
      'O X da janela esconde o Hub na bandeja; para encerrar de verdade use Mais > Encerrar Hub ou Sair na bandeja. ' +
      'O Absolem é distribuído junto com o Hub e o Kloud Games é instalado pelo MSI embutido.',
    keywords: ['kolnd hub', 'o que é o hub', 'visão geral', 'páginas', 'bandeja', 'tray', 'começar']
  },
  {
    id: 'ferramentas',
    title: 'Ferramentas',
    body:
      'Página Ferramentas: cards dos programas gerenciados — Absolem (assistente de IA embutido em ' +
      'resources/programs/Absolem) e Kloud Games (servidor de streaming em %ProgramFiles%\\KLOUD_GAMES). ' +
      'Cada card tem Iniciar/Parar, status, PID e logs ao vivo; clique no card para ver detalhes e abrir a pasta. ' +
      'O botão de logs mostra a saída do processo. Abrir o Kloud Games sempre pede UAC. ' +
      'O Mark LVII foi removido e não é mais distribuído; instalações antigas podem manter a pasta até reinstalar.',
    keywords: [
      'ferramentas',
      'dashboard',
      'absolem',
      'kloud games',
      'card',
      'iniciar',
      'parar',
      'logs',
      'pid',
      'programas',
      'mark lvii'
    ]
  },
  {
    id: 'biblioteca',
    title: 'Biblioteca',
    body:
      'Página Biblioteca: reúne jogos da Steam, Epic Games e Minecraft Launcher (ou qualquer .exe), ' +
      'com ícone extraído do executável e capa opcional. Dá para buscar por nome sem acento, filtrar por origem, ' +
      'favoritos e coleções, ordenar por nome, tempo de jogo ou mais recentes, e ver tempo total, da semana e ' +
      'última abertura. A remoção em lote pede confirmação e não apaga os arquivos do jogo nem encerra o processo. ' +
      '"Buscar jogos" varre as três lojas e mostra um relatório por fonte.',
    keywords: [
      'biblioteca',
      'jogos',
      'steam',
      'epic',
      'minecraft',
      'capa',
      'favoritos',
      'coleções',
      'tempo de jogo',
      'remover jogos',
      'buscar jogos'
    ]
  },
  {
    id: 'meu-pc',
    title: 'Meu PC',
    body:
      'Página Meu PC: abas Inicialização (programas que abrem com o Windows, com importância e remoção), ' +
      'Tela (resolução e escala), Atualizações (winget, com cache de 10 min e "Verificar novamente"), ' +
      'Limpeza (temporários com mais de 24 h), Memória (uso, cache/standby, top processos, liberar RAM e ' +
      'otimização automática opcional), Benchmark de CPU e Monitor de hardware (CPU/GPU, temperaturas, energia e HUD). ' +
      'A parte de energia aparece como card dentro do Monitor, não como aba separada.',
    keywords: [
      'meu pc',
      'inicialização',
      'startup',
      'tela',
      'resolução',
      'escala',
      'atualizações',
      'winget',
      'limpeza',
      'memória',
      'ram',
      'benchmark',
      'monitor',
      'energia'
    ]
  },
  {
    id: 'hud',
    title: 'HUD',
    body:
      'O HUD é uma sobreposição sempre visível sobre o jogo, ligada e desligada pelo atalho global padrão ' +
      'Shift+Insert (pode ser trocado na aba Monitor). Mostra CPU/GPU, temperaturas, energia e FPS do app em ' +
      'primeiro plano; a captura de FPS usa o PresentMon embutido e pede um UAC na primeira vez. ' +
      'A posição fica no canto superior esquerdo, com largura (180–560 px) e escala (compacta, normal, grande) ' +
      'ajustáveis. Sem leitura, o valor aparece como "--", nunca estimado.',
    keywords: [
      'hud',
      'overlay',
      'sobreposição',
      'atalho',
      'shift+insert',
      'fps',
      'temperatura',
      'posição',
      'escala',
      'largura'
    ]
  },
  {
    id: 'big-picture',
    title: 'Big Picture',
    body:
      'Big Picture: interface em tela cheia para gamepad e TV, no estilo de videogame. Entra pelo botão Big Picture ' +
      'na barra superior ou pelo menu Mais; com o Hub em foco, o botão PS/Guide do controle também abre. ' +
      'D-Pad ou stick navegam, A/Cross confirma, B/Circle volta, LB/RB alternam as seções e Start abre as opções. ' +
      'Mouse e teclado continuam funcionando. A configuração do controle fica em Configurações > Big Picture e ' +
      'sobrevive a reinícios; B na raiz ou Esc sai.',
    keywords: [
      'big picture',
      'gamepad',
      'controle',
      'tv',
      'tela cheia',
      'fullscreen',
      'ps',
      'guide',
      'console'
    ]
  },
  {
    id: 'acesso-remoto',
    title: 'Acesso remoto',
    body:
      'Acesso remoto: o caminho recomendado é Kloud Games + ZeroTier + Moonlight, para jogar fora de casa sem ' +
      'abrir portas no roteador. Em Configurações > Acesso remoto o Hub detecta o ZeroTier, mostra o endereço da ' +
      'rede, instala pelo winget por ação explícita, checa as portas TCP do Moonlight (47984, 47989, 48010) e ' +
      'consulta o IP público só no clique. O pareamento é feito digitando o PIN do Moonlight no painel do ' +
      'Kloud Games. É Windows-only e o Hub não guarda credenciais do ZeroTier.',
    keywords: [
      'acesso remoto',
      'remoto',
      'zerotier',
      'moonlight',
      'streaming',
      'jogar fora',
      'vpn',
      'pareamento',
      'pin',
      'portas'
    ]
  },
  {
    id: 'primeira-execucao',
    title: 'Primeira execução',
    body:
      'Primeira execução: sem o marcador %APPDATA%\\kolnd-hub\\first-run-complete.flag, o Hub mostra a tela de ' +
      'instalação com as etapas Verificação de dependências, Python, Kloud Games, Programas e Finalização. ' +
      'Python é instalado via winget se faltar. O Kloud Games vem do MSI embutido e a instalação é elevada via UAC, ' +
      'com assistente visível; se você negar ou falhar, o Hub continua funcionando e o MSI fica disponível para ' +
      'instalação manual. Nas próximas aberturas o app vai direto para Ferramentas.',
    keywords: [
      'primeira execução',
      'first run',
      'instalar kloud games',
      'instalação kloud games',
      'instalo',
      'instalei',
      'instalou',
      'instalar',
      'python',
      'winget',
      'msi',
      'uac',
      'dependências'
    ]
  },
  {
    id: 'configuracoes',
    title: 'Configurações',
    body:
      'Página Configurações: seções Ao abrir o Hub (iniciar Kloud Games junto, iniciar o Hub com o Windows), ' +
      'Notificações, Acesso remoto, Big Picture, Gerenciador de títulos (comando, diretório de trabalho, executar ' +
      'via shell, reiniciar se cair e logs por app), Diagnóstico, Registro de uso, Backup e restauração e Zona de ' +
      'perigo. "Salvar alterações" grava no config.json; "Resetar tudo" volta aos valores atuais. Caminhos aceitam ' +
      '%VAR%, valores absolutos e relativos à instalação do Hub.',
    keywords: [
      'configurações',
      'settings',
      'comandos',
      'diretório',
      'shell',
      'backup',
      'importar',
      'exportar',
      'resetar'
    ]
  },
  {
    id: 'desinstalacao',
    title: 'Desinstalação',
    body:
      'Desinstalação: em Configurações > Zona de perigo há "Desinstalar Kloud Games" e "Desinstalar Kolnd Hub"; ' +
      'as duas exigem confirmação digitada. Por padrão, %APPDATA%\\kolnd-hub e %APPDATA%\\absolem são preservados ' +
      'e o diretório de instalação é removido. A opção "Apagar também meus dados e configurações" é irreversível e ' +
      'apaga as duas pastas. O backup é manual, opcional e cobre só %APPDATA%\\kolnd-hub; copie %APPDATA%\\absolem ' +
      'à parte. Em npm run dev o botão do Hub fica desabilitado.',
    keywords: [
      'desinstalar',
      'desinstalo',
      'desinstalação',
      'remover',
      'apagar dados',
      'backup',
      'zona de perigo',
      'irreversível',
      'preservar dados'
    ]
  },
  {
    id: 'privacidade-seguranca',
    title: 'Privacidade e segurança',
    body:
      'Privacidade e segurança: o Hub não tem telemetria e nada é enviado para fora da máquina. Configuração, ' +
      'biblioteca, logs e ícones ficam em %APPDATA%\\kolnd-hub; o Absolem guarda dados em %APPDATA%\\absolem e a ' +
      'chave do Gemini é cifrada no PC com DPAPI (safeStorage) em secrets.bin. O registro de uso é local e opcional ' +
      '(só ids, nomes, página e duração). O diagnóstico copiado é sanitizado. O instalador e o MSI podem disparar ' +
      'UAC; sem assinatura de código o SmartScreen pode alertar.',
    keywords: [
      'privacidade',
      'segurança',
      'telemetria',
      'dados',
      'dpapi',
      'chave',
      'gemini',
      'secrets',
      'logs',
      'local'
    ]
  },
  {
    id: 'problemas-comuns',
    title: 'Problemas comuns',
    body:
      'Problemas comuns: se o app não abre, confira o card e os logs; "Diretório não encontrado" pede revisar o ' +
      'Diretório de trabalho em Configurações; jogo que não aparece na Biblioteca pode ser buscado por "Buscar jogos" ' +
      'ou adicionado pelo .exe; HUD ausente costuma ser atalho em uso (troque na aba Monitor) ou captura de FPS sem ' +
      'permissão; Kloud Games sem Moonlight pede conferir o MSI, o UAC e as portas; UAC negado não bloqueia o Hub. ' +
      'Os logs ficam em %APPDATA%\\kolnd-hub\\logs.',
    keywords: [
      'problema',
      'erro',
      'não abre',
      'não aparece',
      'hud ausente',
      'uac',
      'moonlight',
      'portas',
      'logs',
      'solução'
    ]
  },
  {
    id: 'limites',
    title: 'Limites',
    body:
      'Limites: o Absolem explica o Hub, mas não abre telas nem altera configurações por conta própria; ações assim ' +
      'exigem pedido e confirmação. Ele não garante que o streaming do Kloud Games funcione (depende de rede, ' +
      'ZeroTier, Moonlight e GPU), não instala programas sozinho e não substitui os botões do app. O conteúdo desta ' +
      'base vem da documentação do repositório; se um recurso não estiver documentado aqui, diga que não está ' +
      'documentado e indique a página do Hub onde conferir.',
    keywords: [
      'limites',
      'não faz',
      'não pode',
      'confirmação',
      'inventar',
      'documentado',
      'segurança'
    ]
  }
]

const STOPWORDS = new Set([
  'como',
  'onde',
  'que',
  'qual',
  'quais',
  'para',
  'por',
  'com',
  'sem',
  'uma',
  'um',
  'de',
  'do',
  'da',
  'dos',
  'das',
  'o',
  'a',
  'os',
  'as',
  'e',
  'em',
  'no',
  'na',
  'ao',
  'aos',
  'eh',
  'faz',
  'sobre'
])

/**
 * Normaliza para busca: minúsculas, sem acentos e só letras/números/espaços.
 * A mesma função vale para a consulta e para o texto indexado.
 */
export function normalizeHubText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Tokens úteis da consulta (sem artigos/preposições comuns). */
export function hubQueryTokens(query: string): string[] {
  return normalizeHubText(query)
    .split(' ')
    .filter((token) => token.length > 1 && !STOPWORDS.has(token))
}

/** Bloco compacto do Hub sempre presente no prompt de sistema. */
export function buildHubOverview(): string {
  return [
    'Kolnd Hub (Windows): central de controle do ecossistema Kolnd.',
    'Páginas: Ferramentas (cards de Absolem e Kloud Games: iniciar, parar, detalhes e logs), Biblioteca (jogos de Steam, Epic e Minecraft, mais .exe: capas, favoritos, coleções e tempo de jogo), Chat (Go Live embutido), Meu PC (abas Inicialização, Tela, Atualizações, Limpeza, Memória, Benchmark e Monitor com HUD) e Configurações (programas, acesso remoto, Big Picture, backup, diagnóstico, registro de uso e Zona de perigo).',
    'Extras: Big Picture em tela cheia para gamepad/TV; HUD sobreposto ao jogo (Shift+Insert); acesso remoto com Kloud Games + ZeroTier + Moonlight.',
    'Dados: configuração, biblioteca, logs e ícones em %APPDATA%\\kolnd-hub; Absolem em %APPDATA%\\absolem. Sem telemetria.',
    'Regras: responda em passos curtos com os nomes exatos das telas; nunca invente recurso nem diga que abriu ou alterou algo; se não estiver nesta base, diga que não está documentado e indique onde ver no app; não abra telas por conta própria.'
  ].join('\n')
}

function scoreSection(section: HubKnowledgeSection, tokens: readonly string[]): number {
  const title = normalizeHubText(`${section.id} ${section.title}`)
  const keywords = normalizeHubText(section.keywords.join(' '))
  const body = normalizeHubText(section.body)
  let score = 0
  for (const token of tokens) {
    if (title.includes(token)) score += 4
    if (keywords.includes(token)) score += 4
    if (body.includes(token)) score += 1
  }
  return score
}

/**
 * Busca por tema com normalização de acentos/minúsculas. Devolve no máximo
 * `limit` seções (padrão 2) ordenadas por relevância; sem nenhum token que
 * case, devolve `sections: []` e a lista de tópicos para o modelo oferecer.
 */
export function searchHubKnowledge(
  query: string,
  options: HubKnowledgeSearchOptions = {}
): HubKnowledgeSearchResult {
  const limit = Math.max(1, Math.min(HUB_KNOWLEDGE_SECTIONS.length, Math.trunc(options.limit ?? 2)))
  const topics = HUB_KNOWLEDGE_SECTIONS.map(({ id, title }) => ({ id, title }))
  const tokens = hubQueryTokens(query)
  if (tokens.length === 0) {
    return { sections: [], overview: buildHubOverview(), topics }
  }

  const ranked = HUB_KNOWLEDGE_SECTIONS.map((section, index) => ({
    section,
    index,
    score: scoreSection(section, tokens)
  }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)

  return {
    sections: ranked.map(({ section }) => ({
      id: section.id,
      title: section.title,
      body: section.body
    })),
    overview: buildHubOverview(),
    topics
  }
}
