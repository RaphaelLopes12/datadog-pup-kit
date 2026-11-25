const stateLabels = {
  alert: 'Em alerta',
  warn: 'Em aviso',
  nodata: 'Sem dados',
  unknown: 'Estado desconhecido',
  ok: 'Normal'
};

const transitionLabels = {
  alert: 'entrou em alerta',
  warn: 'entrou em aviso',
  nodata: 'ficou sem dados',
  unknown: 'ficou em estado desconhecido',
  ok: 'voltou ao normal'
};

const severity = ['alert', 'warn', 'nodata', 'unknown', 'ok'];
const firing = new Set(['alert', 'warn', 'nodata']);

const elements = {
  masthead: document.getElementById('masthead'),
  headline: document.getElementById('headline'),
  checked: document.getElementById('checked'),
  check: document.getElementById('check'),
  services: document.getElementById('services'),
  history: document.getElementById('history'),
  historyEmpty: document.getElementById('history-empty'),
  detail: document.getElementById('detail'),
  detailService: document.getElementById('detail-service'),
  detailName: document.getElementById('detail-name'),
  detailState: document.getElementById('detail-state'),
  detailText: document.getElementById('detail-text'),
  detailQuery: document.getElementById('detail-query'),
  detailLink: document.getElementById('detail-link'),
  detailCopy: document.getElementById('detail-copy')
};

const timeFormat = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const dayFormat = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' });
const relativeFormat = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'always', style: 'short' });

let currentState = null;
let openSignal = null;

function create(tag, className, text) {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function plural(count, singular, pluralForm) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function since(isoDate) {
  if (!isoDate) {
    return '';
  }
  const minutes = Math.round((new Date(isoDate).getTime() - Date.now()) / 60000);
  if (Math.abs(minutes) < 60) {
    return relativeFormat.format(minutes, 'minute');
  }
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 48) {
    return relativeFormat.format(hours, 'hour');
  }
  return relativeFormat.format(Math.round(hours / 24), 'day');
}

function sortSignals(signals) {
  return signals.slice().sort((left, right) => {
    const bySeverity = severity.indexOf(left.state) - severity.indexOf(right.state);
    return bySeverity !== 0 ? bySeverity : left.name.localeCompare(right.name, 'pt-BR');
  });
}

function renderMasthead(state) {
  const signals = state.services.flatMap((service) => service.signals);
  const firingSignals = signals.filter((signal) => firing.has(signal.state));
  const affected = state.services.filter((service) => service.signals.some((signal) => firing.has(signal.state))).length;
  const failures = state.services.filter((service) => service.errors.length > 0).length;

  let level = 'idle';
  let headline = 'Aguardando a primeira verificação';

  if (state.checkedAt) {
    if (firingSignals.length > 0) {
      level = firingSignals.some((signal) => signal.state === 'alert') ? 'alert' : 'warn';
      headline = `${plural(firingSignals.length, 'sinal disparando', 'sinais disparando')} em ${plural(affected, 'serviço', 'serviços')}`;
    } else if (failures > 0) {
      level = 'warn';
      headline = `Não consegui consultar ${plural(failures, 'serviço', 'serviços')}`;
    } else {
      level = 'ok';
      headline = `Tudo normal em ${plural(state.services.length, 'serviço', 'serviços')}`;
    }
  }

  elements.masthead.dataset.level = level;
  elements.headline.textContent = headline;
  document.title = firingSignals.length > 0 ? `(${firingSignals.length}) Vigia Datadog` : 'Vigia Datadog';

  if (state.checking) {
    elements.checked.textContent = 'Verificando agora';
  } else if (state.checkedAt) {
    elements.checked.textContent = `Última verificação às ${timeFormat.format(new Date(state.checkedAt))}. Repete a cada ${state.intervalSeconds} s.`;
  } else {
    elements.checked.textContent = '';
  }

  elements.check.disabled = state.checking;
  elements.check.textContent = state.checking ? 'Verificando' : 'Verificar agora';
}

function renderLamp(service, signal) {
  const item = create('li');
  const lamp = create('button', 'lamp');
  lamp.type = 'button';
  lamp.dataset.state = signal.state;
  lamp.dataset.stale = String(Boolean(signal.stale));

  const status = [stateLabels[signal.state]];
  if (signal.kind === 'errorLogs' && typeof signal.value === 'number') {
    status.push(`${signal.value} de ${signal.threshold}`);
  } else if (signal.since && signal.state !== 'ok') {
    status.push(since(signal.since));
  }

  lamp.append(create('span', 'lamp__name', signal.name), create('span', 'lamp__status', status.join(', ')));
  lamp.addEventListener('click', () => showDetail(service, signal));
  item.append(lamp);
  return item;
}

