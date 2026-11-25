const minimumNodeVersion = [22, 13];
const repositoryTools = ['read', 'grep', 'glob', 'ls'];

function nodeVersionIsSupported() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  return major > minimumNodeVersion[0] || (major === minimumNodeVersion[0] && minor >= minimumNodeVersion[1]);
}

export class CursorAgentGateway {
  #sdk = null;
  #loginInProgress = null;

  async #load() {
    if (!this.#sdk) {
      this.#sdk = await import('@cursor/sdk');
    }
    return this.#sdk;
  }

  async availability() {
    if (!nodeVersionIsSupported()) {
      return {
        available: false,
        canLogin: false,
        reason: `O agente precisa de Node ${minimumNodeVersion.join('.')} ou mais novo. Esta máquina está com ${process.versions.node}.`
      };
    }

    let sdk;
    try {
      sdk = await this.#load();
    } catch {
      return { available: false, canLogin: false, reason: 'O SDK do Cursor não está instalado. Rode "npm install" dentro da pasta watch.' };
    }

    if (process.env.CURSOR_API_KEY) {
      return { available: true, canLogin: false, reason: null };
    }

    try {
      const status = await sdk.Cursor.auth.status();
      if (status.status === 'logged-in') {
        return { available: true, canLogin: false, reason: null, account: status.email ?? null };
      }
    } catch (error) {
      return { available: false, canLogin: true, reason: `Não consegui ler o login do Cursor: ${error.message}` };
    }

    return { available: false, canLogin: true, reason: 'Falta entrar na conta do Cursor.' };
  }

  async login() {
    if (!this.#loginInProgress) {
      this.#loginInProgress = this.#load()
        .then((sdk) => sdk.Cursor.auth.login({ apiKeyName: 'datadog-pup-watch' }))
        .finally(() => {
          this.#loginInProgress = null;
        });
    }
    await this.#loginInProgress;
  }

  async startRun({ prompt, model, repositoryPath, workingDirectory, customTools }) {
    const sdk = await this.#load();
    const agent = await sdk.Agent.create({
      model: { id: model },
      tools: repositoryPath ? [...repositoryTools, 'mcp'] : ['mcp'],
      local: { cwd: repositoryPath ?? workingDirectory, customTools }
    });

    try {
      const run = await agent.send(prompt);
      return { run, close: () => agent.close() };
    } catch (error) {
      agent.close();
      throw error;
    }
  }
}
