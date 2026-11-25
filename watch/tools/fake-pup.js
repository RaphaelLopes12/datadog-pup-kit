import { readFileSync } from 'node:fs';

const scenario = JSON.parse(readFileSync(process.env.FAKE_PUP_SCENARIO, 'utf8'));
const commandArguments = process.argv.slice(2);
const valueOf = (name) => commandArguments.find((argument) => argument.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? '';

if (scenario.failWith) {
  console.error(scenario.failWith);
  process.exit(1);
}

if (commandArguments[0] === 'monitors') {
  const tags = valueOf('tags').split(',');
  const data = scenario.monitors.filter((monitor) => tags.every((tag) => monitor.tags.includes(tag)));
  console.log(JSON.stringify({ data, metadata: { command: 'monitors list', count: data.length }, status: 'success' }));
} else if (commandArguments[0] === 'logs') {
  const count = scenario.errorCounts[valueOf('query')] ?? 0;
  console.log(JSON.stringify({ data: { data: { buckets: [{ by: {}, computes: { c0: count } }] } }, status: 'success' }));
} else {
  console.error(`unsupported: ${commandArguments.join(' ')}`);
  process.exit(2);
}
