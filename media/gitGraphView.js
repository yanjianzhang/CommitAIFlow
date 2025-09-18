/* CommitAIFlow webview script (external) */
(function(){
  const vscode = acquireVsCodeApi();
  const DIFF_CHAR_LIMIT = parseInt(document.body.dataset.diffLimit || '100000', 10);

  const $ = id => document.getElementById(id);
  const generateBtn = $('generateBtn');
  const generateFromDiffBtn = $('generateFromDiffBtn');
  const loadDiffBtn = $('loadDiffBtn');
  const sampleDiffBtn = $('sampleDiffBtn');
  const copyBtn = $('copyBtn');
  const statusEl = $('status');
  const resultEl = $('result');
  const metaEl = $('meta');
  const rawWrapper = $('rawWrapper');
  const rawOutput = $('rawOutput');
  const progressSpinner = $('progressSpinner');
  const diffInput = $('diffInput');
  const diffMeta = $('diffMeta');
  const diffPreview = $('diffPreview');
  const toggleLineNumbers = $('toggleLineNumbers');
  const toggleCollapse = $('toggleCollapse');
  const debugOutput = $('debugOutput');

  function dbg(msg){
    const t = new Date().toISOString();
    const line = '[webview ' + t + '] ' + msg;
    try { console.log(line); } catch {}
    if (debugOutput) {
      debugOutput.textContent += (debugOutput.textContent ? '\n' : '') + line;
      debugOutput.scrollTop = debugOutput.scrollHeight;
    }
  }
  dbg('Webview script loaded (external)');

  if (!progressSpinner) throw new Error('Progress spinner element missing.');

  function setStatus(text, kind) {
    statusEl.textContent = text || '';
    statusEl.className = 'status' + (kind ? ' status--' + kind : '');
  }
  function showSpinner(visible) {
    if (visible) { progressSpinner.classList.add('is-visible'); progressSpinner.setAttribute('aria-hidden','false'); }
    else { progressSpinner.classList.remove('is-visible'); progressSpinner.setAttribute('aria-hidden','true'); }
  }
  function setGenerateButtonsDisabled(disabled){
    generateBtn.disabled = disabled;
    if (generateFromDiffBtn) generateFromDiffBtn.disabled = disabled;
  }
  function resetOutputs(){
    resultEl.value = '';
    metaEl.textContent = '';
    rawOutput.textContent = '';
    rawWrapper.open = false;
    rawWrapper.style.display = 'none';
    copyBtn.disabled = true;
  }
  function beginGeneration(statusText){
    resetOutputs();
    setStatus(statusText, 'busy');
    setGenerateButtonsDisabled(true);
    showSpinner(true);
  }
  function finishGeneration(){
    setGenerateButtonsDisabled(false);
    showSpinner(false);
  }

  const SAMPLE_DIFF_LINES = [
    'diff --git a/src/example.ts b/src/example.ts',
    'index a1b2c3d..e4f5a6b 100644',
    '--- a/src/example.ts',
    '+++ b/src/example.ts',
    '@@ -1,6 +1,10 @@',
    "-import { compute } from './math';",
    "-",
    "-export function add(a: number, b: number) {",
    "-  return compute(a + b);",
    "-}",
    "+export function add(a: number, b: number) {",
    '+  const result = a + b;',
    '+  return result;',
    '+}',
    '+',
    '+export function multiply(a: number, b: number) {',
    '+  return a * b;',
    '+}'
  ];
  const SAMPLE_DIFF = SAMPLE_DIFF_LINES.join('\n');

  function buildDiffMeta(payload){
    const lines = [];
    const ctxSource = payload && (payload.context !== undefined ? payload.context : payload.source);
    if (ctxSource === 'staged') lines.push('Source: staged changes');
    else if (ctxSource === 'custom') lines.push('Source: custom diff');
    else if (typeof ctxSource === 'string' && ctxSource.trim()) lines.push('Source: ' + ctxSource);
    const truncatedValue = payload ? (payload.truncated !== undefined ? payload.truncated : payload.truncatedDiff) : undefined;
    const truncated = Boolean(truncatedValue);
    if (truncated) lines.push('Note: Diff truncated to ' + DIFF_CHAR_LIMIT + ' characters before sending to the model.');
    if (payload && payload.note) lines.push(payload.note);
    return lines.join('\n');
  }
  function updateDiffArea(payload){
    if (payload && typeof payload.diff === 'string') { diffInput.value = payload.diff; diffInput.scrollTop = 0; }
    diffMeta.textContent = buildDiffMeta(payload);
    renderDiff();
  }
  function handleDiffResponse(payload){
    updateDiffArea(payload);
    const diffText = payload && typeof payload.diff === 'string' ? payload.diff : diffInput.value;
    const hasDiff = diffText.trim().length > 0;
    const statusText = payload && typeof payload.status === 'string' ? payload.status : (hasDiff ? 'Diff loaded.' : 'No diff returned.');
    const statusKind = payload && payload.kind ? payload.kind : (hasDiff ? 'ok' : 'error');
    setStatus(statusText, statusKind);
  }

  let renderTimer;
  diffInput.addEventListener('input', () => { clearTimeout(renderTimer); renderTimer = setTimeout(renderDiff, 150); });
  if (toggleLineNumbers) toggleLineNumbers.addEventListener('change', renderDiff);
  if (toggleCollapse) toggleCollapse.addEventListener('change', renderDiff);

  function renderDiff(){
    if (!diffPreview) return;
    const text = (diffInput.value || '').replace(/\r\n/g, '\n');
    const showNums = toggleLineNumbers && toggleLineNumbers.checked;
    const collapse = !toggleCollapse || toggleCollapse.checked;
    dbg('Render diff: length=' + text.length + ', showNums=' + showNums + ', collapse=' + collapse);
    diffPreview.innerHTML = '';
    diffPreview.classList.toggle('no-linenos', !showNums);
    let hunks = [];
    try { hunks = parseUnifiedDiff(text); } catch(e) { dbg('parseUnifiedDiff error: ' + (e && e.message ? e.message : String(e))); }
    dbg('Parsed hunks=' + hunks.length);
    const COLLAPSE_THRESHOLD = 20;
    for (const h of hunks) {
      for (const metaLine of h.meta) addRow({ kind: 'meta', oldNo: '', newNo: '', text: metaLine });
      const ctxRuns = []; let run = []; const flushRun = () => { if (run.length) { ctxRuns.push(run); run = []; } };
      for (const ln of h.lines) { if (ln.kind === 'ctx') run.push(ln); else { flushRun(); addRow(ln); } }
      flushRun();
      for (const group of ctxRuns) {
        if (collapse && group.length > COLLAPSE_THRESHOLD) {
          const head = group.slice(0,3); const tail = group.slice(-3);
          for (const ln of head) addRow(ln);
          const hidden = group.slice(3,-3);
          addCollapsed(hidden.length, hidden);
          for (const ln of tail) addRow(ln);
        } else { for (const ln of group) addRow(ln); }
      }
    }
  }
  function addCollapsed(count, hiddenLines){
    const row = document.createElement('div'); row.className = 'diff-row collapsed';
    const lnOld = document.createElement('div'); lnOld.className = 'ln old'; lnOld.textContent = '';
    const lnNew = document.createElement('div'); lnNew.className = 'ln new'; lnNew.textContent = '';
    const code = document.createElement('div'); code.className = 'code context';
    const btn = document.createElement('button'); btn.textContent = 'Expand ' + count + ' lines'; btn.className = 'expand-btn';
    btn.addEventListener('click', () => { row.replaceWith(...hiddenLines.map(h => createRow(h))); });
    code.appendChild(btn);
    row.appendChild(lnOld); row.appendChild(lnNew); row.appendChild(code);
    diffPreview.appendChild(row);
  }
  function addRow(ln){ diffPreview.appendChild(createRow(ln)); }
  function createRow(ln){
    const row = document.createElement('div');
    row.className = 'diff-row ' + (ln.kind === 'add' ? 'added' : ln.kind === 'del' ? 'removed' : ln.kind === 'meta' ? 'meta' : 'context');
    const lnOld = document.createElement('div'); lnOld.className = 'ln old'; lnOld.textContent = ln.oldNo === undefined ? '' : String(ln.oldNo || '');
    const lnNew = document.createElement('div'); lnNew.className = 'ln new'; lnNew.textContent = ln.newNo === undefined ? '' : String(ln.newNo || '');
    const code = document.createElement('div'); code.className = 'code'; code.textContent = ln.text;
    row.appendChild(lnOld); row.appendChild(lnNew); row.appendChild(code);
    return row;
  }
  function parseUnifiedDiff(text){
    const lines = text.split('\n'); const hunks = []; let i = 0; let cur = null; let oldNo = 0, newNo = 0;
    while (i < lines.length) {
      const line = lines[i++];
      if (line.startsWith('@@')) {
        const m = /@@ -([0-9]+)(?:,[0-9]+)? \+([0-9]+)(?:,[0-9]+)? @@/.exec(line);
        if (m) { oldNo = parseInt(m[1],10); newNo = parseInt(m[2],10); }
        if (!cur) { cur = { meta: [], lines: [] }; hunks.push(cur); }
        cur.meta.push(line); continue;
      }
      if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ ')) {
        if (!cur) { cur = { meta: [], lines: [] }; hunks.push(cur); }
        cur.meta.push(line); continue;
      }
      if (!cur) { cur = { meta: [], lines: [] }; hunks.push(cur); }
      if (line.startsWith('+')) cur.lines.push({ kind: 'add', oldNo: '', newNo: newNo++, text: line });
      else if (line.startsWith('-')) cur.lines.push({ kind: 'del', oldNo: oldNo++, newNo: '', text: line });
      else if (line.startsWith(' ') || line === '') cur.lines.push({ kind: 'ctx', oldNo: oldNo++, newNo: newNo++, text: line || ' ' });
      else if (line.startsWith('\\')) cur.lines.push({ kind: 'meta', oldNo: '', newNo: '', text: line });
      else cur.lines.push({ kind: 'ctx', oldNo: '', newNo: '', text: line });
    }
    return hunks;
  }

  // Events
  generateBtn.addEventListener('click', () => { dbg('Clicked: generate-commit-message'); beginGeneration('Generating commit message from staged changes...'); vscode.postMessage({ type: 'generate-commit-message' }); });
  if (generateFromDiffBtn) generateFromDiffBtn.addEventListener('click', () => {
    const diffText = diffInput.value || ''; if (!diffText.trim()) { setStatus('Enter or load a diff before generating.', 'error'); return; }
    dbg('Clicked: generate-commit-message-from-diff, length=' + diffText.length);
    beginGeneration('Generating commit message from diff...'); vscode.postMessage({ type: 'generate-commit-message-from-diff', diff: diffText });
  });
  if (loadDiffBtn) loadDiffBtn.addEventListener('click', () => { dbg('Clicked: load-staged-diff'); setStatus('Loading staged diff...', 'busy'); vscode.postMessage({ type: 'load-staged-diff' }); });
  if (sampleDiffBtn) sampleDiffBtn.addEventListener('click', () => { updateDiffArea({ diff: SAMPLE_DIFF, context: 'custom', note: 'Sample diff inserted. Edit before generating.' }); setStatus('Sample diff inserted. Edit before generating.', 'ok'); dbg('Inserted sample diff, length=' + SAMPLE_DIFF.length); });
  copyBtn.addEventListener('click', async () => { if (!resultEl.value) return; try { await navigator.clipboard.writeText(resultEl.value); setStatus('Copied to clipboard', 'ok'); } catch(e){ console.error(e); setStatus('Copy failed','error'); } });

  window.addEventListener('message', event => {
    const message = event.data; if (!message || typeof message.type !== 'string') return; dbg('Received message from host: ' + message.type);
    if (message.type === 'commitMessage') {
      const payload = message.payload; if (!payload || typeof payload !== 'object') { finishGeneration(); setStatus('Malformed response from extension.', 'error'); copyBtn.disabled = true; return; }
      const messageText = typeof payload.message === 'string' ? payload.message : '';
      const rawText = typeof payload.raw === 'string' ? payload.raw : '';
      const source = typeof payload.source === 'string' ? payload.source : 'unknown';
      const model = typeof payload.model === 'string' ? payload.model : 'unknown';
      const truncated = Boolean(payload.truncatedDiff);
      resultEl.value = messageText; rawOutput.textContent = rawText; rawWrapper.style.display = rawText ? 'block' : 'none'; rawWrapper.open = false; copyBtn.disabled = !messageText;
      if (typeof payload.diff === 'string') { updateDiffArea({ diff: payload.diff, truncated: payload.truncatedDiff, context: payload.context }); }
      else if (payload.context) { updateDiffArea({ context: payload.context, truncated: payload.truncatedDiff }); }
      const metaLines = []; if (source === 'fallback') metaLines.push('Fallback message used (model output was empty).'); else metaLines.push('Generated with model: ' + model);
      if (truncated) metaLines.push('Warning: Diff truncated to ' + DIFF_CHAR_LIMIT + ' characters before sending to the model.');
      metaEl.textContent = metaLines.join('\n'); if (rawText) rawWrapper.open = source === 'fallback';
      setStatus('Generated with ' + model, source === 'fallback' ? 'busy' : 'ok'); finishGeneration(); return;
    }
    if (message.type === 'diff') { handleDiffResponse(message.payload || {}); return; }
    if (message.type === 'error') { setStatus(message.error || 'Unexpected error', 'error'); finishGeneration(); copyBtn.disabled = true; metaEl.textContent = ''; rawWrapper.style.display = 'none'; rawOutput.textContent = ''; return; }
  });

  // initial UI
  rawWrapper.style.display = 'none';
  showSpinner(false);
  if (diffMeta) diffMeta.textContent = 'Load staged changes or insert a sample diff to get started.';
})();

