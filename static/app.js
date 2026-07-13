// ── Config ───────────────────────────────────────────────────────────────────
const API_BASE = window.location.protocol === 'file:' ? 'http://localhost:8000' : '';

// ── State ─────────────────────────────────────────────────────────────────────
const headlineMap = {};
const expandedCards = new Set();
const expandedNotes = new Set();

let knowledgeDomain = null;
let knowledgeLoaded = false;
let kSearchTimer = null;

const reading = {
  headline: null,
  deepRead: null,
  maxPass: -1,
  displayPass: 0,
  saved: false,
};

const PASSES = [
  { key: 'facts',       label: 'Facts',       sub: 'what happened' },
  { key: 'context',     label: 'Context',     sub: 'why it matters' },
  { key: 'implications',label: 'Implications',sub: 'what to watch' },
];

// ── Screen Navigation ─────────────────────────────────────────────────────────
function showScreen(name) {
  ['brief', 'knowledge', 'review'].forEach(s => {
    document.getElementById(`screen-${s}`).hidden = s !== name;
    document.querySelector(`[data-screen="${s}"]`).classList.toggle('active', s === name);
  });
  if (name === 'knowledge' && !knowledgeLoaded) {
    knowledgeLoaded = true;
    loadKnowledge();
  }
}

// ── Morning Brief ─────────────────────────────────────────────────────────────
async function loadTriage(force = false) {
  const btn = document.getElementById('refreshBtn');
  btn.disabled = true;
  btn.textContent = 'Loading…';
  document.getElementById('briefContent').innerHTML = skeletonHTML();
  document.getElementById('dateDisplay').textContent = '—';
  document.getElementById('statsDisplay').textContent = '';

  try {
    const res = await fetch(`${API_BASE}/api/triage${force ? '?refresh=1' : ''}`);
    if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Server error'); }
    renderBrief(await res.json());
  } catch (e) {
    document.getElementById('briefContent').innerHTML = errorHTML(e.message, `Make sure the backend is running on ${API_BASE || 'this server'}`);
    document.getElementById('dateDisplay').textContent = 'Could not load brief';
  } finally {
    btn.disabled = false;
    btn.textContent = '↻ Refresh';
  }
}

function renderBrief(data) {
  document.getElementById('dateDisplay').textContent = data.date;
  document.getElementById('statsDisplay').innerHTML =
    `<span class="stat-chip chip-total">${data.total} headlines</span>` +
    `<span class="stat-chip chip-signal">${data.signal.length} Signal</span>` +
    `<span class="stat-chip chip-noise">${data.noise.length} Noise</span>` +
    `<span class="stat-chip chip-archive">${data.archive.length} Archive</span>` +
    (data.fetched_at ? `<span class="stat-chip chip-total" title="Hit ↻ Refresh to fetch fresh headlines">${data.cached ? '⚡ ' : ''}Updated ${data.fetched_at}</span>` : '');

  document.getElementById('briefContent').innerHTML =
    renderSection('Signal',  data.signal,  'signal') +
    renderSection('Archive', data.archive, 'archive') +
    renderSection('Noise',   data.noise,   'noise');
}

function renderSection(label, items, type) {
  const isNoise = type === 'noise';
  const cards = items.length
    ? items.map((h, i) => renderCard(h, type, `${type}-${i}`, i)).join('')
    : `<div class="empty">None today</div>`;

  return `
    <div class="section">
      <div class="section-header">
        <span class="section-label ${type}-label">${label}</span>
        <span class="section-count">${items.length}</span>
      </div>
      ${isNoise && items.length > 0
        ? `<button class="toggle-noise" onclick="toggleNoise(this)">▼ Show noise headlines</button>
           <div class="noise-list" style="display:none">${cards}</div>`
        : cards
      }
    </div>`;
}

