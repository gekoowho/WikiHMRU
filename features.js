(() => {
  'use strict';
  const relevance = { verified: 'Проверено', review: 'Нужно обновить', outdated: 'Устарело' };
  const templates = {
    blank: { name: 'Пустая статья', blocks: [] },
    troubleshooting: { name: 'Диагностика и решение', blocks: ['Симптомы', 'Проверка', 'Решение', 'Проверка результата'] },
    instruction: { name: 'Пошаговая инструкция', blocks: ['Когда применять', 'Подготовка', 'Порядок действий', 'Результат'] },
    incident: { name: 'Разбор сложного случая', blocks: ['Проблема', 'Что проверили', 'Причина', 'Решение', 'Как избежать повторения'] },
    checklist: { name: 'Чек-лист', blocks: ['Перед началом', 'Что проверить', 'Завершение'] }
  };
  function templateBlocks(name) {
    const selected = templates[name];
    if (!selected) throw Error('Неизвестный шаблон');
    return selected.blocks.flatMap(text => [{ type: 'heading', text }, { type: name === 'checklist' ? 'list' : 'text', text: '' }]);
  }
  function parseTags(value) {
    const parts = Array.isArray(value) ? value : String(value || '').split(',');
    const tags = [...new Set(parts.map(x => String(x).normalize('NFKC').trim().toLowerCase()).filter(Boolean))];
    if (tags.length > 20 || tags.some(t => t.length > 50)) throw Error('До 20 тегов, каждый не длиннее 50 символов');
    return tags;
  }
  function parseTickets(value) {
    const parts = Array.isArray(value) ? value : String(value || '').split(/[\s,;]+/);
    const ids = [...new Set(parts.map(x => String(x).replace(/^#/, '')).filter(Boolean))];
    if (ids.length > 20 || ids.some(x => !/^\d+$/.test(x) || !Number.isSafeInteger(Number(x)) || Number(x) < 1)) throw Error('Укажите до 20 номеров заявок GLPI через запятую');
    return ids.map(Number);
  }
  function normalizeEntry(entry) {
    return { pinned: false, tags: [], publication_state: 'published', relevance: 'verified', related_ids: [], glpi_ticket_ids: [], deleted_at: null, ...entry };
  }
  function validateGlpiTemplate(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    if (text.length > 2048 || (text.match(/\{id\}/g) || []).length !== 1) throw Error('Адрес GLPI должен содержать один маркер {id} вместо номера заявки');
    let url;
    try { url = new URL(text.replace('{id}', '1')); } catch { throw Error('Некорректный адрес GLPI'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || !url.hostname) throw Error('Укажите HTTP(S)-адрес GLPI без пароля');
    return text;
  }
  function ticketUrl(template, id) {
    try {
      const safe = validateGlpiTemplate(template);
      if (!safe || !Number.isSafeInteger(Number(id)) || Number(id) < 1) return '';
      return new URL(safe.replace('{id}', String(Number(id)))).href;
    } catch { return ''; }
  }
  window.wikiFeatures = { glpiDefault: 'https://helpdesk.hmru.ru:8080/front/ticket.form.php?id={id}', relevance, templates, templateBlocks, parseTags, parseTickets, normalizeEntry, validateGlpiTemplate, ticketUrl };
})();
