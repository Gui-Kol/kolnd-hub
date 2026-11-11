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
    command: 'MarkLVI.exe',
    cwd: 'resources/programs/MarkLVI',
    category: 'ai',
    tags: ['IA', 'Voz', 'Assistente']
  },
  {
    id: 'kloud-games',
    name: 'Kloud Games',
    description:
      'Seu próprio servidor de streaming de jogos. Streaming de baixa latência com suporte a gamepad e GPU, totalmente autoral.',
    icon: '🎮',
    color: '#F97316',
    gradient: 'from-orange-500 to-red-500',
    command: '"%ProgramFiles%\\KLOUD_GAMES\\KLOUD_GAMES.exe"',
    cwd: '%ProgramFiles%\\KLOUD_GAMES',
    category: 'streaming',
    tags: ['Streaming', 'Jogos', 'GPU']
  }

  // Apps pessoais (IDEs, ferramentas de dev, etc.) NÃO são commitados aqui:
  // ficam apenas no localStorage de cada máquina (tela de Configurações),
  // para o repositório não vazar caminhos pessoais nem estrutura de disco.
  // O merge em App.tsx preserva entradas salvas que não estejam nos defaults.
]