function renderCard(h, type, id, i = 0) {
  headlineMap[id] = h;
  const isSignal = type === 'signal';
  const onclick = isSignal ? `openReadingMode('${id}')` : `toggleCard('${id}')`;
  const delay = Math.min(i * 0.04, 0.3);
  const label = type.charAt(0).toUpperCase() + type.slice(1);
  return `
    <div class="card ${type}-card" id="card-${id}" style="animation-delay:${delay}s" onclick="${onclick}">
      <div class="card-main">
        <div class="card-meta">
          <span class="badge badge-${type}">${label}</span>
          <span class="card-section-tag">${h.section}</span>
        </div>
        <div class="card-title">${escHtml(h.title)}</div>
        <div class="card-reason">${escHtml(h.reason)}</div>
      </div>
      <div id="expanded-${id}"></div>
    </div>`;
}

function renderExpanded(h) {
  const domains = (h.domains || []).map(d => `<span class="domain-tag">${escHtml(d)}</span>`).join('');
  return `
    <div class="card-expanded">
      ${h.summary ? `<div class="card-summary">${escHtml(h.summary)}</div>` : ''}
      ${domains ? `<div class="domains">${domains}</div>` : ''}
      <a class="read-btn" href="${h.link}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Read full article →</a>
      <button class="copy-url-btn" onclick="event.stopPropagation(); copyUrl(this, '${h.link}')" title="Copy URL">⎘ Copy URL</button>
    </div>`;
}

function toggleCard(id) {
  const el = document.getElementById(`expanded-${id}`);
  if (expandedCards.has(id)) {
    expandedCards.delete(id);
    el.innerHTML = '';
  } else {
    expandedCards.add(id);
    el.innerHTML = renderExpanded(headlineMap[id]);
  }
}

function toggleNoise(btn) {
  const list = btn.nextElementSibling;
  const hidden = list.style.display === 'none';
  list.style.display = hidden ? 'block' : 'none';
  btn.textContent = hidden ? '▲ Hide noise headlines' : '▼ Show noise headlines';
}

async function copyUrl(btn, url) {
  await navigator.clipboard.writeText(url);
  btn.textContent = '✓ Copied';
  btn.classList.add('copied');
  setTimeout(() => { btn.textContent = '⎘ Copy URL'; btn.classList.remove('copied'); }, 1500);
}

// ── Reading Mode ──────────────────────────────────────────────────────────────
function openReadingMode(cardId) {
  const h = headlineMap[cardId];
  reading.headline = h;
  reading.deepRead = null;
  reading.maxPass = -1;
  reading.displayPass = 0;
  reading.saved = false;

  document.getElementById('readingTitle').textContent = h.title;
  document.getElementById('readingLoading').hidden = false;
  document.getElementById('readingContent').hidden = true;
  document.getElementById('inferenceSection').hidden = true;
  document.getElementById('saveStatus').textContent = '';
  document.getElementById('inferenceInput').value = '';
  document.getElementById('saveNoteBtn').disabled = false;
  document.getElementById('screen-reading').hidden = false;
  document.body.style.overflow = 'hidden';

  // Lock all tabs
  PASSES.forEach((_, i) => {
    const t = document.getElementById(`tab-${i}`);
    t.disabled = true;
    t.classList.remove('active');
  });

  fetch(`${API_BASE}/api/read`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: h.link }),
  })
    .then(r => {
      if (!r.ok) return r.json().then(e => { throw new Error(e.detail || 'Server error'); });
      return r.json();
    })
    .then(data => {
      reading.deepRead = data;
      document.getElementById('readingTitle').textContent = data.title;
      document.getElementById('readingLoading').hidden = true;
      document.getElementById('readingContent').hidden = false;
      unlockAndShow(0);
    })
    .catch(e => {
      document.getElementById('readingLoading').innerHTML = `
        <div style="color:#f87171;text-align:center;padding:20px">
          <div style="font-size:24px;margin-bottom:12px">⚠</div>
          <div>${escHtml(e.message)}</div>
          <button onclick="closeReadingMode()" class="back-btn" style="margin-top:16px;color:var(--accent)">← Go Back</button>
        </div>`;
    });
}

