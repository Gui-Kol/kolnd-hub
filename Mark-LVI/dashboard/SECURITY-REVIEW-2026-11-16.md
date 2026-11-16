# Revisão de segurança — Dashboard remoto do Mark LVI

- **Data:** 16/11/2026
- **Escopo:** `Mark-LVI/dashboard/` (`server.py`, `static/app.html`, `static/login.html`, `static/crypto-js.min.js` — este último apenas inventariado, não auditado linha a linha) e os docs `Mark-LVI/readme.md` / `Mark-LVI/AGENTS.md`.
- **Fora do escopo:** restante do Mark LVI, mudança de modelo de segurança (auth/TTL/criptografia/stack), pentest externo, arquivos não lidos por restrição de privacidade (`config/api_keys.json`, `config/certs/`, `memory/`, `.env` — citados apenas por nome de caminho, nunca por conteúdo).
- **Método:** leitura completa do código + teste in-process com `fastapi.testclient.TestClient` (sem rede, sem porta real, sem credenciais). Nenhuma dependência nova foi instalada.

---

## 1. Inventário de endpoints

| Endpoint | Método | Auth | Rate limit | Observação |
|---|---|---|---|---|
| `/login` | GET | não (página de login) | n/a | HTML estático |
| `/` | GET | não (auth no cliente via sessionStorage) | n/a | Página em si não é dado sensível; todo dado vem de APIs autenticadas |
| `/login` | POST | chave de pairing de 8 chars | **sim** — 6 falhas/5 min por endereço → 429 + bloqueio de 300 s (`server.py:704-706`, `:912-945`) | `_who()` usa só `req.client.host`; **não** honra `X-Forwarded-For` → sem bypass de rate limit por header |
| `/auto-login` | GET | chave de pairing (query param) | **sim, após esta revisão** (era **nenhum**) | Alvo do QR code; consome a chave (uso único) e emite token + `device_token` |
| `/api/device-login` | POST | `device_token` (32 bytes urlsafe, ~256 bits) | não | Risco de brute force desprezível; sem throttle por decisão de escopo (ver A6) |
| `/api/revoke-devices` | POST | Bearer token | n/a | Revoga `device_token`s **e** todos os tokens vivos, exceto o do chamador (`server.py:1036`) |
| `/api/command` | POST | Bearer token | n/a | Executa comando; aceita `enc` (AES-256-GCM) ou `text` em claro (fallback NO ENC) |
| `/ws` | WS | token via query param | n/a | WebSocket de controle; fecha com 4001 sem token válido |
| `/ws/phone-audio` | WS | token via query param | n/a | Stream PCM16 do microfone do celular → fila para Gemini Live |
| `/api/upload` | POST | Bearer token | n/a | Upload multipart; nome sanitizado (`_safe_filename`), limite 500 MB, colisão resolvida com sufixo |
| `/api/upload` (stub sem python-multipart) | POST | não exige | n/a | Responde 503; inócuo |
| `/api/files` | GET | Bearer token | n/a | Lista arquivos do diretório de uploads |
| `/uploads/{filename}` | GET | token via query param | n/a | Download; `filename` tem `/` e `\` removidos (`server.py:1199`) |
| Redirecionador HTTP :8000 | GET | não | n/a | Apenas 307 → HTTPS :8001; não serve conteúdo (`server.py:1235-1268`) |

**Cobertura de auth:** todos os endpoints de controle (command, upload, files, uploads, websockets, revoke) exigem token válido — verificado por leitura e por teste in-process (§5).

**Token:** `secrets.token_urlsafe(32)` (~256 bits), TTL de 12 h (`server.py:703`), varrido na leitura (sem timer); revogação global via `/api/revoke-devices`. Sem endpoint de logout individual (ver A7).

**Chave de pairing:** 8 chars de alfabeto de 31 símbolos (sem `O,I,L,0,1`) ⇒ espaço ≈ 31⁸ ≈ 8,5×10¹¹ (~39,6 bits). Mitigantes: validade de 10 min (`new_key(expiry_secs=600)`), uso único, throttle de 6 tentativas/5 min/endereço. PBKDF2-HMAC-SHA256 com 200 000 iterações (`server.py:125`, `:128-132`) para derivar a chave AES-256 — resistente a ataque offline na escala do espaço de busca.

**Criptografia:** AES-256-GCM com nonce aleatório de 12 bytes por mensagem (Web Crypto no cliente; `cryptography` no servidor). CBC/CryptoJS legados mantidos apenas no arquivo `crypto-js.min.js` (não referenciado pelo fluxo GCM). Chaves vivem: pairing key no cliente em `sessionStorage` (`jarvis_key`) e no servidor em memória (`_token_keys`, `_aes_cache`) — nunca em disco, exceto o `device_token` em `localStorage` no celular.

**Binding:** `0.0.0.0` em :8000 (redirect HTTP) e :8001/:8000 (app) — intencional (acesso por celular na LAN). **Não alterado.**
**TLS:** opcional, opt-in via `"dashboard_https": true` em `config/api_keys.json` (default é HTTP plano com aviso). Certificado autoassinado gerado localmente na primeira execução em `config/certs/`. **Não alterado** (decisão de produto).
**CORS:** nenhum middleware de CORS ⇒ navegador impõe same-origin por padrão (nenhum header `Access-Control-Allow-*` é emitido). Adequado. **Nada a fazer.**
**Logs:** nenhum `print`/log inclui token, chave de pairing ou conteúdo de comandos. `uvicorn` roda com `log_level="warning"` (sem access log em nível info). Um vazamento potencial de path interno no corpo de erro de upload foi corrigido (A3).

---

## 2. Achados por severidade

### Crítico
Nenhum.

### Alto
- **A1 — `/auto-login` sem rate limit (bypass do throttle de pairing).**  
  Evidência: `server.py` (versão pré-revisão), handler `auto_login` validava a chave de pairing (~40 bits) **sem** qualquer throttle, enquanto `/login` impõe 6 tentativas/5 min. Um script na LAN podia tentar chaves no caminho do QR code a velocidade plena, anulando o controle compensatório da chave curta.  
  **Corrigido nesta revisão** (ver §3, C1).

### Médio
- **A2 — login.html não permite digitar a chave de 8 caracteres.**  
  Evidência: `static/login.html:142` (`maxlength="6"`), `:185` (auto-submit em 6 chars), `:191` (`length < 6`); servidor gera chaves de 8 chars (`server.py:771`). Resultado: o login manual digitado era impossível — o usuário só conseguia parear via QR. Bug funcional na superfície de pairing.  
  **Corrigido nesta revisão** (C4).
- **A3 — Mensagem de erro de upload vazava exceção interna ao cliente.**  
  Evidência: `server.py` (pré-revisão), `return JSONResponse({"error": str(exc)}, status_code=500)` — `exc` pode conter path absoluto ou detalhe interno do SO.  
  **Corrigido nesta revisão** (C3): cliente recebe `{"error": "Upload failed"}`; detalhe vai para o console do processo (`print`), que é onde o usuário do desktop vê.
- **A4 — Token na query string de WebSocket e de download.**  
  Evidência: `static/app.html:243`, `:352`, `:382`, `:519`; servidor `server.py:1080`, `:1183`, `:1195` (`token: str = ""`). Tokens em URL podem aparecer em histórico do navegador e em qualquer log de proxy/antivírus local de terceiros. Mitigantes presentes: TTL 12 h, revogação total, WS fecha com 4001 sem token. **Não corrigido** (mudança de interface cliente↔servidor; vira item recomendado R4).

### Baixo
- **A5 — Sem headers de segurança nas respostas HTTP.**  
  Evidência: `server.py:866` (FastAPI sem middleware) — faltavam `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`. Risco real baixo (app de LAN, sem dados de terceiros), mas o custo do fix é mínimo.  
  **Corrigido nesta revisão** (C2).
- **A6 — `/api/device-login` sem throttle.**  
  Evidência: `server.py:1014-1033`. O `device_token` tem ~256 bits, então brute force é inviável; ainda assim, um contador de falhas barato adicionaria defesa em profundidade. Não corrigido (escopo mínimo; vira R5).
- **A7 — Sem logout individual / sem expiração de `device_token`.**  
  Evidência: `server.py:756` (`_device_sessions` sem TTL), `:1036-1058` (revoke-devices é global, preserva só o chamador). Um `device_token` roubado do celular vale até revogação manual ou restart. Modelo de sessão — **fora de escopo** (R2).
- **A8 — `esc()` do cliente não escapa aspas.**  
  Evidência: `static/app.html:284-286`. Todos os usos em atributos com aspa dupla (`download="${esc(...)}"`) passam por valores já sanitizados pelo servidor (`_safe_filename` remove `<>:"/\|?*` e controles, `server.py:1140-1143`) ou por `encodeURIComponent`, então não há XSS demonstrável hoje. Fragilidade latente se um novo call site aparecer. Não corrigido (R6).
