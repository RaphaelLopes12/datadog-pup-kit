# datadog-pup-kit

Kit para usar o [pup](https://github.com/DataDog/pup), o CLI do Datadog, junto com o agente do Cursor em Windows, sem privilégio de administrador e com login pelo próprio usuário (OAuth2, compatível com SSO).

Nenhuma API key ou App key é usada. O token fica no Windows Credential Manager do usuário.

## Conteúdo

| Caminho | Função |
|---|---|
| `scripts/Install-Pup.ps1` | Baixa a release oficial, valida o SHA-256 e instala em `%LOCALAPPDATA%\Programs\pup`, com PATH de usuário |
| `scripts/Connect-Datadog.ps1` | Login pelo browser e checagem do status |
| `scripts/Install-CursorRule.ps1` | Copia a rule do Cursor para um repositório |
| `cursor/rules/datadog-pup.mdc` | Rule que ensina o agente a usar o pup em modo somente leitura |
| `prompts/` | Prompts prontos de investigação |

## Uso

Os comandos abaixo funcionam no PowerShell e no Git Bash. No Git Bash, escreva caminhos com `/`: a barra invertida é caractere de escape e some do comando.

### 1. Instalar o pup

```powershell
powershell -ExecutionPolicy Bypass -File ./scripts/Install-Pup.ps1
```

Parâmetros: `-Version 2.7.1` fixa a versão, `-InstallDir` muda o destino, `-Force` reinstala, `-NoPathUpdate` não toca no PATH.

Reabra o terminal e o Cursor depois da primeira instalação.

### 2. Autenticar

Site padrão (`datadoghq.com`):

```powershell
powershell -ExecutionPolicy Bypass -File ./scripts/Connect-Datadog.ps1
```

Organização com SSO e página de login própria (`<empresa>.datadoghq.com`):

```powershell
powershell -ExecutionPolicy Bypass -File ./scripts/Connect-Datadog.ps1 -Site <empresa>.datadoghq.com -PersistSite
```

`-PersistSite` grava `DD_SITE` no ambiente do usuário, para que os comandos seguintes e o terminal do Cursor usem o mesmo site. Também existem `-Org <nome>` para sessão nomeada e `-OrgUuid <uuid>` para pré-selecionar a organização.

O login pede só escopos de leitura (`pup auth login --read-only`), então o token não consegue criar, alterar nem apagar nada, mesmo que o agente tente. Para um token com escrita, use `-AllowWrite`.

Teste:

```powershell
pup monitors list
```

### 3. Instalar as skills oficiais do pup no Cursor

```powershell
pup skills install cursor
```

Instala em `~/.cursor/skills` os guias mantidos pelo Datadog (logs, APM, monitors e o próprio pup). Com `--project`, instala no repositório atual em vez do perfil do usuário. `pup skills list` mostra o que existe.

### 4. Instalar a rule em um repositório

A rule deste kit complementa as skills oficiais com os limites do time: somente leitura, sem expor token, cuidado com dado pessoal.

```powershell
powershell -ExecutionPolicy Bypass -File ./scripts/Install-CursorRule.ps1 -RepoPath C:/src/meu-servico -ExcludeFromGit
```

`-ExcludeFromGit` registra o arquivo em `.git/info/exclude`, então a rule fica local e não aparece no `git status` do repositório do serviço. Sem o parâmetro, a rule pode ser commitada e compartilhada com o time.

### 5. Usar no Cursor

Abra o repositório do serviço, abra o agente e cole um dos prompts de `prompts/`, trocando os valores entre `<>`.

## Problemas comuns

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| Download falha ou dá timeout | `github.com` bloqueado ou atrás de proxy | Baixar `pup_<versão>_Windows_x86_64.zip` por um canal liberado, extrair `pup.exe` em `%LOCALAPPDATA%\Programs\pup` e rodar o instalador de novo para acertar o PATH |
| `pup.exe` bloqueado ao executar | Política de execução de binários (AppLocker, EDR) | Pedir liberação ao time de segurança; não há contorno |
| Login abre o browser e termina em erro de cliente OAuth | Dynamic Client Registration desabilitado na organização | Pedir habilitação ao admin do Datadog |
| Login cai na organização errada | Sessão do browser em outra organização | Usar `-Site` com a URL de SSO ou `-OrgUuid` |
| `403` em um comando | O papel do usuário não cobre aquele produto | Pedir a permissão no Datadog |
| Cursor não encontra `pup` | Cursor aberto antes da instalação | Fechar todas as janelas do Cursor e abrir de novo |

## Segurança

- O agente herda todas as permissões do usuário logado. Mantenha a aprovação de comandos de terminal ligada no Cursor, ou libere automaticamente só subcomandos de leitura (`list`, `get`, `search`, `query`, `aggregate`).
- A rule proíbe escrita e exposição de token, mas rule é instrução e não barreira. As barreiras são o token somente leitura do login padrão e a aprovação de comandos.
- Logs e traces podem conter dado pessoal. Não cole saída bruta em chat, issue ou commit.
- Confirme com o time de segurança se o uso do CLI e o envio de dados de observabilidade para o modelo do Cursor estão dentro da política da empresa.