function renderServices(state) {
  const fragment = document.createDocumentFragment();

  for (const service of state.services) {
    const section = create('section', 'service');
    const head = create('div', 'service__head');
    const firingCount = service.signals.filter((signal) => firing.has(signal.state)).length;
    const tally = firingCount > 0
      ? `${firingCount} de ${plural(service.signals.length, 'sinal', 'sinais')} disparando`
      : plural(service.signals.length, 'sinal', 'sinais');

    head.append(create('h2', null, service.name), create('span', 'service__tally', tally));
    section.append(head);

    for (const message of service.errors) {
      section.append(create('p', 'service__error', `Falha ao consultar o Datadog: ${message} Se for autenticação, rode "pup auth login" no terminal.`));
    }

    if (service.signals.length === 0 && service.errors.length === 0 && state.checkedAt) {
      section.append(create('p', 'empty', 'Nenhum monitor encontrado com as tags configuradas. Confira "monitorTags" no config.json.'));
    }

    const lamps = create('ul', 'lamps');
    for (const signal of sortSignals(service.signals)) {
      lamps.append(renderLamp(service, signal));
    }
    section.append(lamps);
    fragment.append(section);
  }

  elements.services.replaceChildren(fragment);
}

function renderHistory(state) {
  const today = dayFormat.format(new Date());
  const items = state.events.map((event) => {
    const item = create('li', 'history__item');
    item.dataset.state = event.to;

    const moment = new Date(event.at);
    const day = dayFormat.format(moment);
    const time = create('time', 'history__time', day === today ? timeFormat.format(moment) : day);
    time.dateTime = event.at;

    const what = create('div', 'history__what');
    what.append(create('strong', null, `${event.serviceName} ${transitionLabels[event.to] ?? event.to}`), create('span', null, event.signalName));
    item.append(time, what);
    return item;
  });

  elements.history.replaceChildren(...items);
  elements.historyEmpty.hidden = items.length > 0;
}

function buildPrompt(service, signal) {
  const subject = signal.kind === 'monitor'
    ? `O monitor "${signal.name}" do serviço ${service.name} está ${stateLabels[signal.state].toLowerCase()}`
    : `O serviço ${service.name} está com ${signal.detail}`;
  const started = signal.since ? ` desde ${new Date(signal.since).toLocaleString('pt-BR')}` : '';

  return [
    `${subject}${started}.`,
    signal.query ? `Query: ${signal.query}` : null,
    '',
    'Usando o pup:',
    '1. Rode a mesma query na janela do disparo e mostre quando cruzou o limite.',
    '2. Agregue os logs de erro do serviço na janela por mensagem ou tipo de exceção.',
    '3. Busque traces lentos ou com erro e quebre o tempo por span.',
    '4. Veja se houve deploy ou mudança de configuração perto do início.',
    '',
    'Cruze com o código deste repositório e aponte a causa mais provável, com a',
    'evidência de cada passo. Não altere nada no Datadog nem no código.'
  ].filter((line) => line !== null).join('\n');
}

function showDetail(service, signal) {
  openSignal = { service, signal };
  elements.detailService.textContent = service.name;
  elements.detailName.textContent = signal.name;
  elements.detailState.textContent = [stateLabels[signal.state], signal.since ? since(signal.since) : null, signal.stale ? 'dado da verificação anterior' : null]
    .filter(Boolean)
    .join(', ');
  elements.detailText.textContent = signal.detail ?? '';
  elements.detailQuery.textContent = signal.query ?? '';
  elements.detailLink.href = signal.url ?? currentState.datadogAppUrl;
  elements.detailCopy.textContent = 'Copiar prompt para o Cursor';
  elements.detail.showModal();
}

function render(state) {
  currentState = state;
  renderMasthead(state);
  renderServices(state);
  renderHistory(state);
}

elements.check.addEventListener('click', () => {
  elements.check.disabled = true;
  fetch('/api/check', { method: 'POST' });
});

elements.detailCopy.addEventListener('click', async () => {
  if (!openSignal) {
    return;
  }
  try {
    await navigator.clipboard.writeText(buildPrompt(openSignal.service, openSignal.signal));
    elements.detailCopy.textContent = 'Prompt copiado';
  } catch {
    elements.detailCopy.textContent = 'Não consegui copiar. Permita acesso à área de transferência.';
  }
});

const stream = new EventSource('/api/events');
stream.onmessage = (message) => render(JSON.parse(message.data));
stream.onerror = () => {
  elements.checked.textContent = 'Sem conexão com o vigia. Confira se "npm start" ainda está rodando.';
};