- **A9 — `/auto-login` e `/login` em HTTPS com certificado autoassinado: interstitial e `crypto.subtle` ausente fora de contexto seguro.**  
  Documentado no próprio código (`server.py:777-801`) e na UI (badge "NO ENC"). Comportamento intencional; apenas registrado. Ver também R1 (tornar HTTPS obrigatório é decisão de produto, fora de escopo).

### Informativo
- **I1 — Binding em `0.0.0.0`** (`server.py:1255`, `:1311`): intencional para acesso por celular na LAN. Como o threat model é "rede local", a exposição para além da LAN depende do roteador/firewall do usuário (o app ainda notifica sobre regras BLOCK e rede "Public" no Windows — `server.py:165-255`).
- **I2 — Sal PBKDF2 fixo** (`server.py:109`, `_AES_SALT = b'JARVIS-DASHBOARD-v1'`): determinístico de propósito (mesmo token ⇒ mesma chave derivada). Aceitável para derivação de chave de sessão de um segredo de sessão; não reutilizar o padrão para senhas de usuário.
- **I3 — Fallback de comando em claro** (`server.py:1061-1076`): sem `enc`, o servidor aceita `{"text": ...}` — necessário para HTTP plano (onde `crypto.subtle` não existe). O badge na UI avisa. Registrado.
- **I4 — Histórico em memória enviado a novos clientes WS** (`server.py:851-861`, `:1203-1208`): últimos 300 eventos (50 no connect), incluindo texto de conversa, vão para qualquer portador de token válido. By design (sync entre dispositivos), mas reforça a importância do TTL/revogação.
- **I5 — HTTPS default off:** comandos trafegam em claro na LAN por default; pairing key ainda protege acesso. Decisão de produto documentada no código (`server.py:777-801`); não alterada (R1).
- **I6 — `session_key` (a chave de pairing) retornada por `/api/device-login`** (`server.py:1033`): necessária para o cliente re-derivar a chave AES-GCM; amplia a exposição da chave para o `sessionStorage` de cada dispositivo pareado. By design; registrada.
- **I7 — `GET /` sem auth no servidor** (`server.py:902-910`): página estática sem dados; auth é client-side por necessidade (navegação do browser não envia header `Authorization`). Registrado.
- **I8 — `crypto-js.min.js` (AES-CBC legado)** presente em `static/` mas não usado pelo fluxo GCM (`static/app.html:166-236` usa Web Crypto/PBKDF2/AES-GCM). Removê-lo é trivial mas está **fora do escopo mínimo** desta revisão (R7).
- **I9 — Timing de comparação da chave de pairing:** `entered in self._pending_keys` (`server.py:929`) é lookup de hash, não comparação byte-a-byte — não há oráculo de timing prático. Registrado.
- **I10 — Throttle por endereço compartilhado:** NAT residencial faz com que vários usuários dividam um contador (6 falhas/5 min). Comportamento aceitável; sucesso limpa o contador (`server.py:930`).

