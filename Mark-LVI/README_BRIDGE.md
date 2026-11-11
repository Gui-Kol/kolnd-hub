# OpenCode ↔ JARVIS Bridge

Ponte real entre o **JARVIS (Mark-LVI)** e um agente **OpenCode** via JSON (REST + WebSocket).
Tudo roda localmente na sua máquina (`127.0.0.1`).

## O que foi adicionado

| Arquivo | O que é |
|---------|---------|
| `plugins/opencode_bridge.py` | Plugin do JARVIS: dispara tarefas de código no OpenCode e recebe progresso via `player.write_log` / `player.show_code_job` |
| `bridge_server.py` | Servidor FastAPI separado (porta 8000) com endpoints REST + WebSocket |
| `manage_bridge.py` | Gerenciador CLI: `start | stop | status | restart` |
| `actions/bridge_control.py` | Ação do JARVIS: controla o servidor por voz (`start`, `stop`, `restart`, `status`) |
| `AGENTS.md` (raiz do Mark-LVI) | Regras de threading já seguidas por todos os arquivos acima |

## Primeiros passos

### 1. Abrir o JARVIS pelo Kolnd Hub
O bridge server (`bridge_server.py`) agora é iniciado **automaticamente** sempre que você abre o JARVIS pelo Kolnd Hub. Você não precisa mais iniciá-lo manualmente.

Quando o JARVIS inicia:
- O `bridge_server.py` sobe em segundo plano na porta `http://127.0.0.1:8000`
- Quando você fecha o JARVIS, o bridge server é encerrado automaticamente

Verifique se está no ar pelo Kolnd Hub (status do app) ou acessando:
```powershell
curl http://127.0.0.1:8000/api/v1/opencode/status
```

Se precisar iniciar/parar manualmente:
```powershell
python manage_bridge.py start
python manage_bridge.py stop
python manage_bridge.py status
```

### 1b. Configurar a API key da NVIDIA (Nemotron 3.5 Super VL Free)

O bridge server inicia automaticamente quando você abre o JARVIS pelo Kolnd Hub. Na **primeira execução**, se não houver API key configurada, o bridge roda em **modo test-generator** que escreve código real no disco — suficiente para testar todo o fluxo sem qualquer chave externa.

Para usar o modelo **Nemotron 3.5 Super VL Free** da NVIDIA via NIM, você tem duas opções:

**Opção A — Variáveis de ambiente (antes de abrir o JARVIS):**
```powershell
$env:NVIDIA_API_KEY = "sua_chave_aqui"
$env:NVIDIA_MODEL = "nemotron-3.5-super-vl-free"
```

**Opção B — Painel de configurações do JARVIS:**
Abra o JARVIS, vá em **⚙ → Plugins → Open Code Bridge** e preencha:
- **API key (Bearer token):** sua chave da NVIDIA
- **HMAC shared secret:** `mark_lvi_secure_hmac_secret` (opcional)
- **Enable HMAC payload signing:** ligado/desligado

A chave é salva em `config/api_keys.json` (sob `plugin_config.opencode_bridge.nvidia_api_key`) e persiste entre sessões.

O endpoint `/api/v1/opencode/status` retorna qual agente está ativo (`agent` campo) e qual modelo está em uso (`model` campo).

### 2. Configurar o plugin no JARVIS
No JARVIS, vá em **⚙ → Plugins → Open Code Bridge** e preencha:
- **Bridge server base URL:** `http://127.0.0.1:8000`
- **API key (Bearer token):** `jarvis_opencode_secret_key_v1` (ou a que quiser)
- **HMAC shared secret:** `mark_lvi_secure_hmac_secret`
- **Enable HMAC payload signing:** ligado/desligado (opcional)
- **Task timeout (seconds):** `120`

O plugin é carregado automaticamente na inicialização — não é preciso registrar nada.

### 3. Usar por voz
Com o servidor bridge rodando, fale com o JARVIS:

> "JARVIS, peça ao OpenCode para refatorar a connection pool do db.py"

O plugin extrai a instrução, dispara a tarefa e responde imediatamente:

> "OpenCode bridge: task 'job_1234567890' started. I'll report progress in the activity log and the code-job panel..."

O progresso aparece no **log de atividade** e no **painel de código** (code job) enquanto o OpenCode trabalha. Quando termina, JARVIS lê o resumo.

Também pode controlar o servidor por voz:

> "JARVIS, inicia a ponte do OpenCode"
> "JARVIS, para a ponte do OpenCode"
> "JARVIS, status da ponte do OpenCode"

## Como funciona a rede

1. JARVIS → `POST /api/v1/opencode/tasks` (JSON, Bearer + HMAC opcional)
2. Servidor cria a tarefa, começa a processar e avisa via WebSocket
3. JARVIS faz `GET /api/v1/opencode/tasks/{id}` (polling a cada 2s) para acompanhar o progresso
4. Quando termina, servidor emite `task_completed` e JARVIS devolve o resultado

Se o WebSocket não estiver disponível, o cliente cai automaticamente no polling REST — a ponte continua funcionando.

## Endpoints do servidor

```
GET  /api/v1/opencode/status          — health check (público)
POST /api/v1/opencode/tasks           — dispara tarefa (Bearer + HMAC)
GET  /api/v1/opencode/tasks/{id}      — consulta status/resultado (Bearer)
POST /api/v1/opencode/tasks/{id}/cancel — cancela tarefa (Bearer)
WS   /ws/v1/opencode/events           — stream de eventos em tempo real (Bearer)
```

## Arquitetura (respeita AGENTS.md)

- `bridge_server.py` roda **fora** do JARVIS, em seu próprio processo.
- `plugins/opencode_bridge.py` roda na **worker thread** do JARVIS; nunca toca Qt diretamente — usa apenas `player.write_log` / `player.show_code_job`.
- `run()` do plugin retorna **imediatamente** com uma frase curta; o trabalho lento fica em uma `threading.Thread` separada.
- `run()` **não levanta exceção** — erros de rede viram log e mensagem falada.

## Personalização

O `bridge_server.py` simula o trabalho do OpenCode por padrão (4 etapas de 1s cada). Quando você tiver um agente OpenCode real para conectar, substitua `_run_task_worker()` em `bridge_server.py` pela chamada ao seu agente.
