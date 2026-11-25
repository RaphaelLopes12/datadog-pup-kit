import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

export class PupError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'PupError';
    this.exitCode = details.exitCode ?? null;
    this.notInstalled = details.notInstalled ?? false;
  }
}

function defaultInstallLocation() {
  if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) {
    return null;
  }
  return path.join(process.env.LOCALAPPDATA, 'Programs', 'pup', 'pup.exe');
}

function summarizeFailure(stderr, stdout) {
  const text = `${stderr ?? ''}\n${stdout ?? ''}`.trim();
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.slice(-3).join(' ') || 'pup exited without output';
}

export class PupClient {
  #executable;
  #leadingArguments;
  #timeoutMs;

  constructor({ executable = 'pup', leadingArguments = [], timeoutMs = 60000 } = {}) {
    this.#executable = executable;
    this.#leadingArguments = leadingArguments;
    this.#timeoutMs = timeoutMs;
  }

  async run(commandArguments, options = {}) {
    const { stdout, stderr } = await this.#withFallback([...commandArguments, '--output', 'json'], options);
    try {
      return JSON.parse(stdout);
    } catch {
      throw new PupError(summarizeFailure(stderr, stdout));
    }
  }

  async runText(commandArguments, options = {}) {
    const { stdout } = await this.#withFallback(commandArguments, options);
    return stdout;
  }

  async #withFallback(commandArguments, options) {
    try {
      return await this.#execute(commandArguments, options);
    } catch (error) {
      const fallback = defaultInstallLocation();
      if (error.notInstalled && fallback && fallback !== this.#executable && existsSync(fallback)) {
        this.#executable = fallback;
        return this.#execute(commandArguments, options);
      }
      throw error;
    }
  }

  #execute(commandArguments, { timeoutMs = this.#timeoutMs } = {}) {
    return new Promise((resolve, reject) => {
      execFile(
        this.#executable,
        [...this.#leadingArguments, ...commandArguments],
        { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
        (error, stdout, stderr) => {
          if (!error) {
            resolve({ stdout, stderr });
            return;
          }
          if (error.code === 'ENOENT') {
            reject(new PupError(`pup executable not found (${this.#executable})`, { notInstalled: true }));
            return;
          }
          if (error.killed) {
            reject(new PupError(`pup timed out after ${timeoutMs / 1000}s`));
            return;
          }
          reject(new PupError(summarizeFailure(stderr, stdout), { exitCode: error.code }));
        }
      );
    });
  }
}
