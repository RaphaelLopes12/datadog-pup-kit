const allowedDomains = new Set([
  'apm',
  'change-stories',
  'cicd',
  'containers',
  'dashboards',
  'dbm',
  'downtime',
  'error-tracking',
  'events',
  'incidents',
  'infrastructure',
  'logs',
  'metrics',
  'monitors',
  'notebooks',
  'processes',
  'rum',
  'service-catalog',
  'slos',
  'software-catalog',
  'synthetics',
  'traces'
]);

const readVerbs = new Set([
  'aggregate',
  'dependencies',
  'describe',
  'entities',
  'flow-map',
  'get',
  'list',
  'query',
  'search',
  'services',
  'status',
  'url'
]);

const forbiddenFlags = new Set(['-y', '--yes', '--no-envelope', '-o', '--output', '--org', '--trust-site']);
const maximumResultLength = 60000;

export class CommandRejectedError extends Error {}

export function validateCommand(commandArguments) {
  if (!Array.isArray(commandArguments) || commandArguments.length === 0 || !commandArguments.every((argument) => typeof argument === 'string')) {
    throw new CommandRejectedError('"arguments" must be a non-empty list of strings.');
  }

  const firstFlagIndex = commandArguments.findIndex((argument) => argument.startsWith('-'));
  const positional = firstFlagIndex === -1 ? commandArguments : commandArguments.slice(0, firstFlagIndex);
  const flags = firstFlagIndex === -1 ? [] : commandArguments.slice(firstFlagIndex);

  if (positional.length < 2) {
    throw new CommandRejectedError('Give a domain and a read command, for example ["logs", "search", "--query=..."].');
  }

  if (!allowedDomains.has(positional[0])) {
    throw new CommandRejectedError(`Domain "${positional[0]}" is not available. Allowed: ${[...allowedDomains].join(', ')}.`);
  }

  const verb = positional[positional.length - 1];
  if (!readVerbs.has(verb)) {
    throw new CommandRejectedError(`Command "${verb}" is not a read command. Allowed: ${[...readVerbs].join(', ')}.`);
  }

  for (const flag of flags) {
    const name = flag.split('=')[0];
    if (forbiddenFlags.has(name)) {
      throw new CommandRejectedError(`Flag "${name}" is not allowed.`);
    }
  }

  return [...commandArguments, '--read-only'];
}

function truncate(text) {
  if (text.length <= maximumResultLength) {
    return text;
  }
  return `${text.slice(0, maximumResultLength)}\n[output truncated at ${maximumResultLength} characters; narrow the time window, add filters or use --limit]`;
}

export function createDatadogReadTool({ pupClient, onCall }) {
  return {
    description: [
      'Runs a read-only Datadog query through the pup CLI and returns JSON.',
      'Pass the pup arguments as a list, without the leading "pup".',
      'Examples: ["logs","search","--query=service:x status:error","--from=1h","--limit=20"],',
      '["logs","aggregate","--query=service:x status:error","--from=1h","--compute=count","--group-by=@error.kind"],',
      '["monitors","get","12345"], ["traces","search","--query=service:x","--from=1h"].',
      'Use ["<domain>","<command>","--help"] to discover flags.',
      'Write commands are rejected.'
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        arguments: {
          type: 'array',
          items: { type: 'string' },
          description: 'pup arguments, one list item per argument'
        }
      },
      required: ['arguments']
    },
    annotations: { readOnlyHint: true },
    async execute(input) {
      const requested = input?.arguments;
      const label = Array.isArray(requested) ? `pup ${requested.join(' ')}` : 'pup';

      let safeArguments;
      try {
        safeArguments = validateCommand(requested);
      } catch (error) {
        onCall?.({ label, status: 'rejected' });
        return { content: [{ type: 'text', text: error.message }], isError: true };
      }

      const step = onCall?.({ label, status: 'running' });
      try {
        const wantsHelp = requested.includes('--help');
        const output = wantsHelp ? await pupClient.runText(safeArguments) : JSON.stringify(await pupClient.run(safeArguments));
        step?.finish('completed');
        return truncate(output);
      } catch (error) {
        step?.finish('error');
        return { content: [{ type: 'text', text: `pup failed: ${error.message}` }], isError: true };
      }
    }
  };
}
