(() => {
'use strict';
const db = window.wikiStore;
const features = window.wikiFeatures;
const $ = selector => document.querySelector(selector);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const safeUrl = value => { if (!/^https?:\/\//i.test(String(value || '').trim())) return ''; try { const url = new URL(value); return ['http:','https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } };
const uuid = () => crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2);
const date = value => { const d = new Date(value); return Number.isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }).format(d); };
const dateTime = value => { const d = new Date(value); return Number.isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d); };
const rootNames = { knowledge: 'База знаний', cases: 'Сложные случаи', access: 'Удалённый доступ', home: 'Обзор', admin: 'Управление', search: 'Поиск', drafts: 'Черновики', trash: 'Корзина' };
const blockNames = { heading: 'Заголовок', text: 'Текст', code: 'Код', quote: 'Цитата / заметка', list: 'Список', image: 'Фото', link: 'Ссылка' };
let view = 'home', sectionId = null, selectedId = null, query = '', editingId = null, editorKind = 'knowledge';
let regionFilter = '';
let tagFilter = '', statusFilter = '', pinnedOnly = false, commentsRequest = 0, commentRows = [];
let draftBlocks = [], pendingFiles = new Map(), versions = null, adminTab = 'sections', readerPreview = false, toastTimer;
const activeAdmin = () => db.isAdmin() && !readerPreview;
const routePaths = {home:'',knowledge:'base',cases:'hard',access:'access',drafts:'drafts',trash:'trash',admin:'admin',search:'search'};
const basePath = new URL(document.baseURI).pathname.replace(/\/$/,'');
function readRoute() {
  const params = new URLSearchParams(location.search);
  const path = location.pathname.slice(basePath.length).split('/').filter(Boolean);
  view = (path.length ? Object.entries(routePaths).find(([,slug]) => slug === path[0])?.[0] : null) || (Object.hasOwn(rootNames, params.get('view')) ? params.get('view') : 'home');
  sectionId = (path[1] === 'category' ? path[2] : null) || params.get('section') || null;
  selectedId = (path[1] === 'record' ? path[2] : null) || params.get('entry') || null;
  query = params.get('q') || '';
  regionFilter = params.get('region') || '';
  tagFilter = params.get('tag') || ''; statusFilter = Object.hasOwn(features.relevance, params.get('status')) ? params.get('status') : ''; pinnedOnly = params.get('pinned') === '1';
  versions = null;
}
function syncRoute(replace = false) {
  const url = new URL(location.href);
  for (const key of ['view', 'section', 'entry', 'q', 'tag', 'status', 'pinned','region']) url.searchParams.delete(key);
  url.pathname = basePath + '/' + routePaths[view] + (selectedId ? '/record/' + encodeURIComponent(selectedId) : sectionId ? '/category/' + encodeURIComponent(sectionId) : '') + (view === 'home' ? '' : '/');
  if (selectedId && sectionId) url.searchParams.set('section', sectionId);
  if (query) url.searchParams.set('q', query);
  if (regionFilter && view === 'access') url.searchParams.set('region',regionFilter);
  if (tagFilter) url.searchParams.set('tag', tagFilter);
  if (statusFilter) url.searchParams.set('status', statusFilter);
  if (pinnedOnly) url.searchParams.set('pinned', '1');
  if (url.href !== location.href) history[replace ? 'replaceState' : 'pushState'](null, '', url);
}
readRoute();
window.addEventListener('popstate', () => { readRoute(); render(); });
function sshTarget(value) {
  const match = String(value || '').trim().match(/^(?:([a-zA-Z0-9_][a-zA-Z0-9_.-]*)@)?([a-zA-Z0-9][a-zA-Z0-9.-]*)(?::(\d{1,5}))?$/);
  if (!match || match[2].split('.').some(label => !label || label.startsWith('-') || label.endsWith('-'))) return null;
  const port = Number(match[3] || 22);
  if (port < 1 || port > 65535) return null;
  if (/^[\d.]+$/.test(match[2]) && (match[2].split('.').length !== 4 || match[2].split('.').some(x => Number(x) > 255))) return null;
  return { host: match[2], user: match[1] || '', port };
}
const remotePrograms = ['AnyDesk', 'RuDesktop', 'Терминал'];
function canonicalProgram(value) {
  const normalized = String(value || '').toLowerCase().replace(/[\s-]/g, '');
  return remotePrograms.find(p => p.toLowerCase() === normalized) || ({энидеск:'AnyDesk',анидеск:'AnyDesk',рудесктоп:'RuDesktop',putty:'Терминал',mobaxterm:'Терминал',terminal:'Терминал'})[normalized] || '';
}
function remoteLink(item) {
  const tool = String(item.tool || '').toLowerCase().replace(/[\s-]/g, '');
  const id = String(item.remote_id || '').replace(/\s/g, '');
  if (['anydesk', 'энидеск', 'анидеск'].includes(tool) && /^[a-zA-Z0-9][a-zA-Z0-9@._-]{0,127}$/.test(id)) return { href: 'anydesk:' + id, label: 'Подключиться через AnyDesk' };
  if (['rudesktop', 'рудесктоп'].includes(tool) && /^\d{1,20}$/.test(id)) return { href: 'wikihmru-rudesktop:' + id, label: 'Подключиться через RuDesktop', setup: true };
  if (['putty', 'mobaxterm', 'terminal', 'терминал'].includes(tool) && sshTarget(id)) return { href: 'wikihmru-terminal:' + encodeURIComponent(id), label: 'Открыть терминал', setup: true };
  return null;
}
function icon(name) {
  const paths = { search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>', knowledge:'<path d="M4 3h12l4 4v14H4zM16 3v5h4M8 12h8M8 16h6"/>', cases:'<path d="M12 3 2 21h20zM12 9v5M12 17h.01"/>', access:'<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>', home:'<path d="m3 10 9-7 9 7M5 9v12h5v-7h4v7h5V9"/>', drafts:'<path d="M4 3h12l4 4v14H4zM8 12h8M8 16h6"/>', trash:'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>', admin:'<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>', printer:'<path d="M6 8V3h12v5M6 17H3V8h18v9h-3M6 14h12v7H6zM17 11h1"/>', folder:'<path d="M3 5h7l2 3h9v13H3z"/>' };
  return `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.knowledge}</svg>`;
}
function programIcon(value) {
  const p = canonicalProgram(value);
  if (p === 'RuDesktop') return '<svg class="program-icon" viewBox="0 0 100 100" aria-hidden="true"><rect width="100" height="100" rx="26" fill="#d12d2f"/><circle cx="50" cy="50" r="26" fill="white"/><path d="M67 23 33 77" stroke="#d12d2f" stroke-width="9"/></svg>';
  if (p === 'AnyDesk') return '<svg class="program-icon" viewBox="0 0 100 70" aria-hidden="true"><path d="m30 5 30 30-30 30L0 35zM55 5l30 30-30 30h15l30-30L70 5z" fill="#ef3b35"/></svg>';
  return '<svg class="program-icon" viewBox="0 0 100 80" aria-hidden="true"><rect x="2" y="3" width="96" height="74" rx="5" fill="#262626"/><path d="M2 14h96" stroke="#9ca3af" stroke-width="8"/><path d="m17 31 13 10-13 10M37 53h18" stroke="white" stroke-width="5" fill="none"/></svg>';
}
function remoteActions(item) { return features.remoteConnections(item).map(connection => `<section class="remote-connection"><h3 class="program-badge">${programIcon(connection.tool)}${connection.tool} · <span class="connection-id">${escapeHtml(connection.remote_id)}</span></h3>${singleRemoteActions({...item,...connection})}</section>`).join(''); }
function singleRemoteActions(item) {
  const link = remoteLink(item), program = canonicalProgram(item.tool), setupProgram = program === 'Терминал' ? 'Terminal' : program;
  return `<div class="detail-actions">${link ? `<a class="button-primary" href="${escapeHtml(link.href)}" data-launch-remote>${link.label}</a>` : ''}<button class="button-quiet" data-copy-remote="${escapeHtml(item.id)}" data-copy-program="${escapeHtml(item.tool)}">Скопировать ID</button></div>${link ? `<details class="remote-setup"><summary>Приложение не открывается?</summary><p>${program === 'AnyDesk' ? 'Для запуска AnyDesk браузер должен знать, каким приложением открывать ссылку. Если используется portable-версия или кнопка ничего не делает, настройте запуск один раз.' : 'Настройте запуск один раз на этом Windows-компьютере. После этого кнопка передаст адрес / ID приложению.'}</p><ol><li>Скачайте настройку для ${escapeHtml(program)}.</li><li>Откройте PowerShell и выполните команду ниже. Если приложение не найдено, выберите его exe-файл.</li><li>Нажмите «Подключиться» и разрешите браузеру открыть приложение.</li></ol><button class="button-quiet" data-download-launcher="${escapeHtml(setupProgram)}">Скачать настройку ${escapeHtml(program)}</button><pre class="setup-command"><code>powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\\Downloads\\WikiHMRU-${escapeHtml(setupProgram)}.ps1"</code></pre><p class="muted">При сохранении в другую папку укажите свой путь к скачанному файлу. Настройка действует только для текущего пользователя Windows.</p></details>` : ''}`;
}

function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3800); }
function theme(mode) { document.documentElement.dataset.theme = mode; localStorage.setItem('opora-theme', mode); $('#theme-toggle').textContent = mode === 'dark' ? '☀' : '☾'; $('#theme-toggle').title = mode === 'dark' ? 'Светлая тема' : 'Тёмная тема'; }
theme(localStorage.getItem('opora-theme') === 'dark' ? 'dark' : 'light');
function ancestors(section) {
  const result = [], seen = new Set(); let current = section;
  while (current && !seen.has(current.id)) { result.unshift(current); seen.add(current.id); current = db.sections.find(s => s.id === current.parent_id); }
  return result;
}
function visibleSection(section) { return activeAdmin() || (!ancestors(section).some(s => s.visibility === 'admins')); }
function visibleEntry(entry) { return !entry.deleted_at && (activeAdmin() || (entry.publication_state !== 'draft' && entry.visibility !== 'admins' && (!entry.section_id || visibleSection(db.sections.find(s => s.id === entry.section_id) || { id: '', visibility: 'admins' })))); }
function sectionsFor(kind) { return db.sections.filter(s => s.kind === kind && visibleSection(s)); }
function entriesFor(kind) { return db.entries.filter(e => e.type === kind && e.publication_state !== 'draft' && visibleEntry(e)).sort((a,b) => Number(b.pinned)-Number(a.pinned) || new Date(b.updated_at)-new Date(a.updated_at)); }
function filteredEntries(entries) { return entries.filter(e => (view !== 'access' || !regionFilter || (regionFilter === 'none' ? !e.region : e.region === regionFilter)) && (!tagFilter || (e.tags || []).includes(tagFilter)) && (!statusFilter || e.relevance === statusFilter) && (!pinnedOnly || e.pinned)); }
function entryBadges(entry) {
  return `${entry.pinned ? '<span class="meta-chip pinned-chip">Закреплено</span>' : ''}${entry.publication_state === 'draft' ? '<span class="meta-chip draft-chip">Черновик</span>' : ''}${entry.type !== 'access' ? `<span class="meta-chip status-chip" data-status="${escapeHtml(entry.relevance || 'verified')}">${escapeHtml(features.relevance[entry.relevance] || features.relevance.verified)}</span>` : ''}`;
}
function entryTags(entry, links = false) {
  return `<div class="entry-tags">${(entry.tags || []).map(tag => links ? `<button class="tag-chip" data-filter-tag="${escapeHtml(tag)}" data-kind="${entry.type}">#${escapeHtml(tag)}</button>` : `<span class="tag-chip">#${escapeHtml(tag)}</span>`).join('')}${(entry.glpi_ticket_ids || []).map(id => {
    const url = features.ticketUrl(db.settings.glpi_ticket_url_template, id);
    return links && url ? `<a class="ticket-chip" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">GLPI #${id} ↗</a>` : `<span class="ticket-chip" ${links && !url ? 'title="Адрес GLPI ещё не настроен"' : ''}>GLPI #${id}</span>`;
  }).join('')}</div>`;
}
function filterControls(entries) {
  const tags = [...new Set(entries.flatMap(e => e.tags || []))].sort((a,b) => a.localeCompare(b,'ru'));
  if (tagFilter && !tags.includes(tagFilter)) tags.push(tagFilter);
  return `<div class="filter-controls"><label class="field"><span>Тег</span><select data-tag-filter><option value="">Все теги</option>${tags.map(t => `<option value="${escapeHtml(t)}" ${tagFilter === t ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('')}</select></label><label class="field"><span>Актуальность</span><select data-status-filter><option value="">Все статусы</option>${Object.entries(features.relevance).map(([key,label]) => `<option value="${key}" ${statusFilter === key ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label class="check-field"><input type="checkbox" data-pinned-filter ${pinnedOnly ? 'checked' : ''}> Только закреплённые</label>${tagFilter || statusFilter || pinnedOnly ? '<button class="button-quiet" data-reset-filters>Сбросить фильтры</button>' : ''}</div>`;
}
function descendants(id) { const found = new Set([id]); let changed = true; while (changed) { changed = false; for (const s of db.sections) if (s.parent_id && found.has(s.parent_id) && !found.has(s.id)) { found.add(s.id); changed = true; } } return found; }
function sectionName(id) { return db.sections.find(s => s.id === id)?.title || 'Без раздела'; }
function sectionTrail(id) { const s = db.sections.find(x => x.id === id); return s ? ancestors(s).map(x => x.title).join(' / ') : 'Без раздела'; }
function card(entry) {
  const sec = sectionTrail(entry.section_id), excerpt = entry.type === 'access' ? features.remoteConnections(entry).map(c=>c.tool+' · '+c.remote_id).join(' / ') : entry.summary || entry.blocks?.find(b => b.type === 'text')?.text || 'Откройте запись';
  const pictogram = entry.type === 'access' ? programIcon(entry.tool) : icon(/принт|печать|мфу/i.test(entry.title + sec) ? 'printer' : entry.type);
  const markup = `<article class="entry-card ${selectedId === entry.id ? 'selected' : ''}" data-open="${escapeHtml(entry.id)}"><span class="card-icon">${pictogram}</span><div class="card-content"><h3><button class="card-title-button" data-open="${escapeHtml(entry.id)}">${escapeHtml(entry.title)}</button></h3><p>${escapeHtml(excerpt)}</p><div class="card-top">${entry.visibility === 'admins' ? '<span class="private-chip">Только админам</span>' : ''}${entryBadges(entry)}</div>${entryTags(entry,true)}<div class="card-foot"><span>${icon('folder')}${escapeHtml(entry.type === 'access' ? [entry.region || 'Без региона',sec].join(' · ') : sec)}</span><span>${date(entry.updated_at)}</span></div></div></article>`;
  if (entry.type !== 'access') return markup;
  const connections = features.remoteConnections(entry);
  return `<div class="remote-card ${selectedId === entry.id ? 'selected' : ''}">${markup}<div class="remote-card-actions">${connections.map(c=>{const link=remoteLink(c);return link ? `<a class="button-primary" href="${escapeHtml(link.href)}" data-launch-remote>${escapeHtml(c.tool)}</a>` : '';}).join('')}<button class="button-quiet" data-copy-remote="${escapeHtml(entry.id)}">Копировать ID</button></div></div>`;
}
function empty(message, kind) { return `<div class="empty-state"><div class="empty-icon">◇</div><h3>Пока здесь пусто</h3><p>${escapeHtml(message)}</p>${activeAdmin() ? `<button data-create="${kind}">Добавить запись</button>` : ''}</div>`; }
function tree(kind, selected = sectionId, admin = false) {
  const sections = admin ? db.sections.filter(s => s.kind === kind) : sectionsFor(kind);
  const children = parent => sections.filter(s => (s.parent_id || null) === parent).sort((a,b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title));
  const branch = (parent, depth = 0) => children(parent).map(s => `<div class="tree-row" style="--depth:${depth}"><button class="tree-item ${selected === s.id ? 'selected' : ''}" data-section="${escapeHtml(s.id)}" data-kind="${kind}"><span class="tree-symbol">${children(s.id).length ? '▾' : '·'}</span><span>${escapeHtml(s.title)}</span>${admin && ancestors(s).some(x => x.visibility === 'admins') ? '<span class="private-dot" title="Только админам">●</span>' : ''}</button>${admin ? `<button class="tree-edit" data-edit-section="${escapeHtml(s.id)}" aria-label="Редактировать ${escapeHtml(s.title)}">✎</button>` : ''}</div>${branch(s.id, depth + 1)}`).join('');
  return `<div class="section-tree"><div class="tree-title">РАЗДЕЛЫ</div><button class="tree-item root ${selected === null ? 'selected' : ''}" data-section="all" data-kind="${kind}">Все записи</button>${branch(null)}${admin || activeAdmin() ? `<button class="add-section" data-new-section="${kind}" data-parent="${selected || ''}">＋ Новый раздел</button>` : ''}</div>`;
}
function home() {
  const pinned = db.entries.filter(e => visibleEntry(e) && e.publication_state !== 'draft' && e.pinned).slice(0,6);
  const recent = db.entries.filter(e => visibleEntry(e) && e.publication_state !== 'draft').sort((a,b) => new Date(b.updated_at) - new Date(a.updated_at)).slice(0,4);
  return `<div class="page-heading"><div><span class="eyebrow">РАБОЧАЯ ВИКИ</span><h1>База знаний техподдержки</h1><p>Инструкции, сложные случаи и удалённые подключения команды.</p></div></div>
  ${!db.cloud ? '<div class="security-note">Локальная версия: записи видны только в этом браузере. Для общей базы подключите Supabase.</div>' : ''}
  ${readerPreview ? '<div class="security-note">Режим просмотра читателя. Закрытые разделы и статьи скрыты. <button class="text-link" data-exit-preview>Вернуться в админку</button></div>' : ''}
  <div class="search-hero"><span class="eyebrow">ПОИСК</span><h2>Поиск по материалам</h2><div class="hero-search"><span class="search-icon" aria-hidden="true">${icon('search')}</span><input id="home-search" type="search" placeholder="Задача, программа, ошибка или устройство..." aria-label="Поиск по всей вики"><button data-search>Найти</button></div><p>Статьи, сложные случаи и подключения.</p></div>
  <div id="home-search-results" hidden aria-live="polite"></div><div class="stats-grid">${[['knowledge','Статей','▤'],['cases','Сложных случаев','◇'],['access','Подключений','⌁']].map(([kind,label,icon]) => `<button class="stat-card" data-view="${kind}"><div><strong>${entriesFor(kind).length}</strong><span>${label}</span></div><div class="stat-icon">${icon}</div></button>`).join('')}</div>
  <div class="section-heading"><h2>Разделы</h2>${activeAdmin() ? '<button class="text-link" data-view="admin">Управлять разделами →</button>' : ''}</div>
  <div class="root-grid">${['knowledge','cases','access'].map(kind => `<button class="root-card" data-view="${kind}"><span class="root-icon ${kind}">${kind === 'knowledge' ? '▤' : kind === 'cases' ? '◇' : '⌁'}</span><strong>${rootNames[kind]}</strong><small>${sectionsFor(kind).filter(s => !s.parent_id).length} разделов</small><span class="root-arrow">→</span></button>`).join('')}</div>
  ${pinned.length ? `<div class="section-heading"><h2>Закреплённые материалы</h2></div><div class="card-grid">${pinned.map(card).join('')}</div>` : ''}<div class="section-heading recent-title"><h2>Последние обновления</h2></div><div class="card-grid">${recent.length ? recent.map(card).join('') : empty('Здесь появятся новые материалы.', 'knowledge')}</div>`;
}
function normalizeSearch(value) { return String(value || '').normalize('NFKC').toLowerCase().replace(/ё/g, 'е'); }
function editDistance(a, b) {
  const rows = [Array.from({length:b.length + 1}, (_, i) => i)];
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(rows[i-1][j]+1, row[j-1]+1, rows[i-1][j-1]+(a[i-1] === b[j-1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i-1] === b[j-2] && a[i-2] === b[j-1]) row[j] = Math.min(row[j], rows[i-2][j-2]+1);
    }
    rows.push(row);
  }
  return rows[a.length][b.length];
}
function searchTokenScore(text, token) {
  if (text.includes(token)) return 0;
  if (token.length < 3 || token.length > 64 || /^\d+$/.test(token)) return Infinity;
  const limit = token.length >= 7 ? 2 : 1;
  let best = Infinity;
  for (const word of text.match(/[\p{L}\p{N}]+/gu) || []) {
    // Compare the typed prefix too, so an unfinished word can contain a typo.
    for (let length = Math.max(1, token.length-limit); length <= Math.min(word.length, token.length+limit); length++) {
      if (editDistance(token, word.slice(0,length)) <= limit) best = 2;
    }
    if (best !== Infinity) break;
  }
  return best;
}
function searchEntries(entries, value = query) {
  const normalized = normalizeSearch(value).trim();
  if (!normalized) return entries.slice().sort((a,b) => Number(b.pinned)-Number(a.pinned));
  const latin = "qwertyuiop[]asdfghjkl;'zxcvbnm,.", russian = 'йцукенгшщзхъфывапролджэячсмитьбю';
  const switched = [...normalized].map(c => { const i=latin.indexOf(c), j=russian.indexOf(c); return i >= 0 ? russian[i] : j >= 0 ? latin[j] : c; }).join('');
  const aliases = normalized.replace(/(?:энидеск|анидеск)/g,'anydesk').replace(/рудесктоп/g,'rudesktop').replace(/\bssh\b/g,'терминал');
  const variants = [...new Set([normalized,switched,aliases])].map(v => v.match(/[\p{L}\p{N}]+/gu) || []);
  return entries.map((entry, index) => {
    const title = normalizeSearch(entry.title);
    const text = normalizeSearch([entry.title,entry.summary,entry.device,entry.tool,entry.remote_id,entry.region,...features.remoteConnections(entry).map(c=>c.tool+' '+c.remote_id),...(entry.tags || []),...(entry.glpi_ticket_ids || []),sectionTrail(entry.section_id),...(entry.blocks || []).map(b => b.text || b.caption)].join(' '));
    let score = Infinity;
    for (const tokens of variants) {
      if (!tokens.length) continue;
      const scores = tokens.map(token => Math.min(searchTokenScore(title,token), searchTokenScore(text,token)+1));
      score = Math.min(score, scores.reduce((sum,n) => sum+n,0));
    }
    return {entry,score,index};
  }).filter(x => Number.isFinite(x.score)).sort((a,b) => a.score-b.score || Number(b.entry.pinned)-Number(a.entry.pinned) || a.index-b.index).map(x => x.entry);
}
function listing(kind) {
  const sectionSet = sectionId ? descendants(sectionId) : null;
  const all = entriesFor(kind).filter(e => !sectionSet || sectionSet.has(e.section_id));
  const found = searchEntries(filteredEntries(all));
  return `<div class="workspace-layout ${selectedId ? 'has-selection' : ''}"><section class="workspace-list" aria-label="Список материалов"><div class="page-heading"><h1>${escapeHtml(rootNames[kind])}</h1>${activeAdmin() ? `<button class="button-quiet" data-create="${kind}" title="Добавить запись">＋</button>` : ''}</div><label class="search-wrap"><span class="search-icon" aria-hidden="true">${icon('search')}</span><input id="list-search" type="search" placeholder="Поиск в теме…" value="${escapeHtml(query)}" aria-label="Поиск в разделе"></label><details class="workspace-sections" ${sectionId ? 'open' : ''}><summary>${icon('folder')}${sectionId ? escapeHtml(sectionTrail(sectionId)) : 'Все категории'}</summary>${tree(kind)}</details>${kind === 'access' ? `<label class="field region-filter"><span>Регион</span><select id="region-filter">${regionOptions(regionFilter,true)}</select></label>` : ''}${filterControls(all)}${kind === 'access' && activeAdmin() ? '<button type="button" class="button-quiet import-access-button" data-import-access>Импорт из файла</button>' : ''}<div id="list-results" class="list-grid">${found.length ? found.map(card).join('') : empty('В этой теме пока нет записей или ничего не найдено.',kind)}</div></section><section class="workspace-detail" aria-label="Открытая запись">${selectedId ? detail() : `<div class="workspace-placeholder">${icon(kind)}<h2>Выберите запись</h2><p>Откройте материал слева, чтобы прочитать его здесь.</p>${activeAdmin() ? `<button class="button-primary" data-create="${kind}">Новая запись</button>` : ''}</div>`}</section></div>`;
}
function searchResults() {
  const found = searchEntries(filteredEntries(db.entries.filter(visibleEntry)));
  return `<div class="page-heading"><div><span class="eyebrow">ПОИСК ПО ВСЕЙ ВИКИ</span><h1>Результаты поиска</h1><p id="search-count">Найдено: ${found.length}</p></div></div><div class="toolbar"><label class="search-wrap"><span class="search-icon" aria-hidden="true">${icon('search')}</span><input id="global-search" type="search" value="${escapeHtml(query)}" placeholder="Что ищем?" aria-label="Поиск по всей вики"></label></div>${filterControls(db.entries.filter(visibleEntry))}<div id="search-results" class="list-grid">${found.length ? found.map(card).join('') : empty('По вашему запросу записей нет.', 'knowledge')}</div>`;
}
function blockHtml(block) {
  if (block.type === 'heading') return `<h2 class="article-heading">${escapeHtml(block.text)}</h2>`;
  if (block.type === 'text') return `<p class="article-text">${escapeHtml(block.text)}</p>`;
  if (block.type === 'code') return `<div class="code-block"><div class="code-label">КОД <button data-copy-code="${escapeHtml(block.id || '')}">Скопировать</button></div><pre><code>${escapeHtml(block.text)}</code></pre></div>`;
  if (block.type === 'quote') return `<blockquote>${escapeHtml(block.text)}</blockquote>`;
  if (block.type === 'list') return `<ul class="article-list">${String(block.text || '').split('\n').filter(Boolean).map(line => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`;
  if (block.type === 'image') return block.path ? `<figure class="article-image"><img data-image-path="${escapeHtml(block.path)}" alt="${escapeHtml(block.caption || 'Фото к статье')}"><figcaption>${escapeHtml(block.caption)}</figcaption></figure>` : '';
  if (block.type === 'link') { const href = safeUrl(block.href); return href ? `<p class="article-link"><a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">↗ ${escapeHtml(block.text || href)}</a></p>` : ''; }
  return '';
}
function metadataEditor(item) {
  const options = db.entries.filter(e => e.id !== item.id && !e.deleted_at);
  return `<details class="metadata-editor" open><summary>Теги, заявки и связи</summary><div class="editor-top-grid">${field('tags','Теги через запятую',(item.tags || []).join(', '),{placeholder:'windows, печать, сеть'})}${field('glpi_ticket_ids','Номера заявок GLPI',(item.glpi_ticket_ids || []).join(', '),{placeholder:'8487, 8490'})}<label class="field"><span>Актуальность</span><select name="relevance">${Object.entries(features.relevance).map(([key,label]) => `<option value="${key}" ${(item.relevance || 'verified') === key ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label class="check-field"><input name="pinned" type="checkbox" ${item.pinned ? 'checked' : ''}> Закрепить в разделе и на главной</label></div><details class="related-picker"><summary>Связанные материалы (${(item.related_ids || []).length})</summary><input type="search" data-related-search placeholder="Найти материал для связи" aria-label="Найти связанный материал"><div id="related-options">${options.map(e => `<label class="check-field"><input type="checkbox" name="related_ids" value="${escapeHtml(e.id)}" ${(item.related_ids || []).includes(e.id) ? 'checked' : ''}> ${escapeHtml(e.title)} <small>${rootNames[e.type]}${e.publication_state === 'draft' ? ' · Черновик' : ''}</small></label>`).join('') || '<p class="muted">Сначала создайте другие материалы.</p>'}</div></details></details>`;
}
function relatedMaterials(item) {
  const related = db.entries.filter(e => e.id !== item.id && visibleEntry(e) && ((item.related_ids || []).includes(e.id) || (e.related_ids || []).includes(item.id)));
  return related.length ? `<section class="related-materials"><h2>Связанные материалы</h2><div class="card-grid">${related.map(card).join('')}</div></section>` : '';
}
function commentsPanel(item) {
  return `<section class="comments-panel" id="comments-panel" data-entry-id="${escapeHtml(item.id)}"><div class="section-heading"><h2>Комментарии</h2><button class="button-quiet" data-comment-refresh>Обновить</button></div><div id="comments-list" aria-live="polite"><p class="muted">Загрузка комментариев…</p></div><button class="button-quiet" id="comments-more" data-comment-more hidden>Показать более ранние</button>${!readerPreview ? `<form id="comment-form" data-entry-id="${escapeHtml(item.id)}"><input type="hidden" name="comment_id" value=""><label class="field"><span>Ваш комментарий</span><textarea name="body" rows="3" maxlength="4000" required placeholder="Дополнение или вопрос по статье"></textarea></label><div class="detail-actions"><button class="button-primary" type="submit">Сохранить комментарий</button><button class="button-quiet" type="button" id="comment-cancel" hidden>Отменить редактирование</button></div></form>` : ''}</section>`;
}
async function loadComments(append = false) {
  const panel = $('#comments-panel'); if (!panel) return;
  const request = ++commentsRequest, entryId = panel.dataset.entryId;
  const offset = append ? commentRows.length : 0;
  const more = panel.querySelector('#comments-more'); more.disabled = true;
  try {
    const page = await db.commentsFor(entryId,offset);
    if (request !== commentsRequest || !panel.isConnected) return;
    commentRows = append ? [...commentRows,...page.slice(0,50)] : page.slice(0,50);
    panel.querySelector('#comments-list').innerHTML = commentRows.length ? commentRows.slice().reverse().map(c => `<article class="comment"><div class="comment-meta"><strong>${escapeHtml(c.author_name || 'Участник')}</strong><span>${dateTime(c.created_at)}${c.updated_at !== c.created_at ? ' · изменён' : ''}</span></div><p>${escapeHtml(c.body)}</p>${!readerPreview && (activeAdmin() || c.author_id === (db.user?.id || 'local')) ? `<div class="comment-actions"><button class="text-link" data-comment-edit="${escapeHtml(c.id)}">Изменить</button><button class="text-link" data-comment-delete="${escapeHtml(c.id)}">Удалить</button></div>` : ''}</article>`).join('') : '<p class="muted">Комментариев пока нет. Можно добавить уточнение или задать вопрос.</p>';
    more.hidden = page.length <= 50;
  } catch(e) { if (panel.isConnected && request === commentsRequest) panel.querySelector('#comments-list').textContent = 'Не удалось загрузить комментарии: ' + e.message; }
  finally { if (panel.isConnected && request === commentsRequest) more.disabled = false; }
}
function detail() {
  const item = db.entries.find(e => e.id === selectedId && visibleEntry(e)); if (!item) return '<button class="back-button" data-back>← Назад к списку</button><h1>Запись недоступна</h1><p>Она удалена или у вас нет доступа.</p>';
  const trail = sectionTrail(item.section_id);
  return `<div class="detail-toolbar"><button class="back-button" data-back>← К списку</button><button class="button-quiet" data-copy-link>Копировать ссылку</button>${activeAdmin() ? `<button class="button-quiet" data-edit-entry="${escapeHtml(item.id)}">Редактировать</button>` : ''}</div><article class="article"><div class="article-top"><span class="badge ${escapeHtml(item.type)}">${escapeHtml(rootNames[item.type])}</span>${item.visibility === 'admins' ? '<span class="private-chip">⌁ Только админам</span>' : ''}${entryBadges(item)}</div><h1>${escapeHtml(item.title)}</h1><div class="article-meta">${item.type==='access'?escapeHtml(item.region || 'Без региона')+' · ':''}${escapeHtml(trail)} · Обновлено ${date(item.updated_at)}</div>${item.type !== 'access' && item.summary ? `<p class="article-lead">${escapeHtml(item.summary)}</p>` : ''}
  ${entryTags(item,true)}${item.type === 'access' ? `<div class="access-info"><div><small>ПРОГРАММА</small><strong class="program-badge">${programIcon(item.tool)}${escapeHtml(canonicalProgram(item.tool) || item.tool || '—')}</strong></div><div><small>${canonicalProgram(item.tool) === 'Терминал' ? 'АДРЕС ПОДКЛЮЧЕНИЯ' : 'ID ПОДКЛЮЧЕНИЯ'}</small><strong class="connection-id">${escapeHtml(item.remote_id || '—')}</strong></div></div>${remoteActions(item)}` : ''}
  <div class="article-body">${(item.type === 'access' ? [] : item.blocks || []).map((b, i) => blockHtml({ ...b, id: String(i) })).join('') || (item.type === 'access' ? '' : '<p class="article-muted">Материал пока не заполнен.</p>')}</div>
  ${relatedMaterials(item)}${item.type !== 'access' ? commentsPanel(item) : ''}${activeAdmin() ? `<div class="detail-actions"><button class="button-quiet" data-pin-entry="${escapeHtml(item.id)}">${item.pinned ? 'Открепить' : 'Закрепить'}</button><button class="button-quiet" data-history="${escapeHtml(item.id)}">История изменений</button><button class="button-danger" data-delete-entry="${escapeHtml(item.id)}">В корзину</button></div><div id="history-panel"></div>` : ''}</article>`;
}
function collectionView(kind) {
  if (!activeAdmin()) return home();
  const all = db.entries.filter(e => kind === 'trash' ? Boolean(e.deleted_at) : !e.deleted_at && e.publication_state === 'draft');
  const found = searchEntries(all);
  return `<div class="page-heading"><div><h1>${rootNames[kind]}</h1><p>${kind === 'trash' ? 'Удалённые записи, комментарии и фото сохраняются. Запись можно восстановить.' : 'Материалы до публикации видят только администраторы.'}</p></div></div><div class="toolbar"><label class="search-wrap"><span class="search-icon" aria-hidden="true">${icon('search')}</span><input id="collection-search" type="search" value="${escapeHtml(query)}" placeholder="Поиск..."></label>${kind === 'drafts' ? '<button class="new-button" data-create="knowledge">＋ Создать статью</button>' : all.length ? `<button class="button-danger" data-purge-trash>Очистить корзину (${all.length})</button>` : ''}</div><div id="collection-results" class="list-grid">${found.length ? found.map(e => kind === 'trash' ? `<div class="trash-card"><div><h3>${escapeHtml(e.title)}</h3><p>${rootNames[e.type]} · Удалено ${dateTime(e.deleted_at)}${e.publication_state === 'draft' ? ' · Черновик' : ''}</p></div><div class="detail-actions"><button class="button-quiet" data-restore-entry="${escapeHtml(e.id)}">Восстановить</button><button class="button-danger" data-purge-entry="${escapeHtml(e.id)}">Удалить навсегда</button></div></div>` : card(e)).join('') : '<p class="muted">Здесь пока нет записей.</p>'}</div>`;
}
function admin() {
  if (!activeAdmin()) return home();
  let body;
  if (adminTab === 'users' && db.cloud) body = `<div class="admin-panel"><h2>Участники</h2><p class="muted">Приглашения отправляются через Supabase. Здесь можно назначить роль после создания пользователя.</p><div class="user-list">${db.profiles.map(p => `<div class="user-row"><div><strong>${escapeHtml(p.email || p.id)}</strong><small>${p.id === db.user?.id ? 'Ваш аккаунт' : ''}</small></div><select data-role="${escapeHtml(p.id)}" aria-label="Роль ${escapeHtml(p.email || p.id)}"><option value="reader" ${p.role === 'reader' ? 'selected' : ''}>Читатель</option><option value="admin" ${p.role === 'admin' ? 'selected' : ''}>Администратор</option></select></div>`).join('')}</div></div>`;
  else if (adminTab === 'integrations') body = `<form id="glpi-settings-form" class="admin-panel"><h2>GLPI Helpdesk</h2><p>Замените номер заявки в ссылке на <code>{id}</code>. Пароли и токены в адрес не добавляйте.</p>${field('glpi_template','Ссылка на заявку',db.settings.glpi_ticket_url_template,{placeholder:'https://helpdesk.example/front/ticket.form.php?id={id}'})}<button class="button-primary" type="submit">Сохранить адрес GLPI</button></form>`;
  else body = `<div class="admin-categories">${['knowledge','cases','access'].map(kind => `<div class="admin-panel"><div class="admin-panel-head"><h2>${rootNames[kind]}</h2><button class="text-link" data-new-section="${kind}" data-parent="">＋ Раздел</button></div>${tree(kind,null,true)}</div>`).join('')}</div>`;
  return `<div class="page-heading"><div><span class="eyebrow">НАСТРОЙКИ ВИКИ</span><h1>Управление</h1><p>Разделы, права сотрудников и ссылки GLPI.</p></div><button class="button-quiet" data-reader-preview>Посмотреть как читатель</button></div><div class="tab-bar"><button class="${adminTab === 'sections' ? 'active' : ''}" data-admin-tab="sections">Разделы</button>${db.cloud ? `<button class="${adminTab === 'users' ? 'active' : ''}" data-admin-tab="users">Участники</button>` : ''}<button class="${adminTab === 'integrations' ? 'active' : ''}" data-admin-tab="integrations">GLPI</button></div>${body}`;
}
function auth() { return `<div class="auth-layout"><div><span class="eyebrow">КОМАНДНАЯ ВИКИ</span><h1>Вход в WikiHMRU</h1><p>Знания вашей команды — в одном защищённом рабочем пространстве.</p></div><form id="login-form" class="auth-card"><label class="field"><span>Рабочий email</span><input name="email" type="email" autocomplete="email" required></label><label class="field"><span>Пароль</span><input name="password" type="password" autocomplete="current-password" required></label><p id="login-error" role="alert" hidden></p><button class="button-primary" type="submit">Войти</button><p>Для доступа обратитесь к администратору вики.</p></form></div>`; }
function invite() { return `<div class="auth-layout"><div><span class="eyebrow">ПРИГЛАШЕНИЕ</span><h1>Создайте пароль</h1><p>После сохранения откроется командная база знаний.</p></div><form id="invite-form" class="auth-card"><label class="field"><span>Новый пароль</span><input name="password" type="password" autocomplete="new-password" minlength="8" required></label><button class="button-primary" type="submit">Сохранить пароль</button></form></div>`; }
async function hydrateImages(root = document) {
  for (const img of root.querySelectorAll('img[data-image-path]')) {
    const path = img.dataset.imagePath;
    try { const url = await db.imageUrl(path); if (img.isConnected) img.src = url; }
    catch { if (img.isConnected) img.alt = 'Не удалось загрузить фото'; }
  }
}
function render() {
  if (['drafts','trash','admin'].includes(view) && !activeAdmin()) { view = 'home'; selectedId = null; }
  if (db.cloud && db.needsPassword) $('#content').innerHTML = invite();
  else if (db.cloud && !db.session) $('#content').innerHTML = auth();
  else $('#content').innerHTML = ['knowledge','cases','access'].includes(view) ? listing(view) : selectedId ? detail() : view === 'home' ? home() : view === 'admin' ? admin() : view === 'search' ? searchResults() : ['drafts','trash'].includes(view) ? collectionView(view) : listing(view);
  const showApp = !db.cloud || (db.session && !db.needsPassword);
  document.querySelectorAll('.admin-only').forEach(el => { el.hidden = !activeAdmin() || !showApp; });
  $('.sidebar-foot').textContent = db.cloud ? 'Командная вики · данные в Supabase' : 'Локальная версия · данные в браузере';
  $('#admin-nav').hidden = !activeAdmin() || !showApp;
  $('#new-button').hidden = !activeAdmin() || !showApp;
  document.querySelectorAll('.side-nav [data-view]').forEach(btn => btn.classList.toggle('active', btn.dataset.view === view));
  $('#breadcrumb-current').textContent = rootNames[view] || 'Обзор';
  $('#top-search-wrap').hidden = !showApp; closeSuggestions();
  document.querySelectorAll('.side-nav [data-view]').forEach(btn => { btn.querySelector('.nav-icon').innerHTML = icon(btn.dataset.view); });
  $('#today').textContent = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
  for (const kind of ['knowledge','cases','access']) $(`#nav-${kind}-count`).textContent = entriesFor(kind).length;
  $('#export-button').hidden = db.cloud; $('#import-button').hidden = db.cloud;
  $('#logout-button')?.remove();
  if (db.cloud && db.session && !db.needsPassword) { const btn = document.createElement('button'); btn.id = 'logout-button'; btn.className = 'sidebar-action'; btn.textContent = '↪  Выйти из аккаунта'; $('.sidebar-bottom').prepend(btn); }
  if (showApp) syncRoute();
  $('#content').getAnimations().forEach(a => a.cancel());
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) $('#content').animate([{opacity:0.55, transform:'translateY(5px)'},{opacity:1,transform:'translateY(0)'}],{duration:170,easing:'ease-out'});
  hydrateImages($('#content'));
  if ($('#comments-panel')) loadComments();
}
function go(next, sec = null) { regionFilter=''; if (db.cloud && (!db.session || db.needsPassword)) return; view = next; sectionId = sec; selectedId = null; query = ''; tagFilter = ''; statusFilter = ''; pinnedOnly = false; regionFilter = ''; versions = null; render(); }
function regionOptions(selected='', filter=false) { return `<option value="">${filter?'Все регионы':'Не указан'}</option>${filter?`<option value="none" ${selected==='none'?'selected':''}>Без региона</option>`:''}${[...new Set([...features.regions,...db.entries.filter(e=>e.type==='access'&&e.region).map(e=>e.region)])].map(r=>`<option value="${escapeHtml(r)}" ${selected===r?'selected':''}>${escapeHtml(r)}</option>`).join('')}`; }
function sectionOptions(kind, selected = '', exclude = null) {
  const list = db.sections.filter(s => s.kind === kind && s.id !== exclude && (!exclude || !descendants(exclude).has(s.id)));
  return `<option value="">Без раздела</option>${list.map(s => `<option value="${escapeHtml(s.id)}" ${selected === s.id ? 'selected' : ''}>${escapeHtml('— '.repeat(Math.max(0, ancestors(s).length - 1)) + s.title)}</option>`).join('')}`;
}
function field(name, label, value = '', options = {}) {
  return `<label class="field"><span>${label}${options.required ? ' *' : ''}</span>${options.textarea ? `<textarea name="${name}" rows="${options.rows || 3}" ${options.required ? 'required' : ''}>${escapeHtml(value)}</textarea>` : `<input name="${name}" value="${escapeHtml(value)}" ${options.required ? 'required' : ''} placeholder="${escapeHtml(options.placeholder || '')}">`}</label>`;
}
function renderBlocks() {
  $('#blocks-list').innerHTML = draftBlocks.map((block, i) => {
    const tools = `<div class="block-head"><strong>${blockNames[block.type]}</strong><div><button type="button" data-move-block="${i}" data-direction="-1" title="Вверх">↑</button><button type="button" data-move-block="${i}" data-direction="1" title="Вниз">↓</button><button type="button" data-remove-block="${i}" title="Удалить">×</button></div></div>`;
    let fields;
    if (block.type === 'image') {
      fields = `<input type="file" data-image-file="${i}" accept="image/png,image/jpeg,image/webp,image/gif"><input data-block-field="caption" data-index="${i}" value="${escapeHtml(block.caption || '')}" placeholder="Подпись к фото"><div class="image-preview">${block.preview ? `<img src="${escapeHtml(block.preview)}" alt="Предпросмотр">` : block.path ? `<img data-image-path="${escapeHtml(block.path)}" alt="Предпросмотр">` : '<span>Выберите фото · JPG, PNG, WebP, GIF до 10 МБ</span>'}</div>`;
    } else if (block.type === 'link') {
      fields = `<input data-block-field="text" data-index="${i}" value="${escapeHtml(block.text || '')}" placeholder="Текст ссылки"><input data-block-field="href" data-index="${i}" value="${escapeHtml(block.href || '')}" placeholder="https://example.com">`;
    } else {
      fields = `<textarea data-block-field="text" data-index="${i}" rows="${block.type === 'code' ? 6 : 3}" placeholder="${block.type === 'list' ? 'Один пункт на строку' : 'Введите текст...'}">${escapeHtml(block.text || '')}</textarea>`;
    }
    return `<div class="block-editor" data-block="${i}">${tools}${fields}</div>`;
  }).join('') || '<p class="muted">Добавьте блоки, чтобы оформить материал.</p>';
  hydrateImages($('#blocks-list'));
}
function chooseTopic() {
  if (!activeAdmin()) return;
  $('#dialog-title').textContent = 'Новая запись';
  $('#editor-fields').innerHTML = `<p class="muted">Выберите тему. На следующем шаге будут её категории и поля.</p><div class="topic-picker">${['knowledge','cases','access'].map(kind => `<button type="button" class="topic-button" data-choose-topic="${kind}">${icon(kind)}<strong>${rootNames[kind]}</strong><span>→</span></button>`).join('')}</div>`;
  $('#save-draft-button').hidden = true; $('#save-entry-button').hidden = true;
  $('#editor-dialog').showModal();
}
function openEditor(kind, id = null) {
  if (!activeAdmin()) return;
  const item = db.entries.find(e => e.id === id) || {};
  const category = item.section_id || (view === kind ? sectionId : null);
  const privateParent = category && ancestors(db.sections.find(s => s.id === category)).some(s => s.visibility === 'admins');
  editingId = id; editorKind = kind; pendingFiles = new Map();
  draftBlocks = (item.blocks || []).map(b => ({ ...b, client_id: uuid() }));
  $('#dialog-title').textContent = id ? 'Редактировать запись' : 'Новая запись';
  if (kind === 'access') {
    const program = canonicalProgram(item.tool) || 'AnyDesk';
    const connections = features.remoteConnections(item);
    const additional = tool => connections.find(c=>c.tool===tool)?.remote_id || '';
    const region = item.region || (features.regions.includes(regionFilter)?regionFilter:'');
    const selectedSection = item.section_id || (view === 'access' ? sectionId : null) || '';
    $('#editor-fields').innerHTML = `<div class="editor-top-grid">${field('title','Имя',item.title,{required:true,placeholder:'Например, сервер бухгалтерии'})}<label class="field"><span>Программа</span><select name="tool" data-current="${program}">${remotePrograms.map(p => `<option value="${p}" ${p === program ? 'selected' : ''}>${p}</option>`).join('')}</select></label>${field('remote_id','Основной адрес / ID',item.remote_id,{required:true,placeholder:'ID выбранной программы'})}<div data-extra-tool="AnyDesk" ${program==='AnyDesk'?'hidden':''}>${field('additional_anydesk','Дополнительный AnyDesk ID',additional('AnyDesk'),{placeholder:'Необязательно'})}</div><div data-extra-tool="RuDesktop" ${program==='RuDesktop'?'hidden':''}>${field('additional_rudesktop','Дополнительный RuDesktop ID',additional('RuDesktop'),{placeholder:'Необязательно'})}</div><div data-extra-tool="Терминал" ${program==='Терминал'?'hidden':''}>${field('additional_terminal','Дополнительный адрес терминала',additional('Терминал'),{placeholder:'Необязательно: user@host:port'})}</div><label class="field"><span>Регион</span><select name="region">${regionOptions(region)}</select></label><label class="field"><span>Доступ</span><select name="visibility"><option value="all" ${item.visibility !== 'admins' && !privateParent ? 'selected' : ''}>Все читатели</option><option value="admins" ${item.visibility === 'admins' || privateParent ? 'selected' : ''}>Только администраторы</option></select></label><label class="field"><span>Категория</span><select name="section_id">${sectionOptions(kind,selectedSection)}</select></label></div><p class="muted">Для SSH: IP или имя сервера; можно указать user@host:port. По умолчанию порт 22.</p>`;
  } else {
  $('#editor-fields').innerHTML = `<div class="editor-top-grid">${field('title','Название',item.title,{required:true,placeholder:'Короткое понятное название'})}${field('summary','Краткое описание',item.summary,{placeholder:'О чём материал'})}<label class="field"><span>Раздел</span><select name="section_id">${sectionOptions(kind,item.section_id || (view === kind ? sectionId : ''))}</select></label><label class="field"><span>Доступ</span><select name="visibility"><option value="all" ${item.visibility !== 'admins' && !privateParent ? 'selected' : ''}>Все читатели</option><option value="admins" ${item.visibility === 'admins' || privateParent ? 'selected' : ''}>Только администраторы</option></select></label></div>
  ${metadataEditor(item)}<div class="template-toolbar"><label class="field"><span>Шаблон</span><select id="entry-template">${Object.entries(features.templates).map(([key,t]) => `<option value="${key}">${t.name}</option>`).join('')}</select></label><button type="button" class="button-quiet" data-apply-template>Применить шаблон</button></div><div class="block-area"><div class="block-area-head"><div><strong>Содержание</strong><p>Соберите карточку из блоков в нужном порядке.</p></div></div><div id="blocks-list"></div><div class="block-toolbar">${Object.entries(blockNames).map(([type,label]) => `<button type="button" data-add-block="${type}">＋ ${label}</button>`).join('')}</div></div>`;
    renderBlocks();
  }
  $('#save-entry-button').hidden = false;
  if (!id) $('#editor-fields').insertAdjacentHTML('afterbegin', `<label class="field topic-select"><span>Тема</span><select name="entry_type">${['knowledge','cases','access'].map(k => `<option value="${k}" ${k === kind ? 'selected' : ''}>${rootNames[k]}</option>`).join('')}</select></label>`);
  $('#save-draft-button').hidden = kind === 'access' || (id && item.publication_state !== 'draft');
  $('#save-entry-button').textContent = kind === 'access' ? 'Сохранить подключение' : id && item.publication_state !== 'draft' ? 'Сохранить изменения' : 'Опубликовать';
  $('#editor-dialog').showModal(); $('#editor-form [name=title]').focus();
}
function openSection(kind, id = null, parent = null) {
  if (!activeAdmin()) return;
  const item = db.sections.find(s => s.id === id) || {};
  const privateParent = (item.parent_id || parent) && ancestors(db.sections.find(s => s.id === (item.parent_id || parent))).some(s => s.visibility === 'admins');
  $('#section-dialog-title').textContent = id ? 'Редактировать раздел' : 'Новый раздел';
  $('#section-form').dataset.id = id || ''; $('#section-form').dataset.kind = kind;
  $('#section-fields').innerHTML = `${field('title','Название раздела',item.title,{required:true,placeholder:'Например, IP-телефония'})}<label class="field"><span>Родительский раздел</span><select name="parent_id">${sectionOptions(kind,item.parent_id || parent,id)}</select></label><label class="field"><span>Доступ</span><select name="visibility"><option value="all" ${item.visibility !== 'admins' && !privateParent ? 'selected' : ''}>Все читатели</option><option value="admins" ${item.visibility === 'admins' || privateParent ? 'selected' : ''}>Только администраторы</option></select></label>${id ? '<button type="button" class="button-danger" data-delete-section="'+escapeHtml(id)+'">Удалить раздел</button>' : ''}`;
  $('#section-dialog').showModal(); $('#section-form [name=title]').focus();
}
function historyValue(field, value) {
  if (value === null || value === undefined || value === '') return '—';
  if (field === 'section_id') return sectionTrail(value);
  if (field === 'type') return rootNames[value] || value;
  if (field === 'visibility') return value === 'admins' ? 'Только администраторы' : 'Все читатели';
  if (field === 'pinned') return value ? 'Закреплено' : 'Не закреплено';
  if (field === 'publication_state') return value === 'draft' ? 'Черновик' : 'Опубликовано';
  if (field === 'relevance') return features.relevance[value] || value;
  if (field === 'deleted_at') return value ? 'В корзине' : 'Доступна';
  if (field === 'related_ids') return value.map(id => db.entries.find(e => e.id === id)?.title || id).join(', ') || '—';
  if (field === 'remote_connections') return features.remoteConnections({remote_connections:value}).map(c=>c.tool+': '+c.remote_id).join('\n') || '—';
  if (Array.isArray(value)) return value.join(', ') || '—';
  if (field === 'block') return [blockNames[value.type] || value.type,value.text,value.caption,value.href,value.path ? 'Фото прикреплено' : ''].filter(Boolean).join('\n');
  return String(value);
}
function historyDiff(before,after) {
  const labels = {title:'Название',summary:'Описание',type:'Тема',section_id:'Категория',visibility:'Доступ',tool:'Программа',remote_id:'Адрес / ID подключения',device:'Устройство',pinned:'Закрепление',tags:'Теги',glpi_ticket_ids:'Заявки GLPI',related_ids:'Связанные материалы',publication_state:'Публикация',relevance:'Актуальность',deleted_at:'Корзина',region:'Регион',remote_connections:'Подключения'};
  const changes = features.versionChanges(before,after);
  return changes.length ? `<ul class="history-changes">${changes.map(c => {
    const blockLabel = !c.before ? 'добавлен' : !c.after ? 'удалён' : c.before.path !== c.after.path && c.before.type === 'image' && c.after.type === 'image' ? 'изображение заменено' : 'изменён';
    return `<li><strong>${escapeHtml(c.field === 'block' ? `Блок ${c.index+1}: ${blockLabel}` : labels[c.field])}</strong><div class="diff-values"><div><small>Было</small><pre>${escapeHtml(historyValue(c.field,c.before))}</pre></div><div><small>Стало</small><pre>${escapeHtml(historyValue(c.field,c.after))}</pre></div></div></li>`;
  }).join('')}</ul>` : '<p class="muted">Содержимое не менялось: обновлены служебные данные записи.</p>';
}
async function showHistory(id) {
  const entry = db.entries.find(e => e.id === id), requestPanel = $('#history-panel');
  if (!requestPanel) return;
  try {
    const loaded = await db.versions(id);
    if (!requestPanel.isConnected || selectedId !== id) return;
    versions = loaded;
    requestPanel.innerHTML = `<div class="history-panel"><h2>История изменений</h2>${versions.length ? versions.map((v,index) => {
      const after = index ? versions[index-1].snapshot : entry;
      return `<section class="version-item"><div class="version-row"><div><strong>${escapeHtml(v.snapshot?.title || 'Без названия')}</strong><span>${dateTime(v.changed_at)} · ${escapeHtml(db.profiles.find(p => p.id === v.changed_by)?.email || (v.changed_by === 'local' ? 'Локальный редактор' : 'Администратор'))}</span></div><button class="button-quiet" data-restore="${escapeHtml(v.id)}">Восстановить эту версию</button></div><details class="version-diff" ${index === 0 ? 'open' : ''}><summary>Что изменилось</summary>${historyDiff(v.snapshot,after)}</details></section>`;
    }).join('') : '<p class="muted">Предыдущих версий пока нет.</p>'}</div>`;
  } catch (error) { toast(error.message); }
}
function updateListSearch() {
  const target = $('#list-results'); if (!target) return;
  const set = sectionId ? descendants(sectionId) : null;
  const all = entriesFor(view).filter(e => !set || set.has(e.section_id));
  const found = searchEntries(filteredEntries(all));
  target.innerHTML = found.length ? found.map(card).join('') : empty('Ничего не найдено.', view);
}
function updateGlobalSearch() {
  const target = $('#search-results'); if (!target) return;
  const found = searchEntries(filteredEntries(db.entries.filter(visibleEntry)));
  $('#search-count').textContent = `Найдено: ${found.length}`;
  target.innerHTML = found.length ? found.map(card).join('') : empty('По вашему запросу записей нет.', 'knowledge');
}
document.addEventListener('click', async event => {
  if (event.target.closest('[data-launch-remote]')) { toast('Разрешите браузеру открыть приложение. Если оно не открылось, используйте настройку в записи.'); return; }
  const button = event.target.closest('button') || (!event.target.closest('a,input,select,textarea') && event.target.closest('.entry-card[data-open]')); if (!button) return;
  if (button.dataset.downloadLauncher) {
    const program = button.dataset.downloadLauncher;
    if (!['AnyDesk','RuDesktop','Terminal'].includes(program)) return;
    try { const response = await fetch(new URL('scripts/install-remote-links.ps1',document.baseURI)); if (!response.ok) throw Error(); const script = (await response.text()).replace('[string]$Program,', `[string]$Program = '${program}',`); const url = URL.createObjectURL(new Blob([script],{type:'text/plain;charset=utf-8'})), a = document.createElement('a'); a.href = url; a.download = `WikiHMRU-${program}.ps1`; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000); } catch { toast('Не удалось скачать настройку. Попробуйте ещё раз'); } return;
  }
  if (button.dataset.importAccess !== undefined) { if (!activeAdmin()) return; ++importFileRequest; importRows=[]; importQueue=[]; $('#remote-import-file').value=''; $('#remote-import-controls').innerHTML=''; $('#remote-import-preview').innerHTML=''; $('#remote-import-message').textContent=''; $('#remote-import-save').disabled=true; $('#remote-import-dialog').showModal(); return; }
  if (button.dataset.closeImport !== undefined) { if(!importBusy) { ++importFileRequest; $('#remote-import-dialog').close(); } return; }
  if (button.id === 'theme-toggle') return theme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  if (button.dataset.view) return go(button.dataset.view);
  if (button.dataset.filterTag) { go(button.dataset.kind); tagFilter = button.dataset.filterTag; render(); return; }
  if (button.dataset.resetFilters !== undefined) { tagFilter = ''; statusFilter = ''; pinnedOnly = false; render(); return; }
  if (button.dataset.pinEntry) { try { const item = db.entries.find(e => e.id === button.dataset.pinEntry); await db.patchEntry(item.id,{pinned:!item.pinned}); render(); } catch(e) { toast(e.message); } return; }
  if (button.dataset.purgeEntry || button.dataset.purgeTrash !== undefined) {
    if (!activeAdmin()) return;
    const ids=button.dataset.purgeEntry ? [button.dataset.purgeEntry] : db.entries.filter(e=>e.deleted_at).map(e=>e.id);
    if (!ids.length || !confirm(`Удалить навсегда ${ids.length} записей, их комментарии, историю и фото? Восстановление будет невозможно.`)) return;
    button.disabled=true;let count=0,warning='';
    try { for (const id of ids) { const result=await db.purgeEntry(id);if(result)warning=result;count++; } render();toast(warning || `Удалено навсегда: ${count}`); }
    catch(e){render();toast(`Удалено: ${count}. ${e.message}`);}finally{button.disabled=false;}return;
  }
  if (button.dataset.restoreEntry) { try { await db.restoreEntry(button.dataset.restoreEntry); render(); toast('Запись восстановлена'); } catch(e) { toast(e.message); } return; }
  if (button.dataset.applyTemplate !== undefined) { if (draftBlocks.length && !confirm('Заменить содержимое выбранным шаблоном?')) return; for (const b of draftBlocks) if (b.preview) URL.revokeObjectURL(b.preview); pendingFiles.clear(); draftBlocks = features.templateBlocks($('#entry-template').value).map(b => ({...b,client_id:uuid()})); renderBlocks(); return; }
  if (button.dataset.commentMore !== undefined) return loadComments(true);
  if (button.dataset.commentRefresh !== undefined) return loadComments();
  if (button.dataset.commentEdit) { const c = commentRows.find(c => c.id === button.dataset.commentEdit); if (!c) return; $('#comment-form [name=body]').value = c.body; $('#comment-form [name=comment_id]').value = c.id; $('#comment-cancel').hidden = false; $('#comment-form [name=body]').focus(); return; }
  if (button.id === 'comment-cancel') { $('#comment-form').reset(); button.hidden = true; return; }
  if (button.dataset.commentDelete) { if (!confirm('Удалить комментарий?')) return; try { await db.deleteComment(button.dataset.commentDelete); await loadComments(); } catch(e) { toast(e.message); } return; }
  if (button.dataset.section) { const kind = button.dataset.kind; view = kind; sectionId = button.dataset.section === 'all' ? null : button.dataset.section; selectedId = null; query = ''; render(); return; }
  if (button.dataset.open) { const item = db.entries.find(e => e.id === button.dataset.open && visibleEntry(e)); if (!item) return; if (view !== item.type) { sectionId = null; query = ''; tagFilter = ''; statusFilter = ''; pinnedOnly = false; } selectedId = item.id; if (view !== 'drafts') view = item.type; versions = null; render(); return; }
  if (button.dataset.back !== undefined) { selectedId = null; render(); return; }
  if (button.dataset.create) return openEditor(button.dataset.create);
  if (button.id === 'new-button') return chooseTopic();
  if (button.dataset.chooseTopic) return openEditor(button.dataset.chooseTopic);
  if (button.id === 'sidebar-toggle') return sidebar(!document.body.classList.contains('sidebar-collapsed'));
  if (button.dataset.copyLink !== undefined) { try { await navigator.clipboard.writeText(location.href); toast('Ссылка скопирована'); } catch { toast('Не удалось скопировать ссылку'); } return; }
  if (button.dataset.searchAll !== undefined) return fullSearch();
  if (button.dataset.editEntry) return openEditor(db.entries.find(e => e.id === button.dataset.editEntry)?.type, button.dataset.editEntry);
  if (button.dataset.deleteEntry) { if (!confirm('Переместить запись в корзину? Администратор сможет её восстановить.')) return; try { await db.deleteEntry(button.dataset.deleteEntry); selectedId = null; render(); toast('Запись перемещена в корзину'); } catch (e) { toast(e.message); } return; }
  if (button.dataset.history) return showHistory(button.dataset.history);
  if (button.dataset.restore) { const v = versions?.find(x => String(x.id) === button.dataset.restore); if (!v || !confirm('Восстановить эту версию? Текущая сохранится в истории.')) return; try { await db.saveEntry({ ...v.snapshot, id: selectedId }); render(); toast('Версия восстановлена'); } catch (e) { toast(e.message); } return; }
  if (button.dataset.newSection) return openSection(button.dataset.newSection, null, button.dataset.parent || null);
  if (button.dataset.editSection) { const s = db.sections.find(x => x.id === button.dataset.editSection); return openSection(s.kind, s.id); }
  if (button.dataset.deleteSection) { if (!confirm('Удалить раздел?')) return; try { await db.deleteSection(button.dataset.deleteSection); $('#section-dialog').close(); render(); toast('Раздел удалён'); } catch (e) { toast(e.message); } return; }
  if (button.dataset.adminTab) { adminTab = button.dataset.adminTab; render(); return; }
  if (button.dataset.readerPreview !== undefined) { readerPreview = true; go('home'); return; }
  if (button.dataset.exitPreview !== undefined) { readerPreview = false; go('admin'); return; }
  if (button.dataset.search !== undefined) { query = $('#home-search').value.trim(); view = 'search'; sectionId = null; selectedId = null; versions = null; render(); return; }
  if (button.dataset.copyRemote) { const item = db.entries.find(e => e.id === button.dataset.copyRemote && visibleEntry(e)); if (item) { try { await navigator.clipboard.writeText((button.dataset.copyProgram ? features.remoteConnections(item).find(c=>c.tool===canonicalProgram(button.dataset.copyProgram))?.remote_id : features.remoteConnections(item).map(c=>c.tool+': '+c.remote_id).join('\n')) || item.remote_id || ''); toast('ID скопирован'); } catch { toast('Не удалось скопировать ID'); } } return; }
  if (button.dataset.copyCode !== undefined) { const b = db.entries.find(e => e.id === selectedId)?.blocks?.[Number(button.dataset.copyCode)]; if (b) { await navigator.clipboard.writeText(b.text || ''); toast('Код скопирован'); } return; }
  if (button.dataset.addBlock) { draftBlocks.push({ type: button.dataset.addBlock, client_id: uuid(), text: '', caption: '', path: '', href: '' }); renderBlocks(); return; }
  if (button.dataset.removeBlock !== undefined) { const index = Number(button.dataset.removeBlock); const removed = draftBlocks.splice(index,1)[0]; if (removed?.preview) URL.revokeObjectURL(removed.preview); pendingFiles.delete(removed?.client_id); renderBlocks(); return; }
  if (button.dataset.moveBlock !== undefined) { const i = Number(button.dataset.moveBlock), j = i + Number(button.dataset.direction); if (j < 0 || j >= draftBlocks.length) return; [draftBlocks[i],draftBlocks[j]] = [draftBlocks[j],draftBlocks[i]]; renderBlocks(); return; }
  if (button.id === 'close-dialog' || button.id === 'cancel-dialog') { $('#editor-dialog').close(); return; }
  if (button.dataset.closeSection !== undefined) { $('#section-dialog').close(); return; }
  if (button.id === 'logout-button') { await db.logout(); readerPreview = false; go('home'); render(); return; }
});
$('#content').addEventListener('input', event => {
  if (event.target.id === 'home-search') { const target = $('#home-search-results'); const value = event.target.value.trim(); target.hidden = !value; const found = value ? searchEntries(db.entries.filter(visibleEntry), value) : []; target.innerHTML = value ? `<p>Найдено: ${found.length}</p><div class="card-grid">${found.slice(0,6).map(card).join('') || '<p>Ничего не найдено. Попробуйте другое слово.</p>'}</div>` : ''; }
  if (event.target.id === 'collection-search') { query = event.target.value; syncRoute(true); const temp = document.createElement('div'); temp.innerHTML = collectionView(view); $('#collection-results').innerHTML = temp.querySelector('#collection-results').innerHTML; }
  if (event.target.id === 'list-search') { query = event.target.value; syncRoute(true); updateListSearch(); }
  if (event.target.id === 'global-search') { query = event.target.value; syncRoute(true); updateGlobalSearch(); }
});
$('#content').addEventListener('keydown', event => { if (event.target.id === 'home-search' && event.key === 'Enter') { event.preventDefault(); query = event.target.value.trim(); view = 'search'; selectedId = null; render(); } });
$('#content').addEventListener('change', async event => {
  if (event.target.id === 'region-filter') { regionFilter=event.target.value; selectedId=null; render(); return; }
  if (event.target.dataset.tagFilter !== undefined || event.target.dataset.statusFilter !== undefined || event.target.dataset.pinnedFilter !== undefined) {
    if (event.target.dataset.tagFilter !== undefined) tagFilter = event.target.value;
    if (event.target.dataset.statusFilter !== undefined) statusFilter = event.target.value;
    if (event.target.dataset.pinnedFilter !== undefined) pinnedOnly = event.target.checked;
    render(); return;
  }
  if (!event.target.dataset.role) return;
  const id = event.target.dataset.role, role = event.target.value;
  if (!confirm(`Назначить роль «${role === 'admin' ? 'Администратор' : 'Читатель'}»?`)) { render(); return; }
  try { await db.updateRole(id, role); render(); toast('Роль обновлена'); } catch (e) { render(); toast(e.message); }
});
$('#editor-fields').addEventListener('input', event => {
  if (event.target.dataset.relatedSearch !== undefined) { const q = event.target.value.toLowerCase(); $('#related-options').querySelectorAll('label').forEach(label => { label.hidden = !label.textContent.toLowerCase().includes(q); }); }

  const index = Number(event.target.dataset.index), key = event.target.dataset.blockField;
  if (key && draftBlocks[index]) draftBlocks[index][key] = event.target.value;
});
$('#editor-fields').addEventListener('change', event => {
  if (event.target.name === 'tool') { const select=event.target, old=select.dataset.current, names={AnyDesk:'additional_anydesk',RuDesktop:'additional_rudesktop','Терминал':'additional_terminal'}; if(names[old]) $(`#editor-form [name=${names[old]}]`).value=$('#editor-form [name=remote_id]').value; $('#editor-form [name=remote_id]').value=names[select.value]?$(`#editor-form [name=${names[select.value]}]`).value:''; document.querySelectorAll('[data-extra-tool]').forEach(el=>el.hidden=el.dataset.extraTool===select.value); select.dataset.current=select.value; return; }
  if (event.target.name === 'entry_type') { const title = $('#editor-form [name=title]').value, kind = event.target.value; if (draftBlocks.length && !confirm('Сменить тему и очистить содержимое новой записи?')) { event.target.value = editorKind; return; } openEditor(kind); $('#editor-form [name=title]').value = title; return; }
  if (event.target.name === 'related_ids') { $('.related-picker summary').textContent = `Связанные материалы (${$('#related-options').querySelectorAll('input:checked').length})`; return; }
  if (event.target.name === 'section_id') {
    const section = db.sections.find(s => s.id === event.target.value);
    if (section && ancestors(section).some(s => s.visibility === 'admins')) $('#editor-form [name=visibility]').value = 'admins';
    return;
  }
  const index = Number(event.target.dataset.imageFile); if (!event.target.hasAttribute('data-image-file') || !draftBlocks[index]) return;
  const file = event.target.files[0]; if (!file) return;
  if (!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type) || file.size > 10*1024*1024) { toast('Поддерживаются JPG, PNG, WebP и GIF до 10 МБ'); return; }
  const block = draftBlocks[index]; if (block.preview) URL.revokeObjectURL(block.preview);
  block.preview = URL.createObjectURL(file); pendingFiles.set(block.client_id,file); renderBlocks();
});
$('#section-fields').addEventListener('change', event => {
  if (event.target.name !== 'parent_id') return;
  const section = db.sections.find(s => s.id === event.target.value);
  if (section && ancestors(section).some(s => s.visibility === 'admins')) $('#section-form [name=visibility]').value = 'admins';
});
$('#editor-form').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.target; if (!form.reportValidity()) return;
  if (!form.querySelector('[name=title]')) return;
  const data = Object.fromEntries(new FormData(form).entries()); const old = db.entries.find(e => e.id === editingId);
  const id = editingId || uuid();
  const privateSection = db.sections.find(s => s.id === data.section_id);
  const forcedPrivate = privateSection && ancestors(privateSection).some(s => s.visibility === 'admins');
  const base = { ...features.normalizeEntry(old || {}), id, type: editorKind, section_id: data.section_id || null, title: data.title.trim(), summary: (data.summary || '').trim(), visibility: forcedPrivate ? 'admins' : data.visibility, tool: (data.tool || '').trim(), device: (data.device || '').trim(), remote_id: (data.remote_id || '').trim(), author_id: old?.author_id || db.user?.id || null };
  if (!base.title) return;
  if (editorKind === 'access') {
    base.region = (data.region || '').trim();
    base.remote_connections = features.remoteConnections({...base,remote_connections:[{tool:'AnyDesk',remote_id:data.additional_anydesk},{tool:'RuDesktop',remote_id:data.additional_rudesktop},{tool:'Терминал',remote_id:data.additional_terminal}]});
    base.summary = old?.summary || ''; base.device = old?.device || '';
    if (!remoteLink(base) || base.remote_connections.some(c=>!remoteLink(c))) { toast('Проверьте программу и адрес / ID подключения'); return; }
  }
  const buttons = [...form.querySelectorAll('[type=submit]')]; buttons.forEach(button => { button.disabled = true; });
  try {
    if (editorKind !== 'access') {
      base.tags = features.parseTags(data.tags); base.glpi_ticket_ids = features.parseTickets(data.glpi_ticket_ids); base.relevance = data.relevance; base.pinned = data.pinned === 'on';
      base.related_ids = new FormData(form).getAll('related_ids');
      base.publication_state = event.submitter?.value === 'draft' ? 'draft' : 'published';
    }
    const blocks = editorKind === 'access' ? (old?.blocks || []) : draftBlocks.map(({ type,text,caption,path,href }) => ({ type, text: text || '', caption: caption || '', path: path || '', href: href || '' }));
    if (editorKind !== 'access' && blocks.some(b => b.type === 'link' && !safeUrl(b.href))) throw Error('Укажите полный адрес ссылки с https:// или http://');
    const uploads = (editorKind === 'access' ? [] : draftBlocks).map((b,i) => ({ file: pendingFiles.get(b.client_id), i })).filter(x => x.file);
    if (db.cloud && !editingId && uploads.length) await db.saveEntry({ ...base, blocks: blocks.filter((_,i) => !uploads.some(u => u.i === i)) });
    for (const { file, i } of uploads) blocks[i].path = await db.uploadImage(id, file);
    await db.saveEntry({ ...base, blocks });
    for (const block of draftBlocks) if (block.preview) URL.revokeObjectURL(block.preview);
    $('#editor-dialog').close(); selectedId = id; view = base.publication_state === 'draft' ? 'drafts' : editorKind; render(); toast(base.publication_state === 'draft' ? 'Черновик сохранён' : 'Запись сохранена');
  } catch (e) { toast('Не удалось сохранить: ' + e.message); }
  finally { buttons.forEach(button => { button.disabled = false; }); }
});
$('#section-form').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.target; if (!form.reportValidity()) return;
  const data = Object.fromEntries(new FormData(form).entries());
  const parentSection = db.sections.find(x => x.id === data.parent_id);
  const parentPrivate = parentSection && ancestors(parentSection).some(x => x.visibility === 'admins');
  const s = { id: form.dataset.id || uuid(), kind: form.dataset.kind, title: data.title.trim(), parent_id: data.parent_id || null, visibility: parentPrivate ? 'admins' : data.visibility, sort_order: db.sections.find(x => x.id === form.dataset.id)?.sort_order || db.sections.filter(x => x.kind === form.dataset.kind).length + 1 };
  if (!s.title) return;
  try { await db.saveSection(s); $('#section-dialog').close(); render(); toast('Раздел сохранён'); } catch (e) { toast(e.message); }
});
$('#content').addEventListener('submit', async event => {
  if (event.target.id === 'glpi-settings-form') { event.preventDefault(); const btn = event.target.querySelector('button'); btn.disabled = true; try { await db.saveSettings(new FormData(event.target).get('glpi_template')); toast('Адрес GLPI сохранён'); } catch(e) { toast(e.message); } finally { btn.disabled = false; } return; }
  if (event.target.id === 'comment-form') { event.preventDefault(); const form = event.target, data = new FormData(form), btn = form.querySelector('[type=submit]'); btn.disabled = true; try { await db.saveComment(form.dataset.entryId,data.get('body'),data.get('comment_id') || null); if (form.isConnected) { form.reset(); form.querySelector('#comment-cancel').hidden = true; await loadComments(); } } catch(e) { toast(e.message); } finally { btn.disabled = false; } return; }
  if (event.target.id === 'login-form') {
    event.preventDefault(); const form = event.target; if (!form.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form).entries()); const btn = form.querySelector('button'); btn.disabled = true;
    $('#login-error').hidden = true;
    try { await db.login(data.email.trim(), data.password); render(); } catch (e) { const text = (e.code === 'invalid_credentials' || /invalid.?login.?credentials|invalid_credentials/i.test(e.message)) ? 'Неверный логин или пароль' : /email.?not.?confirmed/i.test(e.message) ? 'Подтвердите email перед входом' : /rate.?limit|too many/i.test(e.message) ? 'Слишком много попыток входа. Попробуйте позже' : 'Не удалось войти. Проверьте соединение и попробуйте ещё раз'; $('#login-error').textContent = text; $('#login-error').hidden = false; } finally { btn.disabled = false; }
  }
  if (event.target.id === 'invite-form') {
    event.preventDefault(); const form = event.target; if (!form.reportValidity()) return; const btn = form.querySelector('button'); btn.disabled = true;
    try { await db.setInvitePassword(new FormData(form).get('password')); render(); toast('Пароль сохранён'); } catch (e) { toast(e.message); } finally { btn.disabled = false; }
  }
});
let importSheets=[], importText='', importRows=[], importMap={}, importQueue=[], importBusy=false, importFileRequest=0;
const importFields={title:'Имя / ФИ',remote_id:'Основной адрес / ID',anydesk_id:'AnyDesk ID (отдельная колонка)',rudesktop_id:'RuDesktop ID (отдельная колонка)',region:'Регион',tool:'Программа',visibility:'Доступ'};
function setupImportControls() {
  const sheet=Number($('#import-sheet')?.value || 0);
  importRows=importSheets[sheet]?.rows || [];
  if (!importRows.length || importRows.length>501) throw Error('Пустой файл или больше 500 записей');
  const width=Math.max(...importRows.map(r=>r.length)); if(width>50)throw Error('До 50 колонок в файле');
  importMap=window.wikiImport.mapping(importRows[0]);
  const header=Object.values(importMap).some(v=>v>=0);
  const previousSection=sectionId || '';
  $('#remote-import-controls').innerHTML=`${importSheets.length>1 ? `<label class="field"><span>Лист Excel</span><select id="import-sheet">${importSheets.map((s,i)=>`<option value="${i}" ${i===sheet?'selected':''}>${escapeHtml(s.name)}</option>`).join('')}</select></label>`:''}${importText ? `<label class="field"><span>Разделитель</span><select id="import-delimiter"><option value="auto">Определить автоматически</option><option value="tab">Табуляция</option><option value=";">Точка с запятой</option><option value=",">Запятая</option><option value="|">Вертикальная черта</option><option value="spaces">Два и более пробелов</option></select></label>`:''}<label class="check-field"><input id="import-header" type="checkbox" ${header?'checked':''}> Первая строка — названия колонок</label><div class="editor-top-grid">${Object.entries(importFields).map(([key,label])=>`<label class="field"><span>${label}</span><select data-import-map="${key}"><option value="-1">${['tool','visibility'].includes(key)?'Общее значение ниже':'Выберите колонку'}</option>${Array.from({length:width},(_,i)=>`<option value="${i}" ${importMap[key]===i?'selected':''}>${i+1}: ${escapeHtml(importRows[0][i] || 'Колонка '+(i+1))}</option>`).join('')}</select></label>`).join('')}<label class="field"><span>Общая программа</span><select id="import-program">${remotePrograms.map(p=>`<option>${p}</option>`).join('')}</select></label><label class="field"><span>Общий доступ</span><select id="import-visibility"><option value="all">Все читатели</option><option value="admins">Только администраторы</option></select></label><label class="field"><span>Общий регион</span><select id="import-region">${regionOptions(features.regions.includes(regionFilter)?regionFilter:'')}</select></label><label class="field"><span>Категория для всех записей</span><select id="import-section">${sectionOptions('access',previousSection)}</select></label></div>`;
  if(!header){ if(width>1){importMap.title=0;importMap.remote_id=1;$('[data-import-map=title]').value='0';$('[data-import-map=remote_id]').value='1';} }
  previewImport();
}
function previewImport() {
  if(importBusy)return;
  importQueue=[];
  const controls=$('#remote-import-controls'); if(!controls.querySelector('#import-header'))return;
  const map=Object.fromEntries([...controls.querySelectorAll('[data-import-map]')].map(el=>[el.dataset.importMap,Number(el.value)]));
  const header=$('#import-header').checked, cat=$('#import-section').value, privateCategory=cat && ancestors(db.sections.find(s=>s.id===cat)).some(s=>s.visibility==='admins');
  const used=Object.values(map).filter(i=>i>=0);const error=map.title<0||(map.remote_id<0&&map.anydesk_id<0&&map.rudesktop_id<0) ? 'Назначьте колонку имени и хотя бы одну колонку ID / адреса.' : new Set(used).size!==used.length ? 'Для каждого поля выберите отдельную колонку.' : '';
  const rows=importRows.slice(header?1:0);if(rows.length>500){$('#remote-import-message').textContent='До 500 записей за импорт';$('#remote-import-save').disabled=true;return;}
  const seen=new Set(db.entries.filter(e=>e.type==='access').flatMap(e=>features.remoteConnections(e).map(c=>c.tool+'|'+c.remote_id.replace(/\s/g,'').toLowerCase())));
  const preview=rows.map((r,index)=>{
    const title=String(r[map.title]||'').trim();
    let remote_id=String(r[map.remote_id]||'').trim(), tool=map.tool<0?$('#import-program').value:window.wikiImport.program(r[map.tool]);
    const extra=[{tool:'AnyDesk',remote_id:String(r[map.anydesk_id]||'').trim()},{tool:'RuDesktop',remote_id:String(r[map.rudesktop_id]||'').trim()}].filter(c=>c.remote_id);
    if(!remote_id && extra.length){tool=extra[0].tool;remote_id=extra[0].remote_id;}
    const rawRegion=map.region<0?$('#import-region').value:String(r[map.region]||'').trim();
    const region=features.regions.find(v=>v.toLowerCase()===rawRegion.toLowerCase()) || ({'банаул':'Барнаул','беларусь':'Белоруссия'})[rawRegion.toLowerCase()] || rawRegion;
    const v=map.visibility<0?$('#import-visibility').value:String(r[map.visibility]||'').trim().toLowerCase();
    const all=['all','все','все читатели','читатели','общий','reader'], admins=['admins','admin','администраторы','только администраторы','только админам','закрытый'];
    const visibility=privateCategory?'admins':all.includes(v)?'all':admins.includes(v)?'admins':'';
    const item={id:uuid(),type:'access',title,remote_id,tool,region,remote_connections:extra,visibility,section_id:cat||null,blocks:[],summary:'',device:'',author_id:db.user?.id||null};
    const connections=features.remoteConnections(item);item.remote_connections=connections;
    const keys=connections.map(c=>c.tool+'|'+c.remote_id.replace(/\s/g,'').toLowerCase());
    let status=error||(!title?'Нет имени':!tool?'Неизвестная программа':!visibility?'Неизвестный доступ':(region && !features.regions.includes(region))?'Неизвестный регион':(!remoteLink(item)||connections.some(c=>!remoteLink(c)))?'Некорректный адрес / ID':keys.some(key=>seen.has(key))?'Повтор: пропускается':'Готово');
    if(status==='Готово'){keys.forEach(key=>seen.add(key));importQueue.push(item);}
    return `<tr><td>${index+(header?2:1)}</td><td>${escapeHtml(title)}</td><td>${escapeHtml(connections.map(c=>c.tool+': '+c.remote_id).join(' / '))}</td><td>${escapeHtml(region || 'Без региона')}</td><td>${visibility==='admins'?'Только админам':visibility==='all'?'Все читатели':'—'}</td><td>${escapeHtml(status)}</td></tr>`;
  });
  $('#remote-import-message').textContent=error||`Готово к импорту: ${importQueue.length} из ${rows.length}. Ошибки и повторы будут пропущены.`;
  $('#remote-import-preview').innerHTML=`<div class="import-table-wrap"><table><thead><tr><th>Строка</th><th>Имя</th><th>Подключения</th><th>Регион</th><th>Доступ</th><th>Проверка</th></tr></thead><tbody>${preview.join('')}</tbody></table></div>`;
  $('#remote-import-save').disabled=!importQueue.length||!activeAdmin();$('#remote-import-save').textContent=`Импортировать ${importQueue.length} записей`;
}
$('#remote-import-file').addEventListener('change',async event=>{
  const request=++importFileRequest,file=event.target.files[0]; if(!file)return;
  $('#remote-import-message').textContent='Чтение файла…';$('#remote-import-controls').innerHTML='';$('#remote-import-preview').innerHTML='';$('#remote-import-save').disabled=true;
  try{
    if(file.size>5*1024*1024)throw Error('Файл должен быть меньше 5 МБ');
    const bytes=await file.arrayBuffer();if(request!==importFileRequest)return;importText='';
    if(/\.xlsx$/i.test(file.name))importSheets=await window.wikiImport.xlsx(bytes);
    else if(/\.(csv|tsv|txt)$/i.test(file.name)){let decoder=new TextDecoder('utf-8',{fatal:true});try{importText=decoder.decode(bytes);}catch{importText=new TextDecoder('windows-1251').decode(bytes);}importSheets=[{name:file.name,rows:window.wikiImport.parseText(importText)}];}
    else throw Error('Поддерживаются TXT, CSV, TSV и XLSX. Старый XLS сохраните как XLSX или CSV');
    if(request!==importFileRequest)return;setupImportControls();
  }catch(e){if(request===importFileRequest){$('#remote-import-message').textContent=e.message;$('#remote-import-controls').innerHTML='';$('#remote-import-preview').innerHTML='';importQueue=[];}}
});
$('#remote-import-controls').addEventListener('change',event=>{
  try{if(event.target.id==='import-sheet')setupImportControls();else if(event.target.id==='import-delimiter'){const value=event.target.value;importSheets=[{name:'Текст',rows:window.wikiImport.parseText(importText,value==='tab'?'\t':value)}];setupImportControls();$('#import-delimiter').value=value;}else previewImport();}catch(e){$('#remote-import-message').textContent=e.message;$('#remote-import-save').disabled=true;}
});
$('#remote-import-save').addEventListener('click',async()=>{
  if(!activeAdmin()||importBusy||!importQueue.length)return;
  previewImport();const batch=importQueue.slice(); if(!batch.length)return;
  importBusy=true;const dialog=$('#remote-import-dialog');dialog.querySelectorAll('button,input,select').forEach(el=>el.disabled=true);$('#remote-import-message').textContent=`Сохранение ${batch.length} записей…`;
  try{await db.importAccess(batch);dialog.close();go('access');toast(`Импортировано подключений: ${batch.length}`);}catch(e){$('#remote-import-message').textContent='Не удалось сохранить: '+e.message;}finally{importBusy=false;dialog.querySelectorAll('button,input,select').forEach(el=>el.disabled=false);if(dialog.open)previewImport();}
});
$('#remote-import-dialog').addEventListener('cancel',event=>{if(importBusy)event.preventDefault();});
function sidebar(collapsed) {
  document.body.classList.toggle('sidebar-collapsed', collapsed);
  $('#sidebar-toggle').setAttribute('aria-expanded', String(!collapsed));
  $('#sidebar-toggle').setAttribute('aria-label', collapsed ? 'Развернуть меню' : 'Свернуть меню');
  $('#sidebar-toggle').title = collapsed ? 'Развернуть меню' : 'Свернуть меню';
  localStorage.setItem('wikihmru-sidebar', collapsed ? 'collapsed' : 'expanded');
}
sidebar(localStorage.getItem('wikihmru-sidebar') !== 'expanded');
let suggestionIndex = -1;
function closeSuggestions() { $('#search-suggestions').hidden = true; $('#top-search').setAttribute('aria-expanded','false'); $('#top-search').removeAttribute('aria-activedescendant'); suggestionIndex = -1; }
function suggest() {
  const input = $('#top-search'), value = input.value.trim(), panel = $('#search-suggestions');
  if (!value || (db.cloud && (!db.session || db.needsPassword))) return closeSuggestions();
  const results = searchEntries(db.entries.filter(visibleEntry),value).slice(0,7);
  panel.innerHTML = results.map((e,i) => `<button id="suggestion-${i}" role="option" aria-selected="false" data-open="${escapeHtml(e.id)}">${icon(e.type)}<span><strong>${escapeHtml(e.title)}</strong><small>${escapeHtml(rootNames[e.type])} · ${escapeHtml(sectionTrail(e.section_id))}${e.glpi_ticket_ids?.length ? ' · GLPI #' + e.glpi_ticket_ids.join(', #') : ''}</small></span></button>`).join('') + (results.length ? '<button class="search-all" data-search-all>Все результаты →</button>' : '<p>Ничего не найдено. Попробуйте другое слово.</p>');
  panel.hidden = false; input.setAttribute('aria-expanded','true'); suggestionIndex = -1;
}
function fullSearch() { query = $('#top-search').value.trim(); view = 'search'; sectionId = null; selectedId = null; tagFilter = ''; statusFilter = ''; pinnedOnly = false; render(); }
$('#top-search').addEventListener('input',suggest);
$('#top-search').addEventListener('focus',suggest);
$('#top-search').addEventListener('keydown',event => {
  const options = [...$('#search-suggestions').querySelectorAll('[role=option]')];
  if (event.key === 'Escape') return closeSuggestions();
  if (['ArrowDown','ArrowUp'].includes(event.key)) {
    event.preventDefault(); if ($('#search-suggestions').hidden) suggest();
    if (!options.length) return;
    suggestionIndex = (suggestionIndex + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
    options.forEach((el,i) => el.setAttribute('aria-selected',String(i === suggestionIndex)));
    $('#top-search').setAttribute('aria-activedescendant',options[suggestionIndex].id); options[suggestionIndex].scrollIntoView({block:'nearest'});
  }
  if (event.key === 'Enter') { event.preventDefault(); if (!$('#search-suggestions').hidden && options[suggestionIndex]) options[suggestionIndex].click(); else fullSearch(); }
});
document.addEventListener('click',event => { if (!event.target.closest('#top-search-wrap')) closeSuggestions(); });
document.addEventListener('keydown',event => { if (event.key === 'Tab') closeSuggestions(); });
$('#export-button').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(db.exportLocal(),null,2)],{type:'application/json'}), url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = `WikiHMRU-${new Date().toISOString().slice(0,10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
});
$('#import-button').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', async event => { const file = event.target.files[0]; if (!file) return; try { const data = JSON.parse(await file.text()); if (!confirm('Заменить текущие локальные данные содержимым файла?')) return; db.importLocal(data); go('home'); toast('Копия загружена'); } catch (e) { toast(e.message); } finally { event.target.value = ''; } });
(async () => { try { await db.init(); render(); } catch (e) { render(); toast('Ошибка загрузки: ' + e.message); } })();
})();
