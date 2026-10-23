// Host management and real PTY sessions. Credentials remain in the server's SSH setup.
let infrastructureCleanup = null;
function leaveInfrastructure() {
  infrastructureCleanup?.();
  infrastructureCleanup = null;
  screen.classList.remove('as-terminal');
}
async function infraAPI(path, body, method) {
  const r = body === undefined ? await api(path, { method: method ?? 'GET' }) : await jpost(path, body, method ?? 'POST');
  const result = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(result.error ?? `HTTP ${r.status}`);
  return result;
}
function infraButton(label, fn, secondary = false) {
  const b = el('button', `s-primary${secondary ? ' ghost' : ''}`, label);
  b.type = 'button';
  b.addEventListener('click', async () => {
    b.disabled = true;
    try { await fn(); } catch (e) { toast(e.message); }
    finally { b.disabled = false; }
  });
  return b;
}
function infraPage(title, subtitle, name) {
  setView('page');
  pageName = name;
  titleEl.textContent = title;
  subEl.textContent = subtitle;
  const box = el('div', 'page infrastructure');
  out.replaceChildren(box);
  renderDrawer();
  return box;
}
function hostEditor(host = null) {
  const form = el('form', 'infra-form');
  const fields = {};
  for (const [key, label, placeholder, value] of [
    ['label', 'Nazwa', 'Mój serwer', host?.label],
    ['address', 'Host lub alias SSH', 'server.example.com', host?.address],
    ['user', 'Użytkownik SSH', 'opcjonalnie — z konfiguracji SSH', host?.user],
    ['port', 'Port', 'opcjonalnie — z konfiguracji SSH', host?.port],
    ['identityFile', 'Ścieżka klucza na serwerze SpectraHub', 'opcjonalnie — istniejący plik', host?.identityFile],
    ['services', 'Usługi do sprawdzenia', 'np. nginx, ssh — opcjonalnie', host?.services?.join(', ')],
  ]) {
    const row = el('label', 'infra-field');
    row.append(el('span', null, label));
    const input = el('input');
    Object.assign(input, { name: key, placeholder, value: value ?? '', autocomplete: 'off' });
    if (key === 'port') { input.type = 'number'; input.min = '1'; input.max = '65535'; }
    if (key === 'label' || key === 'address') input.required = true;
    fields[key] = input;
    row.append(input); form.append(row);
  }
  form.append(el('p', 's-note', 'Dostęp przez istniejący klucz lub agenta SSH. Najpierw sprawdź odcisk klucza hosta i dodaj go do known_hosts na serwerze SpectraHub. Nie przesyłaj tutaj kluczy ani haseł.'));
  const submit = el('button', 's-primary', 'Zapisz serwer'); submit.type = 'submit'; form.append(submit);
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); submit.disabled = true;
    try {
      const body = Object.fromEntries(Object.entries(fields).map(([key, input]) => [key, input.value.trim()]));
      body.port = body.port ? Number(body.port) : null;
      body.services = body.services.split(',').map((s) => s.trim()).filter(Boolean);
      await infraAPI(`/api/hosts${host ? `/${host.id}` : ''}`, body, host ? 'PATCH' : 'POST');
      closeSheet(); await hostsPage();
    } catch (error) { toast(error.message); } finally { submit.disabled = false; }
  });
  openSheet(host ? 'Edytuj serwer' : 'Dodaj serwer SSH', [form]);
}
async function hostsPage() {
  const box = infraPage('Serwery', 'Lokalny host i połączenia SSH', 'servers');
  box.append(el('p', 's-note', 'Podgląd stanu serwerów oraz ich terminale. Połączenia SSH korzystają z tożsamości skonfigurowanej na serwerze SpectraHub.'));
  box.append(infraButton('Dodaj serwer', () => hostEditor()));
  const cards = el('div', 'infra-hosts'); box.append(cards);
  try {
    const { hosts } = await infraAPI('/api/hosts');
    if (!box.isConnected) return;
    for (const host of hosts) {
      const card = el('section', 'u-card');
      const head = el('div', 'u-head');
      head.append(svgIcon(PROJECT_ICONS.server), el('b', null, host.label), el('small', null, host.id === 'local' ? 'lokalny' : 'SSH'));
      const status = el('div', 's-note', 'Pobieranie stanu…');
      const buttons = el('div', 'infra-actions');
      buttons.append(infraButton('Terminal', () => terminalsPage(host.id)));
      if (host.id !== 'local') buttons.append(infraButton('Edytuj', () => hostEditor(host), true), infraButton('Usuń', () => {
        openSheet('Usuń połączenie', [el('p', 's-note', `Usunąć połączenie „${host.label}”? Dane zdalnego serwera pozostają na nim.`),
          infraButton('Usuń połączenie', async () => { await infraAPI(`/api/hosts/${host.id}`, undefined, 'DELETE'); closeSheet(); await hostsPage(); })]);
      }, true));
      card.append(head, status, buttons); cards.append(card);
      const refresh = async () => {
        status.textContent = 'Pobieranie stanu…';
        try {
          const { stats: d } = await infraAPI(`/api/hosts/${host.id}/stats`);
          const gb = (n) => `${(n / 1073741824).toFixed(1)} GB`;
          status.replaceChildren();
          if (d.memory?.total) status.append(bar(1 - d.memory.free / d.memory.total, `RAM: wolne ${gb(d.memory.free)}`, gb(d.memory.total)));
          if (d.disk?.total) status.append(bar(1 - d.disk.free / d.disk.total, `Dysk: wolne ${gb(d.disk.free)}`, gb(d.disk.total)));
          const kv = el('div', 'u-kv');
          kv.append(el('span', null, 'host'), el('b', null, d.hostname ?? host.label),
            el('span', null, 'działa od'), el('b', null, `${Math.floor((d.uptime ?? 0) / 86400)} dni`),
            el('span', null, 'obciążenie'), el('b', null, (d.load ?? []).join(' · ')));
          status.append(kv);
          for (const service of d.services ?? []) status.append(el('p', 's-note', `${service.name}: ${service.state}`));
        } catch (e) { status.textContent = `Niedostępny: ${e.message}`; }
      };
      buttons.append(infraButton('Odśwież', refresh, true));
      refresh();
    }
  } catch (e) { cards.append(el('p', 'err', e.message)); }
}
const TERMINAL_STATES = { pending: 'czeka na zgodę', starting: 'uruchamianie', running: 'aktywny', stopping: 'zamykanie', exited: 'zakończony', stopped: 'zatrzymany', denied: 'odmowa', error: 'błąd' };
async function terminalsPage(hostId = 'local') {
  const box = infraPage('Terminal', 'Interaktywny shell · PTY', 'shell');
  try {
    const [{ hosts }, { terminals }] = await Promise.all([infraAPI('/api/hosts'), infraAPI('/api/terminal/sessions')]);
    if (!box.isConnected) return;
    const form = el('form', 'infra-form');
    const select = el('select'); select.setAttribute('aria-label', 'Serwer terminala');
    hosts.forEach((h) => { const o = el('option', null, h.label); o.value = h.id; o.selected = h.id === hostId; select.append(o); });
    const cwd = el('input'); Object.assign(cwd, { placeholder: 'Katalog pracy — opcjonalnie', autocomplete: 'off' }); cwd.setAttribute('aria-label', 'Katalog pracy');
    const create = el('button', 's-primary', 'Nowy terminal'); create.type = 'submit';
    form.append(select, cwd, create);
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); create.disabled = true;
      try { const { terminal } = await infraAPI('/api/terminal/sessions', { hostId: select.value, ...(cwd.value.trim() ? { cwd: cwd.value.trim() } : {}) }); await terminalPage(terminal.id); }
      catch (error) { toast(error.message); } finally { create.disabled = false; }
    });
    box.append(form, el('p', 's-note', 'Nowy shell uruchomi się dopiero po Twojej zgodzie. Zamknięcie widoku nie kończy aktywnego terminala.'));
    const active = terminals.filter((t) => !['exited', 'stopped', 'denied', 'error'].includes(t.state));
    box.append(group(...active.map((t) => item(PROJECT_ICONS.terminal, hosts.find((h) => h.id === t.hostId)?.label ?? t.hostId,
      () => terminalPage(t.id), { sub: `${TERMINAL_STATES[t.state] ?? t.state} · ${t.cwd ?? ''}`, right: svgIcon(ICON.chevron) }))));
    box.append(infraButton('Komendy tylko do odczytu', () => { setView('shell'); pageName = 'shell'; }, true));
  } catch (e) { box.append(el('p', 'err', e.message)); }
}
async function terminalPage(id) {
  const box = infraPage('Terminal', 'Łączenie…', 'shell');
  let term, fit, observer;
  const abort = new AbortController();
  let live = true, sequence = 0, outputQueue = Promise.resolve();
  infrastructureCleanup = () => { live = false; abort.abort(); observer?.disconnect(); term?.dispose(); };
  const actions = el('div', 'infra-actions');
  actions.append(infraButton('Terminale', () => terminalsPage(), true), infraButton('Zakończ shell', async () => {
    await infraAPI(`/api/terminal/sessions/${id}`, undefined, 'DELETE');
  }, true));
  box.append(actions);
  const approval = el('div', 'infra-approval'); box.append(approval);
  const terminalContainer = el('div', 'pty-surface'); box.append(terminalContainer);
  const keys = el('div', 'infra-actions pty-keys');
  const sendInput = (data) => {
    outputQueue = outputQueue.then(() => infraAPI(`/api/terminal/sessions/${id}/input`, { data })).catch((e) => { if (live) toast(e.message); });
    return outputQueue;
  };
  for (const [label, data] of [['Esc', '\x1b'], ['Tab', '\t'], ['Ctrl+C', '\x03'], ['Ctrl+D', '\x04'], ['↑', '\x1b[A'], ['↓', '\x1b[B']]) keys.append(infraButton(label, () => sendInput(data), true));
  box.append(keys);
  const showState = (t) => {
    if (!live) return;
    subEl.textContent = `${t.hostId} · ${TERMINAL_STATES[t.state] ?? t.state}`;
    approval.replaceChildren();
    if (t.state === 'pending') {
      approval.append(el('h3', null, 'Zezwolić na interaktywny shell?'),
        el('p', 's-note', `Host: ${t.hostId}. Katalog: ${t.cwd || 'domowy'}. Zgoda obejmuje wszystkie polecenia wpisane w tej sesji aż do jej zakończenia, w tym zmiany plików i usług. Uprawnienia wynikają z konta systemowego.`),
        infraButton('Zezwól i uruchom', async () => { const r = await infraAPI(`/api/terminal/sessions/${id}/approve`, { allow: true }); showState(r.terminal); }),
        infraButton('Odmów', async () => { const r = await infraAPI(`/api/terminal/sessions/${id}/approve`, { allow: false }); showState(r.terminal); }, true));
    }
    if (t.error) approval.append(el('p', 'err', t.error));
    const running = t.state === 'running';
    for (const b of keys.querySelectorAll('button')) b.disabled = !running;
    if (term) term.options.disableStdin = !running;
  };
  try {
    const { terminal } = await infraAPI(`/api/terminal/sessions/${id}`);
    if (!live) return;
    if (!window.Terminal || !window.FitAddon) throw new Error('Brak komponentu terminala. Odśwież stronę po instalacji zależności serwera.');
    screen.classList.add('as-terminal');
    term = new window.Terminal({ cursorBlink: true, fontSize: 13, fontFamily: 'ui-monospace, Menlo, monospace', scrollback: 5000, theme: { background: '#080808', foreground: '#ded9d4' }, allowProposedApi: false });
    fit = new window.FitAddon.FitAddon(); term.loadAddon(fit); term.open(terminalContainer);
    term.onData(sendInput);
    let resizeTimer;
    observer = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (!live) return;
        fit.fit();
        infraAPI(`/api/terminal/sessions/${id}/resize`, { cols: term.cols, rows: term.rows }).catch(() => {});
      }, 100);
    });
    observer.observe(terminalContainer);
    showState(terminal);
    while (live) {
      try {
        const r = await api(`/api/terminal/sessions/${id}/events`, { signal: abort.signal });
        if (r.status === 404) {
          showState({ hostId: terminal.hostId, state: 'exited' });
          approval.append(el('p', 's-note', 'Ta sesja terminala została zakończona. Otwórz nowy terminal.')); break;
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        await readSSE(r, (_name, event) => {
          if (!live) return;
          if (event.type === 'snapshot') {
            term.reset(); term.write(event.output ?? ''); sequence = event.seq ?? 0; showState(event.terminal);
          } else if (event.type === 'data' && (!event.seq || event.seq > sequence)) {
            sequence = event.seq ?? sequence; term.write(event.data);
          } else if (event.terminal) showState(event.terminal);
          else if (event.type === 'exit') { term.options.disableStdin = true; subEl.textContent = `zakończony · kod ${event.code ?? '—'}`; }
        });
      } catch (error) { if (!live || error.name === 'AbortError') break; subEl.textContent = 'Połączenie przerwane — ponawianie…'; }
      if (live) await sleep(1500);
    }
  } catch (e) { if (live) box.append(el('p', 'err', e.message)); }
}
