// Browser smoke tests use isolated local data and a mocked reader session.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const base = process.env.WIKI_TEST_URL || 'http://127.0.0.1:8765/WikiHMRU/';
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', dialog => dialog.accept());
  await page.route('**/WikiHMRU/**', route => route.request().isNavigationRequest() ? route.fulfill({contentType:'text/html',body:fs.readFileSync('index.html','utf8')}) : route.continue());
  await page.route('**/config.js*', route => route.fulfill({ contentType: 'application/javascript', body: 'window.WIKI_CONFIG={};' }));
  try {
    await page.goto(base);
    await page.locator('#sidebar-toggle').click();
    assert.equal(await page.locator('#sidebar-toggle').getAttribute('aria-expanded'), 'true');
    await page.locator('#sidebar-toggle').click();
    assert.equal(await page.locator('#sidebar-toggle').getAttribute('aria-expanded'), 'false');
    await page.locator('#new-button').click();
    await page.locator('[data-choose-topic=access]').click();
    assert.equal(await page.locator('#editor-form [name=section_id]').count(), 1);
    await page.locator('#editor-form [name=entry_type]').selectOption('knowledge');
    assert.equal(await page.locator('#editor-form #blocks-list').count(), 1);
    await page.locator('#cancel-dialog').click();
    await page.locator('.side-nav [data-view=knowledge]').click();
    assert(new URL(page.url()).pathname.endsWith('/base/'));
    for (const q of ['прин', 'принтр', 'ghbyn', 'п']) { await page.locator('#top-search').fill(q); await page.locator('#search-suggestions [role=option]').filter({hasText:'Принтер не печатает'}).waitFor(); }
    await page.locator('#top-search').press('Escape');
    await page.locator('[data-create=knowledge]').first().click();
    await page.locator('#entry-template').selectOption('troubleshooting');
    await page.locator('[data-apply-template]').click();
    assert.equal(await page.locator('.block-editor').count(), 8);
    await page.locator('#editor-form [name=title]').fill('Черновик инструкции GLPI');
    await page.locator('#editor-form [name=tags]').fill('Печать, Windows');
    await page.locator('#editor-form [name=glpi_ticket_ids]').fill('8487, #8490');
    await page.locator('#editor-form [name=relevance]').selectOption('review');
    await page.locator('#editor-form [name=pinned]').check();
    await page.locator('.related-picker summary').click();
    await page.locator('#related-options [name=related_ids]').first().check();
    await page.locator('#save-draft-button').click();
    await page.getByRole('heading', { name: 'Черновик инструкции GLPI', exact: true, level: 1 }).waitFor();
    assert.equal(await page.evaluate(() => wikiStore.entries.find(e => e.title === 'Черновик инструкции GLPI').publication_state), 'draft');
    await page.locator('.side-nav [data-view=admin]').click();
    await page.locator('[data-reader-preview]').click();
    await page.locator('.side-nav [data-view=knowledge]').click();
    assert.equal(await page.locator('.entry-card').filter({ hasText: 'Черновик инструкции GLPI' }).count(), 0);
    await page.locator('.side-nav [data-view=home]').click();
    await page.locator('[data-exit-preview]').click();
    await page.locator('.side-nav [data-view=drafts]').click();
    await page.locator('.entry-card').filter({ hasText: 'Черновик инструкции GLPI' }).click();
    await page.locator('[data-edit-entry]').click();
    await page.locator('#save-entry-button').click();
    await page.locator('#editor-dialog').waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => wikiStore.entries.find(e => e.title === 'Черновик инструкции GLPI').publication_state), 'published');
    assert.equal(await page.locator('a.ticket-chip').first().getAttribute('href'), 'https://helpdesk.hmru.ru:8080/front/ticket.form.php?id=8487');
    assert.equal(await page.locator('.related-materials .entry-card').count(), 1);
    await page.locator('#comment-form [name=body]').fill('<img src=x onerror=alert(1)> Дополнение');
    await page.locator('#comment-form [type=submit]').click();
    await page.locator('.comment').waitFor();
    assert.equal(await page.locator('.comment img').count(), 0);
    await page.locator('[data-comment-edit]').click();
    await page.locator('#comment-form [name=body]').fill('Проверенное дополнение');
    await page.locator('#comment-form [type=submit]').click();
    await page.getByText('Проверенное дополнение', { exact: true }).waitFor();
    assert(new URL(page.url()).pathname.includes('/base/record/'));
    await page.reload();
    await page.getByText('Проверенное дополнение', { exact: true }).waitFor();
    await page.locator('[data-back]').click();
    await page.locator('[data-tag-filter]').selectOption('windows');
    assert.equal(await page.locator('#list-results .entry-card').count(), 1);
    await page.locator('[data-status-filter]').selectOption('verified');
    assert.equal(await page.locator('#list-results .entry-card').count(), 0);
    await page.locator('[data-reset-filters]').click();
    await page.locator('#list-search').fill('8487');
    assert.equal(await page.locator('#list-results .entry-card').count(), 1);
    await page.locator('#list-results .entry-card').click();
    await page.locator('[data-delete-entry]').click();
    await page.locator('.side-nav [data-view=trash]').click();
    await page.locator('[data-restore-entry]').click();
    assert.equal(await page.locator('.trash-card').count(), 0);
    await page.locator('.side-nav [data-view=knowledge]').click();
    await page.locator('.entry-card').filter({ hasText: 'Черновик инструкции GLPI' }).click();
    await page.getByText('Проверенное дополнение', { exact: true }).waitFor();
    assert.equal(await page.locator('a.ticket-chip').count(), 2);
    await page.locator('[data-comment-delete]').click();
    await page.getByText('Комментариев пока нет.', { exact: false }).waitFor();
    await page.locator('.side-nav [data-view=access]').click();
    await page.locator('[data-create=access]').first().click();
    assert.equal(await page.locator('#editor-form select[name=tool] option').count(), 3);
    assert.equal(await page.locator('#editor-form [name=summary]').count(), 0);
    assert.equal(await page.locator('#editor-form #blocks-list').count(), 0);
    await page.locator('#cancel-dialog').click();
    for (const [program, id, href] of [['AnyDesk','123 456 789','anydesk:123456789'],['RuDesktop','987 654 321','wikihmru-rudesktop:987654321'],['Терминал','admin@192.168.1.20:22','wikihmru-terminal:admin%40192.168.1.20%3A22']]) {
      await page.locator('#new-button').click();
      await page.locator('[data-choose-topic=access]').click();
      await page.locator('#editor-form [name=title]').fill('Подключение ' + program);
      await page.locator('#editor-form [name=tool]').selectOption(program);
      await page.locator('#editor-form [name=remote_id]').fill(id);
      await page.locator('#save-entry-button').click();
      await page.locator('#editor-dialog').waitFor({state:'hidden'});
      assert.equal(await page.locator('.workspace-detail [data-launch-remote]').getAttribute('href'),href);
      assert.equal(await page.locator('.remote-card').filter({hasText:'Подключение ' + program}).locator('[data-launch-remote]').getAttribute('href'),href);
    }
    await page.locator('.remote-setup summary').click();
    const downloadEvent = page.waitForEvent('download');
    await page.locator('[data-download-launcher]').click();
    const download = await downloadEvent;
    assert.equal(download.suggestedFilename(),'WikiHMRU-Terminal.ps1');
    const setup = fs.readFileSync(await download.path(),'utf8');
    assert(setup.includes("[string]$Program = 'Terminal',"));
    assert(setup.includes("$arguments = @('--connect', $target.TrimEnd('/'))"));
    await page.locator('.side-nav [data-view=knowledge]').click();
    for (const selector of ['.top-search','.search-wrap']) {
      const delta = await page.locator(selector).first().evaluate(el => {
        const svg = el.querySelector('.search-icon svg').getBoundingClientRect(), input = el.querySelector('input').getBoundingClientRect();
        return Math.abs(svg.y+svg.height/2-input.y-input.height/2);
      });
      assert(delta <= 1,'Search icon is not vertically centered: ' + delta);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.side-nav [data-view=knowledge]').click();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Mobile layout overflows');
    assert.deepEqual(errors, []);
    await context.close();

    const readerContext = await browser.newContext();
    const reader = await readerContext.newPage();
    const readerId = '11111111-1111-4111-8111-111111111111';
    const articleId = '22222222-2222-4222-8222-222222222222';
    let comments = [{ id: '33333333-3333-4333-8333-333333333333', entry_id: articleId, author_id: 'other', author_name: 'Коллега', body: 'Чужой комментарий', created_at: '2026-01-01T10:00:00Z', updated_at: '2026-01-01T10:00:00Z' }];
    await reader.addInitScript(() => sessionStorage.setItem('wikihmru-session-v1', JSON.stringify({ access_token: 'test', refresh_token: 'test' })));
    await reader.route('**/config.js*', route => route.fulfill({ contentType: 'application/javascript', body: "window.WIKI_CONFIG={supabaseUrl:'https://mock.supabase.co',supabaseAnonKey:'public-test'};" }));
    await reader.route('https://mock.supabase.co/**', async route => {
      const request = route.request(), url = new URL(request.url());
      let result;
      if (url.pathname.includes('/auth/v1/token') && request.postDataJSON()?.password === 'wrong-password') return route.fulfill({status:400,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({code:'invalid_credentials',msg:'Invalid login credentials'})});
      if (url.pathname.includes('/auth/v1/token')) result = { access_token: 'test', refresh_token: 'test' };
      else if (url.pathname === '/auth/v1/logout') result = null;
      else if (url.pathname === '/auth/v1/user') result = { id: readerId };
      else if (url.pathname === '/rest/v1/profiles') result = [{ id: readerId, email: 'reader@example.invalid', role: 'reader' }];
      else if (url.pathname === '/rest/v1/sections') result = [];
      else if (url.pathname === '/rest/v1/wiki_settings') result = [{ glpi_ticket_url_template: 'https://helpdesk.hmru.ru:8080/front/ticket.form.php?id={id}' }];
      else if (url.pathname === '/rest/v1/entries') result = [
        { id: articleId, title: 'Открытая статья', type: 'knowledge', visibility: 'all', blocks: [], updated_at: '2026-01-01T10:00:00Z' },
        { id: 'draft', title: 'Скрытый черновик', type: 'knowledge', visibility: 'all', publication_state: 'draft', blocks: [] },
        { id: 'trash', title: 'Скрытая корзина', type: 'knowledge', visibility: 'all', deleted_at: '2026-01-01T10:00:00Z', blocks: [] },
        { id: 'private', title: 'Закрытая статья', type: 'knowledge', visibility: 'admins', blocks: [] }
      ];
      else if (url.pathname === '/rest/v1/entry_comments') {
        if (request.method() === 'POST') {
          const data = request.postDataJSON(); assert.equal(data.author_id,readerId); assert.equal(data.entry_id,articleId);
          comments.unshift({ ...data, author_name:'Читатель', created_at:'2026-01-02T10:00:00Z', updated_at:'2026-01-02T10:00:00Z' }); result = null;
        } else result = comments;
      }
      else throw Error('Unexpected mock API: ' + url.pathname);
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers':'apikey,authorization,content-type', 'access-control-allow-methods':'GET,POST,PATCH,DELETE,OPTIONS' }, body: JSON.stringify(result) });
    });
    await reader.goto(base + '?view=knowledge');
    await reader.locator('.entry-card').waitFor();
    assert.equal(await reader.locator('.entry-card').count(), 1);
    assert.equal(await reader.locator('.side-nav [data-view=drafts]').isVisible(), false);
    await reader.locator('.entry-card').click();
    await reader.getByText('Чужой комментарий',{exact:true}).waitFor();
    assert.equal(await reader.locator('[data-comment-edit]').count(),0);
    await reader.locator('#comment-form [name=body]').fill('Комментарий читателя');
    await reader.locator('#comment-form [type=submit]').click();
    await reader.getByText('Комментарий читателя',{exact:true}).waitFor();
    assert.equal(await reader.locator('[data-comment-edit]').count(),1);
    await reader.locator('#sidebar-toggle').click();
    await reader.locator('#logout-button').click();
    await reader.locator('#login-form [name=email]').fill('reader@example.invalid');
    await reader.locator('#login-form [name=password]').fill('wrong-password');
    await reader.locator('#login-form [type=submit]').click();
    await reader.getByText('Неверный логин или пароль',{exact:true}).waitFor();
    await readerContext.close();
    console.log('PASS: templates, drafts, publication, tags, GLPI, related entries, comments, trash restore, mobile and reader UI');
  } catch (error) {
    fs.mkdirSync('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/failure.png', fullPage: true }).catch(() => {});
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
