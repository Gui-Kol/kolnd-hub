# Web UI fixtures

Payloads de apoio aos testes do web UI. **Nao sao payloads capturados de um host ao vivo**:
o host C++ nao estava disponivel durante a execucao da task (T0), portanto cada arquivo foi
derivado dos campos efetivamente lidos pelo frontend e dos mocks ja existentes em
`kloud-games/tests/web/` (ver origem por arquivo abaixo).

| Arquivo | Endpoint | Origem |
|---|---|---|
| `config.json` | `GET ./api/config` | Campos lidos por `Home.vue`, `Apps.vue`, `Config.vue`, `Troubleshooting.vue` e defaults de `configs/config_tabs.json`. |
| `apps.json` | `GET ./api/apps` | Campos usados por `Apps.vue` (inclui `prep-cmd`/`detached` e opcionais falsy). |
| `logs.txt` | `GET ./api/logs` (texto puro) | Formato `[YYYY-MM-DD HH:MM:SS.mmm]: Level: message` consumido por `Home.vue` e `Troubleshooting.vue`. |
| `permissions.json` | `GET ./api/permissions` | Forma de `Troubleshooting.test.js` / `Home.test.js` (`id`, `status`, `required`, `verifiable`, `requestable`). |
| `virtual_input_status.json` | `GET ./api/virtual-input/status` | Forma de `Troubleshooting.test.js` + campos de `Home.vue`. |
| `virtual_input_license.json` | `GET ./api/virtual-input/license` | Campos lidos por `Troubleshooting.vue` (`state`, `licensed`, limit, URLs). |
| `clients_list.json` | `GET ./api/clients/list` | `named_certs` com `name`, `uuid`, `enabled` (unico contrato exposto pelo host). |
| `pin.json` | `GET ./api/pin` | `pairings` com `id`, `name`, `address`. |
| `browse.json` | `GET ./api/browse` | `path`, `parent`, `entries[]` com `name`, `path`, `type`. |

Regra: ao alterar o contrato do host, atualize estes arquivos e a documentacao acima.