function unlockAndShow(idx) {
  reading.maxPass = Math.max(reading.maxPass, idx);
  reading.displayPass = idx;

  // Update tab states
  PASSES.forEach((p, i) => {
    const t = document.getElementById(`tab-${i}`);
    t.disabled = i > reading.maxPass;
    t.classList.toggle('active', i === idx);
  });

  // Render content
  document.getElementById('tabContent').innerHTML = renderPassContent(idx);

  // Footer logic
  const nextBtn = document.getElementById('nextPassBtn');
  const inferSec = document.getElementById('inferenceSection');

  if (idx < 2) {
    // Show Next Pass button; hide inference
    document.querySelector('.reading-footer').hidden = false;
    nextBtn.textContent = `Next Pass: ${PASSES[idx + 1].label} →`;
    inferSec.hidden = true;
  } else {
    // Last pass — hide Next Pass, show inference
    document.querySelector('.reading-footer').hidden = true;
    inferSec.hidden = false;
  }
}

function renderPassContent(idx) {
  const pass = PASSES[idx];
  const items = reading.deepRead[pass.key] || [];
  return `
    <div class="pass-header-info">
      <span class="pass-step">${idx + 1}</span>
      <div>
        <div class="pass-name">${pass.label}</div>
        <div class="pass-sub">${pass.sub}</div>
      </div>
    </div>
    <ul class="pass-list">
      ${items.map(item => `<li>${escHtml(item)}</li>`).join('')}
    </ul>`;
}

function nextPass() {
  if (reading.displayPass < 2) unlockAndShow(reading.displayPass + 1);
}

function switchTab(idx) {
  if (idx > reading.maxPass) return;
  reading.displayPass = idx;

  PASSES.forEach((_, i) => {
    const t = document.getElementById(`tab-${i}`);
    t.classList.toggle('active', i === idx);
  });

  document.getElementById('tabContent').innerHTML = renderPassContent(idx);

  // Show/hide footer based on whether this is the last pass
  document.querySelector('.reading-footer').hidden = reading.maxPass >= 2;
  document.getElementById('inferenceSection').hidden = idx !== 2 || reading.maxPass < 2;
}

function closeReadingMode() {
  document.getElementById('screen-reading').hidden = true;
  document.body.style.overflow = '';
}

