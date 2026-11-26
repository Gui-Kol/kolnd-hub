# Auditoria de acessibilidade

Documento da task 13 (T9). Registra a auditoria automática com axe no app
buildado e a passada manual. Data: **2026-11-26**. Ferramenta:
`@axe-core/playwright` **4.14.1** (devDependency autorizada; justificativa:
roda dentro do Playwright já existente e cobre todas as telas sem manter uma
lista manual de regras).

## 1. Método

Comando:

```powershell
cd Absolem
npm run test:e2e
```

O teste `tests/e2e/a11y.spec.ts`:

1. inicia o app buildado com `ABSOLEM_TEST_USERDATA` temporário e
   `ABSOLEM_TEST_TRANSPORT=fake` (sem rede real, sem chave);
2. abre Configurações pelo `activate` do main (mesmo caminho da bandeja);
3. percorre as sete abas: Aparência, Voz, Permissões, Memória, Chave e custo,
   Diagnóstico e Sobre;
4. abre o overlay, clica em "Escrever" e analisa o modo expandido;
5. usa `AxeBuilder` com as tags `wcag2a`, `wcag2aa`, `wcag21a` e `wcag21aa` e
   `setLegacyMode(true)` (o Electron não suporta `context.newPage()`, que o
   modo padrão usa);
6. falha se houver violação com impacto `critical` ou `serious`.

Resultado real: **2 testes e2e verdes** (`a11y.spec.ts` e `settings.spec.ts`),
**0 violações críticas ou sérias** nas sete abas e no overlay expandido.

## 2. Correções feitas

| Achado                                            | Onde                                                                  | Correção                                                                                                        |
| ------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Contraste de texto pequeno abaixo de 4.5:1        | `--text-tertiary` em `src/renderer/src/index.css` (`#6b7885`)         | Trocado para `#8b98a5`; ratio sobe de 3.61-4.26:1 para 5.53-6.53:1 nos fundos `base`, `surface-1` e `surface-2` |
| Textos de status e valores hexadecimais ilegíveis | `AppearanceTab` (outputs de cor, brilho, escala e aviso de contraste) | Herdam o token corrigido; nenhuma mudança de layout                                                             |
| Navegação por teclado                             | `SettingsApp`                                                         | Já tinha foco na aba ativa, `aria-current="page"` e botões reais; mantido                                       |
| Rótulos de formulário                             | Abas de Configurações                                                 | Já usavam `label htmlFor`; o teste de UI confirma todos os controles rotulados                                  |
| Status dinâmico                                   | Overlay e abas                                                        | `role="status"` com `aria-live="polite"`; mantido                                                               |
| Avatar                                            | Overlay                                                               | `role="button"`, `aria-label` com o estado, `aria-pressed` e `tabIndex`; canvas `aria-hidden`                   |

Não foi necessário esconder regra do axe nem usar `disableRules`. A correção de
contraste foi a única mudança visual necessária.

## 3. Cobertura da auditoria

- **Configurações:** formulários, seletores, checkboxes, botões de confirmação,
  blocklist, memória, chave write-only, diagnóstico e sobre.
- **Overlay expandido:** avatar, indicador de voz, botão "Escrever", campo de
  texto, botões de ação e cartão de primeira configuração.
- **Não coberto pelo axe:** canvas WebGL (marcado `aria-hidden`), áudio e
  comportamento de foco durante a fala. O teste de UI `a11y.test.tsx` cobre
  rótulos, foco inicial e `aria-live`.

## 4. Passada manual (pendente de ambiente humano)

Não há, nesta execução, ambiente com Narrador do Windows e sessão interativa
completa. Os itens abaixo ficam **PENDENTE MANUAL** no checklist de release,
sem declarar validados:

1. Abrir Configurações e percorrer as sete abas só com Tab/Shift+Tab; nenhuma
   armadilha de foco e ordem coerente.
2. Ativar o Narrador do Windows e confirmar nome, papel e estado de cada
   controle (incluindo avatar e botão de voz).
3. Testar o overlay com o Narrador: o estado da voz é anunciado e o botão
   "Escrever" é alcançável.
4. Testar `prefers-reduced-motion` e confirmar que animações param sem sumir
   conteúdo.
5. Conferir contraste com o tema personalizado do usuário (o token de texto é
   fixo; a cor do avatar é do tema e tem aviso próprio de 3:1).

Esses passos estão no `docs/RELEASE-CHECKLIST.md`. A ausência do ambiente não
bloqueia o código, mas bloqueia declarar a acessibilidade manual como aprovada.

## 5. Como repetir

```powershell
cd Absolem
npm run test:e2e
```

Se o axe apontar violação nova, corrija a tela ou o token; não desative a regra.
O teste falha com a lista de `id`, impacto e seletor de cada nó.
