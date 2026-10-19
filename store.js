(() => {
  'use strict';
  const cfg = window.WIKI_CONFIG || {};
  const features = window.wikiFeatures;
  const cloud = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey);
  const base = String(cfg.supabaseUrl || '').replace(/\/$/, '');
  const SESSION_KEY = 'wikihmru-session-v1';
  const ENTRIES_KEY = 'opora-v2-entries';
  const SECTIONS_KEY = 'opora-v2-sections';
  const HISTORY_KEY = 'opora-v2-history';
  const COMMENTS_KEY = 'wikihmru-comments-v1';
  const SETTINGS_KEY = 'wikihmru-settings-v1';
  const makeId = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const read = (key) => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
  const readSession = () => { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch { return null; } };
  localStorage.removeItem('opora-session-v1');
  const store = {
    cloud, role: cloud ? 'reader' : 'admin', session: readSession(), user: null,
    needsPassword: false, entries: [], sections: [], profiles: [], history: [],
    imageUrls: new Map(), comments: [], settings: { glpi_ticket_url_template: features.glpiDefault },
    isAdmin() { return this.role === 'admin'; },
    saveLocal() {
      localStorage.setItem(ENTRIES_KEY, JSON.stringify(this.entries));
      localStorage.setItem(SECTIONS_KEY, JSON.stringify(this.sections));
      localStorage.setItem(HISTORY_KEY, JSON.stringify(this.history));
      localStorage.setItem(COMMENTS_KEY, JSON.stringify(this.comments));
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    },
    async api(path, options = {}, auth = true, retry = true) {
      const headers = { apikey: cfg.supabaseAnonKey, 'Content-Type': 'application/json', ...options.headers };
      if (auth && this.session?.access_token) headers.Authorization = `Bearer ${this.session.access_token}`;
      const response = await fetch(base + path, { ...options, headers });
      let data = null;
      try { data = await response.json(); } catch { /* empty response */ }
      if (response.status === 401 && auth && retry && await this.refresh()) return this.api(path, options, auth, false);
      if (!response.ok) { const error = Error(data?.msg || data?.error_description || data?.message || `Ошибка сервера: ${response.status}`); error.code = data?.code || data?.error_code; error.status = response.status; throw error; }
      return data;
    },
    async refresh() {
      if (!this.session?.refresh_token) return false;
      try {
        this.session = await this.api('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: this.session.refresh_token }) }, false);
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(this.session));
        return true;
      } catch {
        this.session = null; this.user = null; this.role = 'reader'; sessionStorage.removeItem(SESSION_KEY);
        return false;
      }
    },
    async init() {
      if (!cloud) {
        const names = {
          knowledge: ['Телефония', 'Интернет', 'МФУ и принтеры', 'Битрикс', '1С', 'Прочее'],
          cases: ['Телефония', 'Интернет', 'МФУ и принтеры', 'Битрикс', '1С', 'Прочее'],
          access: ['Рабочие станции', 'Серверы', 'Прочее']
        };
        this.sections = read(SECTIONS_KEY) || Object.entries(names).flatMap(([kind, list]) => list.map((title, i) => ({ id: makeId(), kind, title, parent_id: null, visibility: 'all', sort_order: i + 1 })));
        const old = read('opora-entries-v1');
        this.entries = read(ENTRIES_KEY) || (Array.isArray(old) ? old.map((item) => this.convertOld(item)) : [
          { id: makeId(), type: 'knowledge', title: 'Принтер не печатает', summary: 'Базовая диагностика печати.', section_id: this.sections.find(s => s.kind === 'knowledge' && s.title === 'МФУ и принтеры')?.id, visibility: 'all', blocks: [{ type: 'heading', text: 'Проверка' }, { type: 'text', text: 'Проверьте питание, подключение, выбранный принтер и очередь печати.' }, { type: 'heading', text: 'Решение' }, { type: 'text', text: 'Очистите зависшую очередь и напечатайте тестовую страницу. Зафиксируйте код ошибки, если проблема повторится.' }], updated_at: new Date().toISOString() }
        ]);
        this.entries = this.entries.map(features.normalizeEntry);
        this.comments = read(COMMENTS_KEY) || [];
        this.settings = read(SETTINGS_KEY) || { glpi_ticket_url_template: features.glpiDefault };
        this.history = read(HISTORY_KEY) || [];
        this.saveLocal();
        return;
      }
      const hash = new URLSearchParams(location.hash.slice(1));
      if (hash.get('type') === 'invite' && hash.get('access_token')) {
        this.session = { access_token: hash.get('access_token'), refresh_token: hash.get('refresh_token') };
        this.needsPassword = true;
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(this.session));
        history.replaceState(null, '', location.pathname + location.search);
        return;
      }
      if (!this.session) return;
      if (await this.refresh()) await this.load();
    },
    convertOld(item) {
      const blocks = item.blocks || [
        item.problem && { type: 'heading', text: 'Проблема' }, item.problem && { type: 'text', text: item.problem },
        item.diagnosis && { type: 'heading', text: 'Диагностика' }, item.diagnosis && { type: 'text', text: item.diagnosis },
        item.solution && { type: 'heading', text: 'Решение' }, item.solution && { type: 'text', text: item.solution },
        item.notes && { type: 'heading', text: 'Дополнительно' }, item.notes && { type: 'text', text: item.notes }
      ].filter(Boolean);
      return { ...item, section_id: this.sections.find(s => s.kind === item.type && s.title === item.category)?.id || null, visibility: 'all', blocks };
    },
    async login(email, password) {
      this.session = await this.api('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email, password }) }, false);
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(this.session));
      await this.load();
    },
    async setInvitePassword(password) {
      await this.api('/auth/v1/user', { method: 'PUT', body: JSON.stringify({ password }) });
      this.needsPassword = false;
      await this.load();
    },
    async logout() {
      if (cloud && this.session) { try { await this.api('/auth/v1/logout', { method: 'POST' }); } catch { /* local sign out still applies */ } }
      for (const url of this.imageUrls.values()) URL.revokeObjectURL(url);
      this.imageUrls.clear();
      this.session = null; this.user = null; this.role = cloud ? 'reader' : 'admin';
      this.entries = []; this.sections = []; this.profiles = []; this.comments = []; this.settings = {};
      sessionStorage.removeItem(SESSION_KEY);
    },
    async load() {
      if (!cloud) return;
      this.user = await this.api('/auth/v1/user');
      const [profiles, sections, entries, settings] = await Promise.all([
        this.api(`/rest/v1/profiles?select=id,email,role&order=email.asc`),
        this.api('/rest/v1/sections?select=*&order=sort_order.asc,title.asc'),
        this.api('/rest/v1/entries?select=*&order=updated_at.desc'),
        this.api('/rest/v1/wiki_settings?id=eq.1&select=glpi_ticket_url_template')
      ]);
      this.profiles = profiles;
      this.role = profiles.find(p => p.id === this.user.id)?.role || 'reader';
      this.sections = sections;
      this.entries = entries.map(e => features.normalizeEntry({ ...e, blocks: e.blocks || [] }));
      this.settings = settings[0] || { glpi_ticket_url_template: '' };
    },
    async saveEntry(item) {
      if (!this.isAdmin()) throw Error('Недостаточно прав');
      item = features.normalizeEntry({ ...this.entries.find(e => e.id === item.id), ...item });
      item.tags = features.parseTags(item.tags); item.glpi_ticket_ids = features.parseTickets(item.glpi_ticket_ids);
      const fields = ['id', 'type', 'section_id', 'title', 'summary', 'visibility', 'blocks', 'device', 'tool', 'remote_id', 'author_id', 'pinned', 'tags', 'publication_state', 'relevance', 'related_ids', 'glpi_ticket_ids', 'deleted_at', 'region', 'remote_connections'];
      const record = Object.fromEntries(fields.map(key => [key, item[key] ?? (['blocks','remote_connections'].includes(key) ? [] : key === 'region' ? '' : null)]));
      record.author_id = item.author_id || this.user?.id || null;
      if (!cloud) {
        const old = this.entries.find(e => e.id === item.id);
        if (old) this.history.unshift({ id: makeId(), entry_id: item.id, snapshot: structuredClone(old), changed_at: new Date().toISOString(), changed_by: 'local', action: 'UPDATE' });
        const next = { ...old, ...record, created_at: old?.created_at || new Date().toISOString(), updated_at: new Date().toISOString() };
        this.entries = [next, ...this.entries.filter(e => e.id !== item.id)]; this.saveLocal(); return;
      }
      const exists = this.entries.some(e => e.id === item.id);
      await this.api('/rest/v1/entries' + (exists ? `?id=eq.${encodeURIComponent(item.id)}` : ''), { method: exists ? 'PATCH' : 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(record) });
      await this.load();
    },
    async importAccess(items) {
      if (!this.isAdmin() || !items.length || items.length > 500 || items.some(e=>e.type !== 'access')) throw Error('Недостаточно прав или неверный список записей');
      const records=items.map(e=>features.normalizeEntry(e));
      if (!cloud) { for (const e of records) await this.saveEntry(e); return; }
      const saved=await this.api('/rest/v1/entries',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(records)});
      this.entries=[...saved.map(features.normalizeEntry),...this.entries];
    },
    async patchEntry(id, patch) {
      if (!this.isAdmin()) throw Error('Недостаточно прав');
      const item = this.entries.find(e => e.id === id);
      if (!item) throw Error('Запись недоступна');
      if (!cloud) return this.saveEntry({ ...item, ...patch });
      await this.api(`/rest/v1/entries?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch) });
      await this.load();
    },
    async deleteEntry(id) { return this.patchEntry(id, { deleted_at: new Date().toISOString() }); },
    async restoreEntry(id) { return this.patchEntry(id, { deleted_at: null }); },
    async purgeEntry(id) {
      if (!this.isAdmin()) throw Error('Недостаточно прав');
      const item=this.entries.find(e=>e.id===id && e.deleted_at);
      if (!item) throw Error('Окончательно удалить можно только запись из корзины');
      if (!cloud) { this.entries=this.entries.filter(e=>e.id!==id);this.history=this.history.filter(v=>v.entry_id!==id);this.comments=this.comments.filter(c=>c.entry_id!==id);this.saveLocal();return; }
      const removed=await this.api('/rest/v1/rpc/purge_wiki_entry',{method:'POST',body:JSON.stringify({target_id:id})});
      if (!removed) throw Error('Запись уже восстановлена или удалена. Обновите страницу');
      this.entries=this.entries.filter(e=>e.id!==id);
      try {
        let paths=[], offset=0;
        while(true){const page=await this.api('/storage/v1/object/list/wiki-images',{method:'POST',body:JSON.stringify({prefix:id+'/',limit:1000,offset,sortBy:{column:'name',order:'asc'}})});paths.push(...page.filter(f=>f.id && f.name).map(f=>id+'/'+f.name));if(page.length<1000)break;offset+=1000;}
        for(let i=0;i<paths.length;i+=100)await this.api('/storage/v1/object/wiki-images',{method:'DELETE',body:JSON.stringify({prefixes:paths.slice(i,i+100)})});
        for (const [path,url] of this.imageUrls) if(path.startsWith(id+'/')){URL.revokeObjectURL(url);this.imageUrls.delete(path);}
      } catch { return 'Запись удалена, но не удалось очистить её фото в хранилище'; }
    },
    async commentsFor(entryId, offset = 0) {
      if (!cloud) return this.comments.filter(c => c.entry_id === entryId).sort((a,b) => b.created_at.localeCompare(a.created_at)).slice(offset, offset + 51);
      return this.api(`/rest/v1/entry_comments?entry_id=eq.${encodeURIComponent(entryId)}&select=*&order=created_at.desc,id.asc&limit=51&offset=${offset}`);
    },
    async saveComment(entryId, body, id = null) {
      body = String(body || '').trim();
      if (!body || body.length > 4000) throw Error('Комментарий: от 1 до 4000 символов');
      if (!this.entries.some(e => e.id === entryId && e.type !== 'access' && !e.deleted_at)) throw Error('Статья недоступна');
      const author = this.user?.id || 'local';
      if (!cloud) {
        const old = this.comments.find(c => c.id === id);
        if (id && (!old || old.entry_id !== entryId || (old.author_id !== author && !this.isAdmin()))) throw Error('Недостаточно прав');
        const now = new Date().toISOString();
        const comment = { ...old, id: id || makeId(), entry_id: entryId, author_id: old?.author_id || author, author_name: old?.author_name || 'Локальный участник', body, created_at: old?.created_at || now, updated_at: now };
        this.comments = [comment, ...this.comments.filter(c => c.id !== comment.id)]; this.saveLocal(); return;
      }
      await this.api('/rest/v1/entry_comments' + (id ? `?id=eq.${encodeURIComponent(id)}&entry_id=eq.${encodeURIComponent(entryId)}` : ''), { method: id ? 'PATCH' : 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(id ? { body } : { id: makeId(), entry_id: entryId, author_id: author, body }) });
    },
    async deleteComment(id) {
      if (!cloud) {
        const old = this.comments.find(c => c.id === id);
        if (!old || (old.author_id !== (this.user?.id || 'local') && !this.isAdmin())) throw Error('Недостаточно прав');
        this.comments = this.comments.filter(c => c.id !== id); this.saveLocal(); return;
      }
      await this.api(`/rest/v1/entry_comments?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
    async saveSettings(template) {
      if (!this.isAdmin()) throw Error('Недостаточно прав');
      template = features.validateGlpiTemplate(template);
      if (cloud) await this.api('/rest/v1/wiki_settings?id=eq.1', { method: 'PATCH', body: JSON.stringify({ glpi_ticket_url_template: template }) });
      this.settings = { glpi_ticket_url_template: template };
      if (!cloud) this.saveLocal();
    },
    async saveSection(section) {
      if (!this.isAdmin()) throw Error('Недостаточно прав');
      const record = { id: section.id, kind: section.kind, parent_id: section.parent_id || null, title: section.title, visibility: section.visibility, sort_order: section.sort_order || 0 };
      if (!cloud) { this.sections = [record, ...this.sections.filter(s => s.id !== record.id)]; this.saveLocal(); return; }
      const exists = this.sections.some(s => s.id === record.id);
      await this.api('/rest/v1/sections' + (exists ? `?id=eq.${encodeURIComponent(record.id)}` : ''), { method: exists ? 'PATCH' : 'POST', body: JSON.stringify(record) });
      await this.load();
    },
    async deleteSection(id) {
      if (!this.isAdmin()) throw Error('Недостаточно прав');
      if (this.sections.some(s => s.parent_id === id)) throw Error('Сначала удалите или перенесите вложенные разделы');
      if (this.entries.some(e => e.section_id === id)) throw Error('Сначала перенесите записи из раздела');
      if (!cloud) { this.sections = this.sections.filter(s => s.id !== id); this.saveLocal(); return; }
      await this.api(`/rest/v1/sections?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
      await this.load();
    },
    async updateRole(id, role) {
      if (!this.isAdmin() || !cloud) throw Error('Недостаточно прав');
      await this.api(`/rest/v1/profiles?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ role }) });
      await this.load();
    },
    async versions(id) {
      if (!this.isAdmin()) return [];
      if (!cloud) return this.history.filter(v => v.entry_id === id).sort((a, b) => new Date(b.changed_at) - new Date(a.changed_at));
      return this.api(`/rest/v1/entry_versions?select=*&entry_id=eq.${encodeURIComponent(id)}&order=changed_at.desc,id.desc`);
    },
    async uploadImage(entryId, file) {
      if (!this.isAdmin()) throw Error('Недостаточно прав');
      if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) throw Error('Поддерживаются JPG, PNG, WebP и GIF');
      if (file.size > 10 * 1024 * 1024) throw Error('Фото должно быть меньше 10 МБ');
      if (!cloud) {
        if (file.size > 1.5 * 1024 * 1024) throw Error('В локальном режиме фото должно быть меньше 1,5 МБ');
        return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
      }
      const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[file.type];
      const path = `${entryId}/${makeId()}.${ext}`;
      const response = await fetch(`${base}/storage/v1/object/wiki-images/${path}`, { method: 'POST', headers: { apikey: cfg.supabaseAnonKey, Authorization: `Bearer ${this.session.access_token}`, 'Content-Type': file.type, 'x-upsert': 'false' }, body: file });
      if (!response.ok) { let data = {}; try { data = await response.json(); } catch {} throw Error(data.message || `Загрузка фото: ${response.status}`); }
      return path;
    },
    async imageUrl(path) {
      if (!path) return '';
      if (path.startsWith('data:')) return path;
      if (this.imageUrls.has(path)) return this.imageUrls.get(path);
      const response = await fetch(`${base}/storage/v1/object/authenticated/wiki-images/${path}`, { headers: { apikey: cfg.supabaseAnonKey, Authorization: `Bearer ${this.session.access_token}` } });
      if (!response.ok) throw Error(`Фото недоступно: ${response.status}`);
      const url = URL.createObjectURL(await response.blob());
      this.imageUrls.set(path, url);
      return url;
    },
    exportLocal() { return { format: 'opora-v2', entries: this.entries, sections: this.sections, history: this.history, comments: this.comments, settings: this.settings }; },
    importLocal(data) {
      if (cloud) throw Error('Импорт доступен только в локальном режиме');
      if (data.format !== 'opora-v2' || !Array.isArray(data.entries) || !Array.isArray(data.sections)) throw Error('Неверный формат копии');
      this.entries = data.entries.map(features.normalizeEntry); this.sections = data.sections; this.comments = Array.isArray(data.comments) ? data.comments : []; this.settings = data.settings || { glpi_ticket_url_template: features.glpiDefault }; this.history = Array.isArray(data.history) ? data.history : [];
      this.saveLocal();
    }
  };
  window.wikiStore = store;
})();