async function saveToKnowledgeBase() {
  const inference = document.getElementById('inferenceInput').value.trim();
  if (!inference) {
    document.getElementById('inferenceInput').focus();
    return;
  }

  const btn = document.getElementById('saveNoteBtn');
  const status = document.getElementById('saveStatus');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  status.textContent = '';
  status.className = 'save-status';

  try {
    const res = await fetch(`${API_BASE}/api/knowledge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title:        reading.deepRead.title,
        url:          reading.deepRead.url,
        facts:        reading.deepRead.facts,
        context:      reading.deepRead.context,
        implications: reading.deepRead.implications,
        inference,
        domains:      reading.headline.domains || [],
      }),
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Server error'); }
    reading.saved = true;
    status.textContent = '✓ Saved to Knowledge Base';
    btn.textContent = '✓ Saved';
    // Reset knowledge screen so it reloads on next visit
    knowledgeLoaded = false;
  } catch (e) {
    status.textContent = `⚠ ${e.message}`;
    status.className = 'save-status error';
    btn.disabled = false;
    btn.textContent = 'Save to Knowledge Base';
  }
}

// ── Knowledge Base ────────────────────────────────────────────────────────────
function debounceKSearch(val) {
  clearTimeout(kSearchTimer);
  kSearchTimer = setTimeout(() => loadKnowledge(val, knowledgeDomain), 300);
}

async function filterDomain(domain) {
  knowledgeDomain = domain === 'All' ? null : domain;
  const search = document.getElementById('knowledgeSearch').value.trim();
  await loadKnowledge(search, knowledgeDomain);
}

async function loadKnowledge(query = '', domain = null) {
  const params = new URLSearchParams();
  if (query)  params.set('query', query);
  if (domain) params.set('domain', domain);

  document.getElementById('knowledgeContent').innerHTML =
    loadingHTML('Loading notes…');

  try {
    const res = await fetch(`${API_BASE}/api/knowledge?${params}`);
    if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Server error'); }
    const data = await res.json();
    renderKnowledge(data.notes, data.domains, domain);
  } catch (e) {
    document.getElementById('knowledgeContent').innerHTML = errorHTML(e.message);
  }
}

function renderKnowledge(notes, domains, activeDomain) {
  const chips = ['All', ...domains].map(d => {
    const isActive = d === 'All' ? !activeDomain : d === activeDomain;
    return `<button class="domain-chip ${isActive ? 'active' : ''}" onclick="filterDomain('${escHtml(d)}')">${escHtml(d)}</button>`;
  }).join('');

  const noteCards = notes.length
    ? notes.map(n => renderNoteCard(n)).join('')
    : `<div class="empty-knowledge">
         <div class="empty-icon">🧠</div>
         <div class="empty-msg">No notes yet.<br>Complete a reading session and save your inference to build your knowledge base.</div>
       </div>`;

  document.getElementById('knowledgeContent').innerHTML = `
    <div class="content">
      ${domains.length ? `<div class="domain-chips">${chips}</div>` : ''}
      ${noteCards}
    </div>`;
}

function renderNoteCard(n) {
  noteCache[n.id] = n;
  const id = `note-${n.id}`;
  const isExpanded = expandedNotes.has(id);
  const tags = (n.domains || []).map(d => `<span class="domain-tag">${escHtml(d)}</span>`).join('');
  return `
    <div class="note-card" id="${id}" onclick="toggleNote('${id}', ${JSON.stringify(n.id)})">
      <div class="note-card-main">
        <div class="note-title">${escHtml(n.title)}</div>
        <div class="note-meta">${n.date}${n.domains.length ? ' · ' + n.domains.join(', ') : ''}</div>
        <div class="note-inference">"${escHtml(n.inference)}"</div>
      </div>
      <div id="note-exp-${n.id}">${isExpanded ? renderNoteExpanded(n) : ''}</div>
    </div>`;
}

function renderNoteExpanded(n) {
  const list = items => items.map(i => `<li>${escHtml(i)}</li>`).join('');
  return `
    <div class="note-card-expanded">
      <div class="note-pass-title">Facts</div>
      <ul class="note-pass-list">${list(n.facts)}</ul>
      <div class="note-pass-title">Context</div>
      <ul class="note-pass-list">${list(n.context)}</ul>
      <div class="note-pass-title">Implications</div>
      <ul class="note-pass-list">${list(n.implications)}</ul>
      <a class="note-read-link" href="${n.url}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Read original article →</a>
    </div>`;
}

function toggleNote(cardId, noteId) {
  const el = document.getElementById(`note-exp-${noteId}`);
  // Find the note data from the DOM (re-fetch or store separately)
  // We'll use a data attribute approach
  const card = document.getElementById(cardId);
  const noteData = noteCache[noteId];
  if (!noteData) return;

  if (expandedNotes.has(cardId)) {
    expandedNotes.delete(cardId);
    el.innerHTML = '';
  } else {
    expandedNotes.add(cardId);
    el.innerHTML = renderNoteExpanded(noteData);
  }
}

// Cache for note data (needed for expand/collapse without re-fetch)
const noteCache = {};

// ── Weekly Review ─────────────────────────────────────────────────────────────
async function generateReview() {
  const content = document.getElementById('reviewContent');
  content.innerHTML = loadingHTML('Generating your weekly review…', 'Analysing themes, patterns, and gaps');

  try {
    const res = await fetch(`${API_BASE}/api/review`);
    if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Server error'); }
    const data = await res.json();

    if (data.message) {
      content.innerHTML = `<div class="review-empty"><div style="font-size:40px;margin-bottom:16px">📚</div>${escHtml(data.message)}</div>`;
      return;
    }
    renderReview(data);
  } catch (e) {
    content.innerHTML = errorHTML(e.message);
  }
}

function renderReview(data) {
  const themes = data.themes.map(t => `
    <div class="theme-card">
      <div class="theme-name">${escHtml(t.theme)}</div>
      <div class="theme-desc">${escHtml(t.description)}</div>
      <div class="theme-stories">${(t.stories || []).map(s => `<span class="theme-story">${escHtml(s)}</span>`).join('')}</div>
    </div>`).join('');

  const patterns = data.patterns.map(p => `
    <div class="pattern-item">
      <div class="item-title">${escHtml(p.pattern)}</div>
      <div class="item-desc">${escHtml(p.evidence)}</div>
    </div>`).join('');

  const gaps = data.gaps.map(g => {
    const searchQuery = (g.search || '').replace('Wikipedia: ', '').replace('search: ', '');
    const searchUrl = g.search && g.search.startsWith('Wikipedia:')
      ? `https://en.wikipedia.org/wiki/${encodeURIComponent(searchQuery)}`
      : `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`;
    return `
      <div class="gap-item">
        <div class="item-title">${escHtml(g.topic)}</div>
        <div class="item-desc">${escHtml(g.description)}</div>
        ${g.search ? `<a class="gap-search" href="${searchUrl}" target="_blank" rel="noopener" onclick="event.stopPropagation()">→ ${escHtml(g.search)}</a>` : ''}
      </div>`;
  }).join('');

  const revisits = data.revisits.map(r => `
    <div class="revisit-item">
      <div class="item-title">${escHtml(r.title)}</div>
      <div class="item-desc">${escHtml(r.reason)}</div>
    </div>`).join('');

  document.getElementById('reviewContent').innerHTML = `
    <div class="content">
      <div class="review-sections">
        ${reviewSection('🔄', 'Recurring Themes', themes)}
        ${reviewSection('📈', 'Emerging Patterns', patterns)}
        ${reviewSection('🕳', 'Knowledge Gaps', gaps)}
        ${reviewSection('📚', 'Suggested Revisits', revisits)}
      </div>
      <div style="text-align:center;margin-top:24px">
        <button class="generate-btn" onclick="generateReview()">↻ Regenerate</button>
      </div>
    </div>`;
}

