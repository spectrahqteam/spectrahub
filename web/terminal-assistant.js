// Advice alongside a PTY. Only an explicit owner action can transfer text to the terminal.
function createTerminalAssistant({ id, container, readVisible, insertText, focusTerminal, onToggle }) {
  const panel = el('aside', 'terminal-assistant');
  panel.hidden = true;
  panel.setAttribute('aria-label', 'Agenci w terminalu');
  container.append(panel);
  let live = true, opened = false, loaded = false, sending = false;
  let terminal = null, session = null, catalog = [], selected = new Set();
  let stream = null, refreshTimer = null, refreshFlight = false, previouslyRunning = false;
  const head = el('div', 'ta-head');
  const close = infraButton('Zamknij pomoc', () => toggle(false), true);
  head.append(el('b', null, 'Agenci w terminalu'), close);
  const host = el('p', 'ta-host');
  const picker = el('fieldset', 'ta-picker');
  const legend = el('legend', null, 'Kto ma pomóc?'); picker.append(legend);
  const status = el('p', 'ta-status', 'Wybierz agenta i opisz zadanie.');
  status.setAttribute('role', 'status');
  const history = el('div', 'ta-history');
  history.setAttribute('aria-label', 'Odpowiedzi agentów');
  history.setAttribute('aria-live', 'polite');
  const form = el('form', 'ta-form');
  const prompt = el('textarea', 'ta-prompt');
  Object.assign(prompt, { placeholder: 'Co chcesz zrobić w terminalu?', rows: 2, maxLength: 12000 });
  prompt.setAttribute('aria-label', 'Pytanie do agentów');
  const contextLabel = el('label', 'ta-check');
  const include = el('input'); include.type = 'checkbox';
  contextLabel.append(include, el('span', null, 'Dołącz widoczny wynik terminala'));
  const contextBox = el('div', 'ta-context'); contextBox.hidden = true;
  const preview = el('textarea', 'ta-preview');
  Object.assign(preview, { readOnly: true, rows: 3 });
  preview.setAttribute('aria-label', 'Dokładny kontekst wysyłany agentom');
  const capture = () => { preview.value = String(readVisible() ?? '').slice(-6000); };
  contextBox.append(el('small', null, 'Wyślesz ten fragment (do 6000 znaków). Sprawdź, czy nie zawiera sekretów.'), preview,
    infraButton('Odśwież podgląd', capture, true));
  include.addEventListener('change', () => { contextBox.hidden = !include.checked; if (include.checked) capture(); else preview.value = ''; });
  const controls = el('div', 'ta-controls');
  const submit = el('button', 's-primary', 'Zapytaj agentów'); submit.type = 'submit';
  const stop = infraButton('Zatrzymaj odpowiedź', async () => {
    if (!session) return;
    await infraAPI(`/api/sessions/${session.id}/stop`, {});
    scheduleRefresh();
  }, true);
  stop.hidden = true;
  controls.append(submit, stop);
  form.append(prompt, contextLabel, contextBox, controls,
    el('small', 'ta-note', 'Pytanie i zaznaczony kontekst trafią do wybranych agentów oraz ich dostawców modeli. Agenci doradzają; polecenie przenosisz do terminala samodzielnie.'));
  const staging = el('section', 'ta-staging'); staging.hidden = true;
  const command = el('textarea', 'ta-command');
  command.rows = 2; command.setAttribute('aria-label', 'Proponowane polecenie');
  const readyLabel = el('label', 'ta-check');
  const ready = el('input'); ready.type = 'checkbox';
  readyLabel.append(ready, el('span', null, 'Terminal czeka na nowe polecenie powłoki'));
  const commandHint = el('p', 'ta-note');
  const copy = infraButton('Kopiuj', () => clip(command.value), true);
  const insert = infraButton('Wstaw bez Enter', async () => {
    if (!canInsert()) return;
    await insertText(command.value);
    if (!live) return;
    ready.checked = false;
    syncCommand();
    status.textContent = 'Wstawiono tekst bez Enter. Sprawdź linię w terminalu i uruchom ją samodzielnie.';
    toggle(false);
    focusTerminal();
  });
  const commandActions = el('div', 'ta-controls');
  commandActions.append(copy, insert, infraButton('Schowaj', () => { staging.hidden = true; ready.checked = false; }, true));
  staging.append(el('b', null, 'Sprawdź proponowane polecenie'), command, commandHint, readyLabel, commandActions);
  const canInsert = () => terminal?.state === 'running' && ready.checked && command.value.trim().length > 0
    && command.value.length <= 4096 && !/[\x00-\x1f\x7f-\x9f\u2028\u2029]/.test(command.value);
  function syncCommand() {
    insert.disabled = !canInsert();
    const multiline = /[\x00-\x1f\x7f-\x9f\u2028\u2029]/.test(command.value);
    commandHint.textContent = multiline || command.value.length > 4096
      ? 'Wstawianie obsługuje jedną linię bez znaków sterujących, do 4096 znaków. Ten fragment możesz skopiować i przejrzeć samodzielnie.'
      : 'Sprawdź, czy powłoka czeka na polecenie i czy bieżąca linia jest pusta. Wstawienie nie wysyła Enter i nie czyści istniejącego tekstu.';
  }
  command.addEventListener('input', () => { ready.checked = false; syncCommand(); });
  ready.addEventListener('change', syncCommand);
  panel.append(head, host, picker, status, history, staging, form);

  function isBusy() { return sending || Boolean(session && (Object.values(session.agents ?? {}).some((a) => a.state === 'busy') || session.log?.some((e) => e.status === 'running'))); }
  function syncControls() {
    const busy = isBusy();
    const running = Boolean(session && (Object.values(session.agents ?? {}).some((a) => a.state === 'busy') || session.log?.some((e) => e.status === 'running')));
    if (previouslyRunning && !running && terminal?.state === 'running') status.textContent = 'Agenci zakończyli odpowiedzi. Sprawdź wynik i proponowane polecenia.';
    previouslyRunning = running;
    submit.disabled = busy || terminal?.state !== 'running' || selected.size === 0 || !prompt.value.trim();
    stop.hidden = !busy || !session;
    for (const input of picker.querySelectorAll('input')) input.disabled = busy || !catalog.find((a) => a.id === input.value)?.ready;
    syncCommand();
  }
  prompt.addEventListener('input', syncControls);
  function drawPicker() {
    picker.replaceChildren(legend);
    for (const agent of catalog) {
      const label = el('label', 'ta-agent');
      const input = el('input'); input.type = 'checkbox'; input.value = agent.id;
      input.checked = selected.has(agent.id); input.disabled = !agent.ready;
      input.addEventListener('change', () => { if (input.checked) selected.add(agent.id); else selected.delete(agent.id); syncControls(); });
      label.append(input, logo(agent.id), el('span', null, agent.label || nameOf(agent.id)));
      if (!agent.ready) label.append(el('small', null, 'niedostępny'));
      picker.append(label);
    }
    if (!catalog.some((a) => a.ready)) picker.append(el('p', 'ta-note', 'Brak gotowego agenta. Sprawdź instalację i logowanie w sekcji Agenci.'));
    syncControls();
  }
  function prepare(code) {
    command.value = code;
    ready.checked = false;
    staging.hidden = false;
    syncCommand();
    command.focus({ preventScroll: true });
    staging.scrollIntoView({ block: 'nearest' });
  }
  function renderAnswer(parent, value) {
    // Text and code are DOM text nodes, never trusted agent HTML.
    const text = String(value ?? '');
    const re = /```([^\n`]*)\n([\s\S]*?)```/g;
    let at = 0;
    for (let m; (m = re.exec(text));) {
      if (m.index > at) parent.append(el('div', 'ta-text', text.slice(at, m.index)));
      const code = m[2].replace(/\n$/, '');
      parent.append(el('pre', 'ta-code', code));
      const row = el('div', 'ta-code-actions');
      row.append(infraButton('Kopiuj fragment', () => clip(code), true));
      if (/^(?:bash|sh|shell|zsh|console)?\s*$/i.test(m[1])) row.append(infraButton('Przygotuj polecenie', () => prepare(code), true));
      parent.append(row); at = re.lastIndex;
    }
    if (at < text.length) parent.append(el('div', 'ta-text', text.slice(at)));
  }
  function drawHistory() {
    const bottom = history.scrollHeight - history.scrollTop - history.clientHeight < 60;
    const fragment = document.createDocumentFragment();
    for (const entry of session?.log ?? []) {
      if (entry.who === 'system') continue;
      const card = el('article', `ta-message ${entry.who === 'you' ? 'from-owner' : 'from-agent'}`);
      card.append(el('b', 'ta-speaker', entry.who === 'you' ? 'Ty' : catalog.find((a) => a.id === entry.who)?.label ?? nameOf(entry.who)));
      if (entry.who === 'you') {
        const marker = '\n\nPytanie użytkownika:\n';
        const pos = String(entry.s ?? '').indexOf(marker);
        card.append(el('div', 'ta-text', entry.terminalQuestion ?? (pos >= 0 ? entry.s.slice(pos + marker.length) : entry.s ?? '')));
      } else {
        renderAnswer(card, entry.s);
        if (entry.status === 'running') card.append(el('small', 'ta-progress', 'Pracuje…'));
        if (entry.error) card.append(el('p', 'err', entry.error));
        if ((entry.items ?? []).some((i) => i.k === 'ask' && i.status === 'waiting')) {
          card.append(el('p', 'ta-note', 'Agent czeka na odpowiedź. Możesz otworzyć pełną rozmowę; terminal pozostanie aktywny.'),
            infraButton('Otwórz rozmowę', () => openSession(session.id), true));
        }
      }
      fragment.append(card);
    }
    history.replaceChildren(fragment);
    if (!history.children.length) history.append(el('p', 'ta-empty', 'Agenci pomogą wyjaśnić wynik, znaleźć błąd i przygotować polecenie.'));
    if (bottom) history.scrollTop = history.scrollHeight;
    syncControls();
  }
  async function refreshSession() {
    if (!live || !session || refreshFlight) return;
    const sid = session.id;
    refreshFlight = true;
    try {
      const result = await infraAPI(`/api/sessions/${sid}`);
      if (live && session?.id === sid) { session = result.session; drawHistory(); }
    } catch (e) { if (live) status.textContent = e.message; }
    finally { refreshFlight = false; }
  }
  function scheduleRefresh() {
    if (!live || refreshTimer) return;
    refreshTimer = setTimeout(() => { refreshTimer = null; refreshSession(); }, 180);
  }
  function watchSession(sid) {
    stream?.abort();
    const control = new AbortController(); stream = control;
    (async () => {
      while (live && !control.signal.aborted && session?.id === sid) {
        try {
          const r = await api(`/api/sessions/${sid}/events`, { signal: control.signal });
          if (!r.ok) { if ([401, 403, 404].includes(r.status)) break; throw new Error(`HTTP ${r.status}`); }
          await readSSE(r, (_name, event) => {
            if (!live || control.signal.aborted || session?.id !== sid) return;
            if (event.type === 'snapshot') { session = event.session; drawHistory(); }
            else scheduleRefresh();
          });
        } catch (error) { if (!live || control.signal.aborted) break; status.textContent = 'Łączenie z rozmową…'; }
        if (live && !control.signal.aborted) await sleep(1200);
      }
    })();
  }
  async function load() {
    status.textContent = 'Sprawdzanie agentów…';
    try {
      const result = await infraAPI(`/api/terminal/sessions/${id}/assistant`);
      if (!live) return;
      catalog = result.agents ?? []; session = result.session;
      selected = new Set(session ? Object.keys(session.agents ?? {}) : catalog.filter((a) => a.ready).slice(0, 1).map((a) => a.id));
      updateTerminal(result.terminal); drawPicker(); drawHistory(); loaded = true;
      status.textContent = 'Wybierz agentów i opisz, w czym mają pomóc.';
      if (session) watchSession(session.id);
    } catch (e) { if (live) status.textContent = e.message; }
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    const text = prompt.value.trim();
    const data = { agents: [...selected], text, includeOutput: include.checked, ...(include.checked ? { output: preview.value } : {}) };
    sending = true; syncControls(); status.textContent = 'Przekazywanie pytania…';
    try {
      const result = await infraAPI(`/api/terminal/sessions/${id}/assistant`, data);
      if (!live) return;
      session = result.session; prompt.value = ''; include.checked = false; preview.value = ''; contextBox.hidden = true;
      status.textContent = session.log?.some((e) => e.status === 'running') ? 'Agenci przygotowują odpowiedź.' : 'Odpowiedzi gotowe. Sprawdź proponowane polecenia.';
      drawHistory(); watchSession(session.id);
    } catch (e) { if (live) status.textContent = e.message; }
    finally { sending = false; if (live) syncControls(); }
  });
  function updateTerminal(next) {
    if (!live || !next) return;
    terminal = next;
    host.textContent = `${next.hostLabel || next.hostId} · katalog początkowy: ${next.cwd || 'domowy'}`;
    if (next.state !== 'running') status.textContent = 'Terminal nie jest aktywny. Możesz przeczytać dotychczasowe odpowiedzi.';
    syncControls();
  }
  function toggle(value = !opened) {
    if (!live) return;
    opened = value; panel.hidden = !value;
    onToggle(value);
    if (value && !loaded) load();
    else if (value) syncControls();
  }
  return { panel, toggle, updateTerminal, dispose() {
    live = false; stream?.abort(); clearTimeout(refreshTimer); panel.remove();
  } };
}
