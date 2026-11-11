import { AppConfig } from '../types'

export const apps: AppConfig[] = [
  {
    id: 'mark-lvi',
    name: 'Mark LVI (JARVIS)',
    description:
      'Assistente pessoal de voz com IA em tempo real. Avatar holográfico com lip-sync, controle do computador e suporte a 50+ idiomas.',
    icon: '🎙️',
    color: '#F59E0B',
    gradient: 'from-amber-500 to-orange-500',
    command: 'py main.py',
    cwd: '../Mark-LVI',
    category: 'ai',
    tags: ['IA', 'Voz', 'Assistente']
  },
  {
    id: 'playnite',
    name: 'Playnite',
    description:
      'Gerenciador de biblioteca de jogos. Agrega jogos de Steam, Epic, GOG, EA e mais em uma interface unificada com suporte a emulação.',
    icon: '🎮',
    color: '#8B5CF6',
    gradient: 'from-violet-500 to-purple-500',
    command: 'Playnite.DesktopApp.exe',
    cwd: '%LOCALAPPDATA%\\Playnite',
    category: 'gaming',
    tags: ['Jogos', 'Biblioteca', 'Launcher']
  },
  {
    id: 'kloud-games',
    name: 'Kloud Games',
    description:
      'Seu próprio servidor de streaming de jogos. Streaming de baixa latência com suporte a gamepad e GPU, totalmente autoral.',
    icon: '🎮',
    color: '#F97316',
    gradient: 'from-orange-500 to-red-500',
    command: 'kloud-games.exe',
    cwd: '../kloud-games',
    category: 'streaming',
    tags: ['Streaming', 'Jogos', 'GPU']
  },

  {
    id: 'intellij',
    name: 'IntelliJ IDEA',
    description: 'IDE completa para desenvolvimento Java, Kotlin e JVM da JetBrains.',
    icon: '💎',
    color: '#0A86C8',
    gradient: 'from-blue-600 to-cyan-500',
    command: '"C:\\Program Files\\JetBrains\\IntelliJ IDEA 2026.2.3\\bin\\idea64.exe"',
    cwd: '%USERPROFILE%',
    category: 'dev',
    tags: ['IDE', 'Java', 'JetBrains', 'Programação']
  },
  {
    id: 'pycharm',
    name: 'PyCharm',
    description: 'IDE profissional para Python da JetBrains com suporte a Django, Flask e ciência de dados.',
    icon: '🐍',
    color: '#F46D3A',
    gradient: 'from-orange-500 to-amber-600',
    command: '"C:\\Program Files\\JetBrains\\PyCharm 2026.2.3\\bin\\pycharm64.exe"',
    cwd: '%USERPROFILE%',
    category: 'dev',
    tags: ['IDE', 'Python', 'JetBrains', 'Programação']
  },
  {
    id: 'vscode',
    name: 'Visual Studio Code',
    description: 'Editor de código leve e extensível da Microsoft para qualquer linguagem.',
    icon: '💻',
    color: '#007ACC',
    gradient: 'from-blue-600 to-blue-800',
    command: 'code.exe',
    cwd: '%USERPROFILE%',
    category: 'dev',
    tags: ['Editor', 'Código', 'Microsoft', 'Programação']
  },
  {
    id: 'docker',
    name: 'Docker Desktop',
    description: 'Plataforma de containers para criar, executar e gerenciar aplicações containerizadas.',
    icon: '🐳',
    color: '#0DB9ED',
    gradient: 'from-cyan-500 to-blue-600',
    command: '"%LOCALAPPDATA%\\Programs\\DockerDesktop\\Docker Desktop.exe"',
    cwd: '%USERPROFILE%',
    category: 'dev',
    tags: ['Containers', 'DevOps', 'Infraestrutura']
  },
  {
    id: 'insomnia',
    name: 'Insomnia',
    description: 'Cliente REST/GraphQL para testar e documentar APIs de forma simples e visual.',
    icon: '🌙',
    color: '#4000BF',
    gradient: 'from-violet-700 to-purple-800',
    command: 'Insomnia.exe',
    cwd: '%USERPROFILE%',
    category: 'dev',
    tags: ['API', 'REST', 'Testes', 'HTTP']
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    description: 'Agente de código de IA no terminal para desenvolver e refatorar projetos.',
    icon: '🤖',
    color: '#8B5CF6',
    gradient: 'from-violet-500 to-fuchsia-500',
    command: '"%LOCALAPPDATA%\\Programs\\ai.opencode.desktop\\OpenCode.exe"',
    cwd: 'C:\\Users\\TiffoDi\\desenv\\Kolnd Hub',
    category: 'dev',
    tags: ['IA', 'Agente', 'Terminal', 'Código']
  },
  {
    id: 'antigravity',
    name: 'Antigravity',
    description: 'Módulo clássico do Python que abre a tirinha do xkcd sobre antigravidade.',
    icon: '🚀',
    color: '#F59E0B',
    gradient: 'from-amber-500 to-orange-500',
    command: '"%LOCALAPPDATA%\\Programs\\antigravity\\Antigravity.exe"',
    cwd: '%USERPROFILE%',
    category: 'dev',
    tags: ['Python', 'Diversão', 'Easter egg']
  }
]
