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
let tagFilter = '', statusFilter = '', pinnedOnly = false, commentsRequest = 0, commentRows = [];
let draftBlocks = [], pendingFiles = new Map(), versions = null, adminTab = 'sections', readerPreview = false, toastTimer;
const activeAdmin = () => db.isAdmin() && !readerPreview;
function readRoute() {
  const params = new URLSearchParams(location.search);
  view = Object.hasOwn(rootNames, params.get('view')) ? params.get('view') : 'home';
  sectionId = params.get('section') || null;
  selectedId = params.get('entry') || null;
  query = params.get('q') || '';
  tagFilter = params.get('tag') || ''; statusFilter = Object.hasOwn(features.relevance, params.get('status')) ? params.get('status') : ''; pinnedOnly = params.get('pinned') === '1';
  versions = null;
}
function syncRoute(replace = false) {
  const url = new URL(location.href);
  for (const key of ['view', 'section', 'entry', 'q', 'tag', 'status', 'pinned']) url.searchParams.delete(key);
  if (view !== 'home') url.searchParams.set('view', view);
  if (sectionId) url.searchParams.set('section', sectionId);
  if (selectedId) url.searchParams.set('entry', selectedId);
  if (query) url.searchParams.set('q', query);
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
function remoteActions(item) {
  const link = remoteLink(item);
  return `<div class="detail-actions">${link ? `<a class="button-primary" href="${escapeHtml(link.href)}">${link.label}</a>` : ''}<button class="button-quiet" data-copy-remote="${escapeHtml(item.id)}">Скопировать ID</button></div>${link?.setup ? '<details><summary>Настроить запуск приложения на Windows</summary><p>Скачайте установщик, запустите его в PowerShell и выберите RuDesktop или Terminal. Для терминала используется встроенный SSH-клиент Windows. Настройка выполняется один раз на каждом компьютере.</p><a href="https://github.com/gekoowho/WikiHMRU/blob/main/scripts/install-remote-links.ps1" target="_blank" rel="noopener noreferrer">Открыть установщик</a></details>' : ''}`;
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
function filteredEntries(entries) { return entries.filter(e => (!tagFilter || (e.tags || []).includes(tagFilter)) && (!statusFilter || e.relevance === statusFilter) && (!pinnedOnly || e.pinned)); }
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
  const sec = sectionTrail(entry.section_id), excerpt = entry.type === 'access' ? [canonicalProgram(entry.tool) || entry.tool, entry.remote_id].filter(Boolean).join(' · ') : entry.summary || entry.blocks?.find(b => b.type === 'text')?.text || entry.device || 'Откройте запись';
  return `<button class="entry-card" data-open="${escapeHtml(entry.id)}"><div class="card-top"><span class="badge ${escapeHtml(entry.type)}">${escapeHtml(rootNames[entry.type])}</span>${entry.visibility === 'admins' ? '<span class="private-chip">⌁ Только админам</span>' : ''}${entryBadges(entry)}</div><h3>${escapeHtml(entry.title)}</h3><p>${escapeHtml(excerpt)}</p>${entryTags(entry)}<div class="card-foot"><span>${escapeHtml(sec)}</span><span>${date(entry.updated_at)}</span></div></button>`;
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
  <div class="search-hero"><span class="eyebrow">ПОИСК</span><h2>Поиск по материалам</h2><div class="hero-search"><span>⌕</span><input id="home-search" type="search" placeholder="Задача, программа, ошибка или устройство..." aria-label="Поиск по всей вики"><button data-search>Найти</button></div><p>Статьи, сложные случаи и подключения.</p></div>
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
  const variants = [...new Set([normalized,switched])].map(v => v.match(/[\p{L}\p{N}]+/gu) || []);
  return entries.map((entry, index) => {
    const title = normalizeSearch(entry.title);
    const text = normalizeSearch([entry.title,entry.summary,entry.device,entry.tool,entry.remote_id,...(entry.tags || []),...(entry.glpi_ticket_ids || []),sectionTrail(entry.section_id),...(entry.blocks || []).map(b => b.text || b.caption)].join(' '));
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
  return `<div class="page-heading"><div><span class="eyebrow">${escapeHtml(rootNames[kind]).toUpperCase()}</span><h1>${sectionId ? escapeHtml(sectionName(sectionId)) : escapeHtml(rootNames[kind])}</h1><p>${kind === 'knowledge' ? 'Проверенные инструкции для типовых задач.' : kind === 'cases' ? 'Разборы нестандартных ситуаций и решений.' : 'Подключения через AnyDesk, RuDesktop и терминал.'}</p></div></div>
  <div class="catalog-layout">${tree(kind)}<div class="catalog-main"><div class="toolbar"><label class="search-wrap"><span>⌕</span><input id="list-search" type="search" placeholder="Поиск в разделе..." value="${escapeHtml(query)}" aria-label="Поиск в разделе"></label>${activeAdmin() ? `<button class="new-button" data-create="${kind}">＋ Добавить</button>` : ''}</div>
  ${filterControls(all)}${kind === 'access' ? '<div class="security-note compact">ID подключений доступны читателям. Пароли, ключи и одноразовые коды здесь не храните.</div>' : ''}
  <div id="list-results" class="list-grid">${found.length ? found.map(card).join('') : empty(all.length ? 'Ничего не найдено. Попробуйте другой запрос.' : 'В этом разделе пока нет записей.', kind)}</div></div></div>`;
}
function searchResults() {
  const found = searchEntries(filteredEntries(db.entries.filter(visibleEntry)));
  return `<div class="page-heading"><div><span class="eyebrow">ПОИСК ПО ВСЕЙ ВИКИ</span><h1>Результаты поиска</h1><p id="search-count">Найдено: ${found.length}</p></div></div><div class="toolbar"><label class="search-wrap"><span>⌕</span><input id="global-search" type="search" value="${escapeHtml(query)}" placeholder="Что ищем?" aria-label="Поиск по всей вики"></label></div>${filterControls(db.entries.filter(visibleEntry))}<div id="search-results" class="list-grid">${found.length ? found.map(card).join('') : empty('По вашему запросу записей нет.', 'knowledge')}</div>`;
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
  return `<button class="back-button" data-back>← Назад к списку</button><article class="article"><div class="article-top"><span class="badge ${escapeHtml(item.type)}">${escapeHtml(rootNames[item.type])}</span>${item.visibility === 'admins' ? '<span class="private-chip">⌁ Только админам</span>' : ''}${entryBadges(item)}</div><h1>${escapeHtml(item.title)}</h1><div class="article-meta">${escapeHtml(trail)} · Обновлено ${date(item.updated_at)}</div>${item.type !== 'access' && item.summary ? `<p class="article-lead">${escapeHtml(item.summary)}</p>` : ''}
  ${entryTags(item,true)}${item.type === 'access' ? `<div class="access-info"><div><small>ПРОГРАММА</small><strong>${escapeHtml(canonicalProgram(item.tool) || item.tool || '—')}</strong></div><div><small>АДРЕС / ID</small><strong>${escapeHtml(item.remote_id || '—')}</strong></div></div>${remoteActions(item)}` : ''}
  <div class="article-body">${(item.type === 'access' ? [] : item.blocks || []).map((b, i) => blockHtml({ ...b, id: String(i) })).join('') || (item.type === 'access' ? '' : '<p class="article-muted">Материал пока не заполнен.</p>')}</div>
  ${relatedMaterials(item)}${item.type !== 'access' ? commentsPanel(item) : ''}${activeAdmin() ? `<div class="detail-actions"><button class="button-quiet" data-pin-entry="${escapeHtml(item.id)}">${item.pinned ? 'Открепить' : 'Закрепить'}</button><button class="button-quiet" data-edit-entry="${escapeHtml(item.id)}">Редактировать</button><button class="button-quiet" data-history="${escapeHtml(item.id)}">История изменений</button><button class="button-danger" data-delete-entry="${escapeHtml(item.id)}">В корзину</button></div><div id="history-panel"></div>` : ''}</article>`;
}
function collectionView(kind) {
  if (!activeAdmin()) return home();
  const all = db.entries.filter(e => kind === 'trash' ? Boolean(e.deleted_at) : !e.deleted_at && e.publication_state === 'draft');
  const found = searchEntries(all);
  return `<div class="page-heading"><div><h1>${rootNames[kind]}</h1><p>${kind === 'trash' ? 'Удалённые записи, комментарии и фото сохраняются. Запись можно восстановить.' : 'Материалы до публикации видят только администраторы.'}</p></div></div><div class="toolbar"><label class="search-wrap"><span>⌕</span><input id="collection-search" type="search" value="${escapeHtml(query)}" placeholder="Поиск..."></label>${kind === 'drafts' ? '<button class="new-button" data-create="knowledge">＋ Создать статью</button>' : ''}</div><div id="collection-results" class="list-grid">${found.length ? found.map(e => kind === 'trash' ? `<div class="trash-card"><div><h3>${escapeHtml(e.title)}</h3><p>${rootNames[e.type]} · Удалено ${dateTime(e.deleted_at)}${e.publication_state === 'draft' ? ' · Черновик' : ''}</p></div><button class="button-quiet" data-restore-entry="${escapeHtml(e.id)}">Восстановить</button></div>` : card(e)).join('') : '<p class="muted">Здесь пока нет записей.</p>'}</div>`;
}
function admin() {
  if (!activeAdmin()) return home();
  let body;
  if (adminTab === 'users' && db.cloud) body = `<div class="admin-panel"><h2>Участники</h2><p class="muted">Приглашения отправляются через Supabase. Здесь можно назначить роль после создания пользователя.</p><div class="user-list">${db.profiles.map(p => `<div class="user-row"><div><strong>${escapeHtml(p.email || p.id)}</strong><small>${p.id === db.user?.id ? 'Ваш аккаунт' : ''}</small></div><select data-role="${escapeHtml(p.id)}" aria-label="Роль ${escapeHtml(p.email || p.id)}"><option value="reader" ${p.role === 'reader' ? 'selected' : ''}>Читатель</option><option value="admin" ${p.role === 'admin' ? 'selected' : ''}>Администратор</option></select></div>`).join('')}</div></div>`;
  else if (adminTab === 'integrations') body = `<form id="glpi-settings-form" class="admin-panel"><h2>GLPI Helpdesk</h2><p>Замените номер заявки в ссылке на <code>{id}</code>. Пароли и токены в адрес не добавляйте.</p>${field('glpi_template','Ссылка на заявку',db.settings.glpi_ticket_url_template,{placeholder:'https://helpdesk.example/front/ticket.form.php?id={id}'})}<button class="button-primary" type="submit">Сохранить адрес GLPI</button></form>`;
  else body = `<div class="admin-categories">${['knowledge','cases','access'].map(kind => `<div class="admin-panel"><div class="admin-panel-head"><h2>${rootNames[kind]}</h2><button class="text-link" data-new-section="${kind}" data-parent="">＋ Раздел</button></div>${tree(kind,null,true)}</div>`).join('')}</div>`;
  return `<div class="page-heading"><div><span class="eyebrow">НАСТРОЙКИ ВИКИ</span><h1>Управление</h1><p>Разделы, права сотрудников и ссылки GLPI.</p></div><button class="button-quiet" data-reader-preview>Посмотреть как читатель</button></div><div class="tab-bar"><button class="${adminTab === 'sections' ? 'active' : ''}" data-admin-tab="sections">Разделы</button>${db.cloud ? `<button class="${adminTab === 'users' ? 'active' : ''}" data-admin-tab="users">Участники</button>` : ''}<button class="${adminTab === 'integrations' ? 'active' : ''}" data-admin-tab="integrations">GLPI</button></div>${body}`;
}
function auth() { return `<div class="auth-layout"><div><span class="eyebrow">КОМАНДНАЯ ВИКИ</span><h1>Вход в WikiHMRU</h1><p>Знания вашей команды — в одном защищённом рабочем пространстве.</p></div><form id="login-form" class="auth-card"><label class="field"><span>Рабочий email</span><input name="email" type="email" autocomplete="email" required></label><label class="field"><span>Пароль</span><input name="password" type="password" autocomplete="current-password" required></label><button class="button-primary" type="submit">Войти</button><p>Для доступа обратитесь к администратору вики.</p></form></div>`; }
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
  else $('#content').innerHTML = selectedId ? detail() : view === 'home' ? home() : view === 'admin' ? admin() : view === 'search' ? searchResults() : ['drafts','trash'].includes(view) ? collectionView(view) : listing(view);
  const showApp = !db.cloud || (db.session && !db.needsPassword);
  document.querySelectorAll('.admin-only').forEach(el => { el.hidden = !activeAdmin() || !showApp; });
  $('.sidebar-foot').textContent = db.cloud ? 'Командная вики · данные в Supabase' : 'Локальная версия · данные в браузере';
  $('#admin-nav').hidden = !activeAdmin() || !showApp;
  $('#new-button').hidden = !activeAdmin() || !showApp;
  document.querySelectorAll('.side-nav [data-view]').forEach(btn => btn.classList.toggle('active', btn.dataset.view === view));
  $('#breadcrumb-current').textContent = rootNames[view] || 'Обзор';
  $('#today').textContent = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
  for (const kind of ['knowledge','cases','access']) $(`#nav-${kind}-count`).textContent = entriesFor(kind).length;
  $('#export-button').hidden = db.cloud; $('#import-button').hidden = db.cloud;
  $('#logout-button')?.remove();
  if (db.cloud && db.session && !db.needsPassword) { const btn = document.createElement('button'); btn.id = 'logout-button'; btn.className = 'sidebar-action'; btn.textContent = '↪  Выйти из аккаунта'; $('.sidebar-bottom').prepend(btn); }
  if (showApp) syncRoute();
  hydrateImages($('#content'));
  if ($('#comments-panel')) loadComments();
}
function go(next, sec = null) { if (db.cloud && (!db.session || db.needsPassword)) return; view = next; sectionId = sec; selectedId = null; query = ''; tagFilter = ''; statusFilter = ''; pinnedOnly = false; versions = null; render(); }
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
function openEditor(kind, id = null) {
  if (!activeAdmin()) return;
  const item = db.entries.find(e => e.id === id) || {};
  const privateParent = item.section_id && ancestors(db.sections.find(s => s.id === item.section_id)).some(s => s.visibility === 'admins');
  editingId = id; editorKind = kind; pendingFiles = new Map();
  draftBlocks = (item.blocks || []).map(b => ({ ...b, client_id: uuid() }));
  $('#dialog-title').textContent = id ? 'Редактировать запись' : 'Новая запись';
  if (kind === 'access') {
    const program = canonicalProgram(item.tool) || 'AnyDesk';
    const selectedSection = item.section_id || (view === 'access' ? sectionId : null) || '';
    $('#editor-fields').innerHTML = `<div class="editor-top-grid">${field('title','Имя',item.title,{required:true,placeholder:'Например, сервер бухгалтерии'})}<label class="field"><span>Программа</span><select name="tool">${remotePrograms.map(p => `<option value="${p}" ${p === program ? 'selected' : ''}>${p}</option>`).join('')}</select></label>${field('remote_id','Адрес / ID подключения',item.remote_id,{required:true,placeholder:'192.168.1.10 или ID подключения'})}<label class="field"><span>Доступ</span><select name="visibility"><option value="all" ${item.visibility !== 'admins' && !privateParent ? 'selected' : ''}>Все читатели</option><option value="admins" ${item.visibility === 'admins' || privateParent ? 'selected' : ''}>Только администраторы</option></select></label><input type="hidden" name="section_id" value="${escapeHtml(selectedSection)}"></div><p class="muted">Для SSH: IP или имя сервера; можно указать user@host:port. По умолчанию порт 22.</p>`;
  } else {
  $('#editor-fields').innerHTML = `<div class="editor-top-grid">${field('title','Название',item.title,{required:true,placeholder:'Короткое понятное название'})}${field('summary','Краткое описание',item.summary,{placeholder:'О чём материал'})}<label class="field"><span>Раздел</span><select name="section_id">${sectionOptions(kind,item.section_id)}</select></label><label class="field"><span>Доступ</span><select name="visibility"><option value="all" ${item.visibility !== 'admins' && !privateParent ? 'selected' : ''}>Все читатели</option><option value="admins" ${item.visibility === 'admins' || privateParent ? 'selected' : ''}>Только администраторы</option></select></label></div>
  ${metadataEditor(item)}<div class="template-toolbar"><label class="field"><span>Шаблон</span><select id="entry-template">${Object.entries(features.templates).map(([key,t]) => `<option value="${key}">${t.name}</option>`).join('')}</select></label><button type="button" class="button-quiet" data-apply-template>Применить шаблон</button></div><div class="block-area"><div class="block-area-head"><div><strong>Содержание</strong><p>Соберите карточку из блоков в нужном порядке.</p></div></div><div id="blocks-list"></div><div class="block-toolbar">${Object.entries(blockNames).map(([type,label]) => `<button type="button" data-add-block="${type}">＋ ${label}</button>`).join('')}</div></div>`;
    renderBlocks();
  }
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
async function showHistory(id) {
  try { versions = await db.versions(id); const panel = $('#history-panel'); if (!panel) return;
    panel.innerHTML = `<div class="history-panel"><h2>История изменений</h2>${versions.length ? versions.map(v => `<div class="version-row"><div><strong>${escapeHtml(v.snapshot?.title || 'Без названия')}</strong><span>${dateTime(v.changed_at)} · ${escapeHtml(db.profiles.find(p => p.id === v.changed_by)?.email || (v.changed_by === 'local' ? 'Локальный редактор' : 'Администратор'))}</span></div><button class="button-quiet" data-restore="${escapeHtml(v.id)}">Восстановить</button></div>`).join('') : '<p class="muted">Предыдущих версий пока нет.</p>'}</div>`;
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
  const button = event.target.closest('button'); if (!button) return;
  if (button.id === 'theme-toggle') return theme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  if (button.dataset.view) return go(button.dataset.view);
  if (button.dataset.filterTag) { go(button.dataset.kind); tagFilter = button.dataset.filterTag; render(); return; }
  if (button.dataset.resetFilters !== undefined) { tagFilter = ''; statusFilter = ''; pinnedOnly = false; render(); return; }
  if (button.dataset.pinEntry) { try { const item = db.entries.find(e => e.id === button.dataset.pinEntry); await db.patchEntry(item.id,{pinned:!item.pinned}); render(); } catch(e) { toast(e.message); } return; }
  if (button.dataset.restoreEntry) { try { await db.restoreEntry(button.dataset.restoreEntry); render(); toast('Запись восстановлена'); } catch(e) { toast(e.message); } return; }
  if (button.dataset.applyTemplate !== undefined) { if (draftBlocks.length && !confirm('Заменить содержимое выбранным шаблоном?')) return; for (const b of draftBlocks) if (b.preview) URL.revokeObjectURL(b.preview); pendingFiles.clear(); draftBlocks = features.templateBlocks($('#entry-template').value).map(b => ({...b,client_id:uuid()})); renderBlocks(); return; }
  if (button.dataset.commentMore !== undefined) return loadComments(true);
  if (button.dataset.commentRefresh !== undefined) return loadComments();
  if (button.dataset.commentEdit) { const c = commentRows.find(c => c.id === button.dataset.commentEdit); if (!c) return; $('#comment-form [name=body]').value = c.body; $('#comment-form [name=comment_id]').value = c.id; $('#comment-cancel').hidden = false; $('#comment-form [name=body]').focus(); return; }
  if (button.id === 'comment-cancel') { $('#comment-form').reset(); button.hidden = true; return; }
  if (button.dataset.commentDelete) { if (!confirm('Удалить комментарий?')) return; try { await db.deleteComment(button.dataset.commentDelete); await loadComments(); } catch(e) { toast(e.message); } return; }
  if (button.dataset.section) { const kind = button.dataset.kind; view = kind; sectionId = button.dataset.section === 'all' ? null : button.dataset.section; selectedId = null; query = ''; render(); return; }
  if (button.dataset.open) { const item = db.entries.find(e => e.id === button.dataset.open && visibleEntry(e)); if (!item) return; selectedId = item.id; if (view !== 'drafts') view = item.type; versions = null; render(); return; }
  if (button.dataset.back !== undefined) { selectedId = null; render(); return; }
  if (button.dataset.create) return openEditor(button.dataset.create);
  if (button.id === 'new-button') return openEditor(['knowledge','cases','access'].includes(view) ? view : 'knowledge');
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
  if (button.dataset.copyRemote) { const item = db.entries.find(e => e.id === button.dataset.copyRemote && visibleEntry(e)); if (item) { try { await navigator.clipboard.writeText(item.remote_id || ''); toast('ID скопирован'); } catch { toast('Не удалось скопировать ID'); } } return; }
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
  const data = Object.fromEntries(new FormData(form).entries()); const old = db.entries.find(e => e.id === editingId);
  const id = editingId || uuid();
  const privateSection = db.sections.find(s => s.id === data.section_id);
  const forcedPrivate = privateSection && ancestors(privateSection).some(s => s.visibility === 'admins');
  const base = { ...features.normalizeEntry(old || {}), id, type: editorKind, section_id: data.section_id || null, title: data.title.trim(), summary: (data.summary || '').trim(), visibility: forcedPrivate ? 'admins' : data.visibility, tool: (data.tool || '').trim(), device: (data.device || '').trim(), remote_id: (data.remote_id || '').trim(), author_id: old?.author_id || db.user?.id || null };
  if (!base.title) return;
  if (editorKind === 'access') {
    base.summary = old?.summary || ''; base.device = old?.device || '';
    if (!remoteLink(base)) { toast('Проверьте программу и адрес / ID подключения'); return; }
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
    try { await db.login(data.email, data.password); render(); } catch (e) { toast('Ошибка входа: ' + e.message); } finally { btn.disabled = false; }
  }
  if (event.target.id === 'invite-form') {
    event.preventDefault(); const form = event.target; if (!form.reportValidity()) return; const btn = form.querySelector('button'); btn.disabled = true;
    try { await db.setInvitePassword(new FormData(form).get('password')); render(); toast('Пароль сохранён'); } catch (e) { toast(e.message); } finally { btn.disabled = false; }
  }
});
$('#export-button').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(db.exportLocal(),null,2)],{type:'application/json'}), url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = `WikiHMRU-${new Date().toISOString().slice(0,10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
});
$('#import-button').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', async event => { const file = event.target.files[0]; if (!file) return; try { const data = JSON.parse(await file.text()); if (!confirm('Заменить текущие локальные данные содержимым файла?')) return; db.importLocal(data); go('home'); toast('Копия загружена'); } catch (e) { toast(e.message); } finally { event.target.value = ''; } });
(async () => { try { await db.init(); render(); } catch (e) { render(); toast('Ошибка загрузки: ' + e.message); } })();
})();