---

## 3. Correções aplicadas (diff mínimo)

### C1 — Rate limit no `/auto-login` (corrige A1) — `server.py`
Handler passa a exigir `Request`, consulta `_throttle.blocked_for(who)` antes de validar a chave e responde **429** com página simples quando bloqueado; falha de chave chama `_throttle.record_failure(who)`; sucesso chama `_throttle.clear(who)` — espelhando `/login`. Testado: 7ª tentativa inválida → 429; contador compartilhado com `/login` (ver §5).

### C2 — Headers de segurança (corrige A5) — `server.py:868-874`
Middleware `http` mínimo na app principal:
```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
```
Não aplicado ao redirecionador :8000 (app separada que só emite 307 — diff ainda mais mínimo; registrado).

### C3 — Erro de upload sem vazar exceção ao cliente (corrige A3) — `server.py`
Cliente recebe `{"error": "Upload failed"}`; exceção completa vai para `print(f"[Dashboard] Upload failed: {exc}")` no console do processo.

### C4 — login.html aceita a chave de 8 caracteres (corrige A2) — `static/login.html`
`maxlength="6"` → `"8"`; auto-submit em 8; checagem `length < 8`; placeholder com 8 pontos. Nenhum outro comportamento alterado.

### O que NÃO foi alterado
Binding (`0.0.0.0`), TLS obrigatório, TTL de 12 h, modelo de token, CBC→GCM (já migrado), CORS (já restritivo por ausência), stack, dependências. Nenhum arquivo fora de `Mark-LVI/dashboard/` e dos dois docs foi tocado.

