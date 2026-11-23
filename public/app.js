const $ = (selector) => document.querySelector(selector);
const state = {
  userId: localStorage.getItem('autumn.userId') || 'traveler',
  authorKey: sessionStorage.getItem('autumn.authorKey') || '',
  history: [], pinned: new Set(), favorites: new Set()
};

$('#userId').value = state.userId;
$('#authorKey').value = state.authorKey;

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `${response.status} ${response.statusText}`);
  return body;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
}

function currentIdentity() {
  state.userId = $('#userId').value.trim() || 'traveler';
  state.authorKey = $('#authorKey').value;
  localStorage.setItem('autumn.userId', state.userId);
  sessionStorage.setItem('autumn.authorKey', state.authorKey);
  return { userId: state.userId, authorKey: state.authorKey };
}

function appendMessage(role, content, sources = []) {
  const article = document.createElement('article');
  article.className = `message ${role}`;
  const sourceText = sources.length
    ? `<div class="sources">Looked up: ${sources.slice(0, 4).map((source) => `${escapeHtml(source.path)} · ${escapeHtml(source.section)}`).join(' · ')}</div>`
    : '';
  article.innerHTML = `<strong>${role === 'autumn' ? 'Autumn' : escapeHtml(state.userId)}</strong><p>${escapeHtml(content)}</p>${sourceText}`;
  $('#messages').append(article);
  $('#messages').scrollTop = $('#messages').scrollHeight;
}

function resultCard(item) {
  const pinned = state.pinned.has(item.id);
  const favorite = state.favorites.has(item.id);
  return `<article class="result-card" data-item="${escapeHtml(item.id)}">
    <header><div><strong>${escapeHtml(item.section)}</strong><small>${escapeHtml(item.path)} · ${escapeHtml(item.sourceTier || '')}</small></div>
    <div class="flag-buttons"><button class="${pinned ? 'on' : ''}" data-flag="pinned" title="Pin">📌</button><button class="${favorite ? 'on' : ''}" data-flag="favorites" title="Favorite">★</button></div></header>
    <p>${escapeHtml(String(item.text || '').slice(0, 520))}${String(item.text || '').length > 520 ? '…' : ''}</p>
  </article>`;
}

function renderResults(target, items, emptyText) {
  const element = $(target);
  if (!items.length) {
    element.className = 'results empty';
    element.textContent = emptyText;
    return;
  }
  element.className = 'results';
  element.innerHTML = items.map(resultCard).join('');
}

async function loadSaved() {
  const identity = currentIdentity();
  const saved = await api(`/api/flags?userId=${encodeURIComponent(identity.userId)}`);
  state.pinned = new Set(saved.pinned.map((item) => item.id));
  state.favorites = new Set(saved.favorites.map((item) => item.id));
  renderResults('#pinnedResults', saved.pinned, 'Nothing pinned yet.');
  renderResults('#favoriteResults', saved.favorites, 'No favorites yet.');
}

document.addEventListener('click', async (event) => {
  const flagButton = event.target.closest('[data-flag]');
  if (flagButton) {
    const itemId = flagButton.closest('[data-item]').dataset.item;
    flagButton.disabled = true;
    try {
      await api('/api/flags', { method: 'POST', body: JSON.stringify({ ...currentIdentity(), itemId, flag: flagButton.dataset.flag }) });
      await loadSaved();
      if ($('#searchInput').value.trim()) $('#searchForm').requestSubmit();
    } catch (error) {
      alert(error.message);
    } finally { flagButton.disabled = false; }
    return;
  }
  const prompt = event.target.closest('[data-prompt]');
  if (prompt) {
    $('#chatInput').value = prompt.dataset.prompt;
    $('#chatForm').requestSubmit();
  }
});

document.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('[data-tab]').forEach((item) => item.classList.toggle('active', item === button));
  document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.toggle('active', panel.id === `tab-${button.dataset.tab}`));
  if (button.dataset.tab === 'saved') loadSaved().catch((error) => alert(error.message));
}));

$('#searchForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  $('#searchResults').textContent = 'Searching the hidden inventory…';
  try {
    const { results } = await api('/api/search', { method: 'POST', body: JSON.stringify({ query: $('#searchInput').value, limit: 12 }) });
    renderResults('#searchResults', results, 'No indexed passage matched those words.');
  } catch (error) {
    renderResults('#searchResults', [], error.message);
  } finally { button.disabled = false; }
});

$('#chatForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = $('#chatInput');
  const message = input.value.trim();
  if (!message) return;
  currentIdentity();
  appendMessage('user', message);
  input.value = '';
  const button = event.submitter;
  button.disabled = true;
  button.textContent = 'Autumn is looking…';
  try {
    const response = await api('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ ...currentIdentity(), message, history: state.history })
    });
    if (!response.noReply && response.reply) {
      appendMessage('autumn', response.reply, response.sources || []);
      state.history.push({ role: 'user', content: message }, { role: 'assistant', content: response.reply });
      state.history = state.history.slice(-8);
    }
    if (Number.isFinite(response.remainingTokens)) $('#tokenStatus').textContent = `about ${response.remainingTokens} tokens before nap`;
  } catch (error) {
    appendMessage('autumn', `Oof—my lantern sputtered. ${error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = 'Send to Autumn';
  }
});

$('#ingestForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  $('#ingestResult').textContent = 'Checking credentials and updating the archive…';
  try {
    const body = {
      ...currentIdentity(), path: $('#ingestPath').value, mode: $('#ingestMode').value,
      section: $('#ingestSection').value, content: $('#ingestContent').value
    };
    const result = await api('/api/ingest', { method: 'POST', body: JSON.stringify(body) });
    $('#ingestResult').textContent = `Updated ${result.path}${result.section ? ` → ${result.section}` : ''}. Index now has ${result.inventoryEntries} passages.`;
  } catch (error) {
    $('#ingestResult').textContent = error.message;
  } finally { button.disabled = false; }
});

$('#reindexButton').addEventListener('click', async (event) => {
  event.target.disabled = true;
  try {
    const result = await api('/api/reindex', { method: 'POST', body: JSON.stringify(currentIdentity()) });
    $('#ingestResult').textContent = `Rebuilt: ${result.entryCount} passages from ${result.fileCount} files.`;
  } catch (error) { $('#ingestResult').textContent = error.message; }
  finally { event.target.disabled = false; }
});

$('#userId').addEventListener('change', () => loadSaved().catch(() => {}));
$('#authorKey').addEventListener('change', currentIdentity);

try {
  const status = await api('/api/status');
  $('#status').innerHTML = `<span class="dot"></span> ${status.inventory.entryCount} passages · ${escapeHtml(status.model)} · ${status.openAiConfigured ? 'voice crystal ready' : 'lookup-only mode'}`;
  await loadSaved();
} catch (error) {
  $('#status').textContent = `Archive unavailable: ${error.message}`;
}