function reviewSection(icon, title, body) {
  return `
    <div class="review-section">
      <div class="review-section-header">
        <span class="review-section-icon">${icon}</span>
        <span class="review-section-title">${title}</span>
      </div>
      <div class="review-section-body">${body || '<div class="empty">Nothing to show</div>'}</div>
    </div>`;
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function skeletonHTML(count = 5) {
  const card = `
    <div class="skeleton-card">
      <div class="sk-line sk-badge"></div>
      <div class="sk-line sk-title"></div>
      <div class="sk-line sk-title-2"></div>
      <div class="sk-line sk-text"></div>
    </div>`;
  return `
    <div class="section">
      <div class="section-header"><span class="sk-line sk-badge" style="margin:0;width:70px"></span></div>
      ${card.repeat(count)}
    </div>`;
}

function loadingHTML(label, sub) {
  return `<div class="loading">
    <div class="spinner"></div>
    <div class="loading-label">${escHtml(label)}</div>
    ${sub ? `<div class="loading-sub">${escHtml(sub)}</div>` : ''}
  </div>`;
}

function errorHTML(msg, sub) {
  return `<div class="error-block">
    <div class="error-icon">⚠</div>
    <div class="error-msg">${escHtml(msg)}</div>
    ${sub ? `<div class="error-sub">${escHtml(sub)}</div>` : ''}
  </div>`;
}

// ── Boot ──────────────────────────────────────────────────────────────────────
loadTriage();
