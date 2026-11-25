import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeTransitions } from './describeTransitions.js';

const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'Show-Toast.ps1');

export class WindowsToastNotifier {
  #enabled;
  #includeRecoveries;
  #dashboardUrl;

  constructor({ enabled, includeRecoveries, dashboardUrl }) {
    this.#enabled = enabled && process.platform === 'win32';
    this.#includeRecoveries = includeRecoveries;
    this.#dashboardUrl = dashboardUrl;
  }

  notify(transitions) {
    const description = describeTransitions(transitions, { includeRecoveries: this.#includeRecoveries });
    if (!description) {
      return Promise.resolve();
    }

    return this.show(description.title, description.message);
  }

  show(title, message) {
    if (!this.#enabled) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-Title', title, '-Message', message, '-Url', this.#dashboardUrl],
        { windowsHide: true, timeout: 20000 },
        (error, stdout, stderr) => {
          if (error) {
            console.error(`Toast failed: ${stderr?.trim() || error.message}`);
          }
          resolve();
        }
      );
    });
  }
}