---

## 4. Comandos executados e resultados reais

| Comando | Resultado |
|---|---|
| `py -3 --version` → 3.14.5; `fastapi 0.162.4`, `uvicorn 0.54.0`, `httpx 0.28.1`, `cryptography 49.0.0` | deps presentes; `python` puro não existe no PATH (só launcher `py`) |
| `py -3 <temp>\test_dashboard.py` (TestClient in-process; `USERPROFILE`/`MARK_LVI_HOME` redirecionados para diretório temporário antes do import) | **14/14 PASS** — ver §5 |
| `py -3 -m compileall Mark-LVI/dashboard` | exit 0 |
| Leitura de `config/api_keys.json`, `config/certs/`, `memory/`, `.env` | **não realizada** (restrição de privacidade) |
| Servidor real em porta de rede / pareamento por celular físico | **não executado nesta sessão** (exigiria abrir porta real + certificado; conforme restrição, documentado como não executado) |

### 5. Teste in-process (T5) — detalhes
Ambiente: temp dir como `USERPROFILE`/`MARK_LVI_HOME`; import do módulo (`dashboard.server`); `DashboardServer()`; `fastapi.testclient.TestClient`. Nenhuma porta aberta, nenhum pacote instalado, nenhum dado do usuário tocado (dir de uploads e `DATA_DIR` caíram no temp).

Resultados: `GET /login` 200 com headers de segurança ✓ · `GET /` 200 ✓ · `/api/command`, `/api/files`, `/api/revoke-devices` sem token → 401 ✓ · fluxo válido `/auto-login?key=…` → 200 + `sessionStorage` ✓ · token extraído autentica `/api/command` e `/api/files` (200) ✓ · replay da chave de uso único → recusado ✓ · 7ª tentativa inválida em `/auto-login` → **429** ✓ · `/login` após o mesmo orçamento de falhas → **429** (throttle compartilhado) ✓ · WS `/ws?token=bad` → rejeitado ✓.

**Não executado:** teste manual em celular/navegador real, handshake TLS real, QR code — pendente de sessão com o usuário presente (ver §7).

---

## 6. Itens recomendados — NÃO aplicados (fora do escopo mínimo)

- **R1.** Tornar HTTPS obrigatório por default (ou ao menos avisar na UI com mais destaque) — decisão de produto/UX; mudaria o comportamento para usuários em redes "Public" onde o autoassinado falha silencioso.
- **R2.** TTL/rotação para `device_token` e logout individual; opção de "confiar só nesta sessão".
- **R3.** Refresh/rolling de token ativo e lista de sessões visível no desktop UI.
- **R4.** Eliminar token da query string: migrar WS para `Sec-WebSocket-Protocol` ou primer por cookie `HttpOnly; SameSite=Strict` + `/api/ws-ticket` de uso único.
- **R5.** Throttle também em `/api/device-login` (defesa em profundidade; ~256 bits tornam baixo risco).
- **R6.** `esc()` escapar também `"` e `'` (`&quot;`/`&#39;`) — fecha a fragilidade latente de A8.
- **R7.** Remover `crypto-js.min.js` (AES-CBC legado morto) após confirmar zero referências.
- **R8.** CSP restritiva (exigiria nonce/hashes para os scripts inline das duas páginas).
- **R9.** Headers também no redirecionador :8000 (trivial, mas fora do diff mínimo adotado aqui).
- **R10.** Auditoria independente / pentest externo antes de qualquer release que exponha o dashboard fora de LAN confiável.
- **R11.** HMAC/compare_digest para comparação de chaves se o lookup por hash for trocado por comparação direta no futuro.

## 7. Pendências e notas

- Teste manual de pareamento com celular físico e validação de TTL/revogação fim-a-fim ficam para sessão com o usuário na LAN; o que foi verificado aqui é o equivalente in-process (emissão, uso único, throttle, 401/429, fechamento de WS).
- O CI do repo (`compileall Mark-LVI`) deve continuar verde; nenhuma dependência nova.
- `git` não foi tocado (sem add/commit/push); branch `Dev`.

---

*Revisão executada por subagente em 16/11/2026. Achados A1–A5 corrigidos e verificados; A6–A9 e I1–I10 registrados; R1–R11 aguardando decisão do usuário.*
