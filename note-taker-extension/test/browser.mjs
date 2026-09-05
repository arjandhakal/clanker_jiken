import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const fixture = await readFile('test/fixtures/article.html', 'utf8');
const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(fixture);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(join(tmpdir(), 'margin-test-'));
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium', headless: process.env.HEADED !== '1', viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce',
  args: [`--disable-extensions-except=${resolve('extension')}`, `--load-extension=${resolve('extension')}`],
});
const errors = [];
context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
await mkdir('target/screenshots', { recursive: true });
let currentPage;
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  const storage = () => worker.evaluate(async () => (await chrome.storage.local.get('annotations')).annotations || []);
  const send = (page, message) => page.evaluate(message => chrome.runtime.sendMessage(message), message);
  const library = await context.newPage(); currentPage = library;
  await library.goto(`chrome-extension://${extensionId}/library.html`);
  await expect(library.getByText('Leave yourself a little margin.')).toBeVisible();
  await library.screenshot({ path: 'target/screenshots/library-empty.png', fullPage: true });
  console.log('✓ Extension worker starts; library empty state renders under MV3 CSP');

  const article = await context.newPage(); currentPage = article;
  await article.goto(`${base}/article?chapter=1#first`);
  await expect(article.locator('#margin-extension-root')).toBeAttached();
  async function select(page, selector, text) {
    await page.locator(selector).scrollIntoViewIfNeeded();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.evaluate(({ selector, text }) => {
      const parent = document.querySelector(selector);
      const walker = document.createTreeWalker(parent, NodeFilter.SHOW_TEXT);
      const nodes = []; let node, joined = '';
      while ((node = walker.nextNode())) { nodes.push({node, start: joined.length}); joined += node.textContent; }
      const start = joined.indexOf(text), end = start + text.length;
      if (start < 0) throw new Error(`Missing test passage: ${text}`);
      const a = nodes.findLast(n => n.start <= start);
      const b = nodes.findLast(n => n.start < end);
      const range = document.createRange(); range.setStart(a.node, start-a.start); range.setEnd(b.node, end-b.start);
      getSelection().removeAllRanges(); getSelection().addRange(range);
      parent.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    }, { selector, text });
    await expect(page.locator('#toolbar')).toBeVisible();
  }
  const quote = 'Reading is a conversation with the world.';
  await select(article, '#first', quote);
  await article.screenshot({ path: 'target/screenshots/selection.png' });
  await article.locator('#toolbar').getByRole('button', { name: 'Note', exact: true }).click();
  await article.locator('#margin-note').fill('Learning happens when I slow down and ask better questions.');
  await article.locator('#editor').getByRole('button', { name: 'Sage', exact: true }).click();
  await article.locator('#save-note').click();
  await expect.poll(async () => (await storage()).length).toBe(1);
  let [saved] = await storage();
  assert.equal(saved.quote, quote); assert.equal(saved.color, 'green');
  assert.equal(saved['page-url'], `${base}/article?chapter=1`);
  await expect(library.locator('.note-card')).toHaveCount(1);
  console.log('✓ Cross-node selection toolbar, color, note save, and live library updates');

  await article.reload();
  await expect(article.locator('#margin-extension-root')).toBeAttached();
  // Hit testing a restored range proves restoration without depending on isolated-world globals.
  const point = await article.locator('#first').evaluate((el, quote) => {
    const range = document.createRange(), start = el.firstChild.textContent.indexOf(quote);
    range.setStart(el.firstChild, start); range.setEnd(el.firstChild, start+7);
    const rect = range.getClientRects()[0]; return {x: rect.x+8, y: rect.y+rect.height/2};
  }, quote);
  await article.waitForTimeout(500);
  await article.mouse.click(point.x, point.y);
  await expect(article.locator('#margin-note')).toHaveValue(saved.note);
  await article.screenshot({ path: 'target/screenshots/annotation.png' });
  await article.getByRole('button', {name:'Close note', exact:true}).click();
  assert.equal(await article.locator('mark').count(), 0, 'Restoration must not wrap or rewrite the article DOM');
  console.log('✓ Reload restores a clickable highlight without rewriting the page');

  await select(article, '#nested', 'A useful idea is only the beginning.');
  await article.locator('#toolbar').getByRole('button', {name:'Sunshine'}).click();
  await expect.poll(async () => (await storage()).length).toBe(2);
  assert.equal((await storage())[1].quote, 'A useful idea is only the beginning.');
  await select(article, '#last', 'Attention is a practice, not a destination.');
  await article.locator('#toolbar').getByRole('button', {name:'Sky'}).click();
  await expect.poll(async () => (await storage()).length).toBe(3);

  currentPage = library;
  await library.bringToFront();
  await expect(library.locator('.note-card')).toHaveCount(3);
  await library.getByRole('searchbox').fill('better questions');
  await expect(library.locator('.note-card')).toHaveCount(1);
  await library.getByRole('searchbox').fill('');
  await library.getByRole('button', {name:/With notes/}).click();
  await expect(library.locator('.note-card')).toHaveCount(1);
  await library.getByRole('button', {name:/All highlights/}).click();
  await library.getByRole('button', {name:'Sky', exact:true}).click();
  await expect(library.locator('.note-card')).toHaveCount(1);
  await library.getByRole('button', {name:'Clear color filter'}).click();
  await library.locator('.note-card.green').getByRole('button', {name:'Edit note', exact:true}).click();
  await library.locator('#edit-note').fill('Revised thought: read less, notice more.');
  await library.getByRole('button', {name:'Rose', exact:true}).last().click();
  await library.getByRole('button', {name:'Save note', exact:true}).click();
  await expect(library.locator('.note-card.pink')).toContainText('Revised thought');
  await library.screenshot({path:'target/screenshots/library.png', fullPage:true});
  await library.getByRole('button', {name:'List view', exact:true}).click();
  await expect(library.locator('.cards.list')).toBeVisible();
  await library.getByRole('button', {name:'Grid view', exact:true}).click();
  console.log('✓ Search, note/color filters, editing, and both library layouts');

  const opened = context.waitForEvent('page');
  await library.locator('.note-card.blue').getByRole('button', {name:'Open original passage'}).click();
  const revisit = await opened; currentPage = revisit;
  await expect(revisit.locator('#editor')).toBeVisible({timeout:15000});
  await expect(revisit.locator('#editor blockquote')).toHaveText('Attention is a practice, not a destination.');
  await expect.poll(() => revisit.evaluate(() => window.scrollY)).toBeGreaterThan(500);
  console.log('✓ Revisit opens the source, scrolls to the exact passage, and shows its note');

  // Re-anchor after text nodes are replaced and whitespace changes.
  await revisit.getByRole('button', {name:'Close note',exact:true}).click();
  await revisit.locator('#last').evaluate(el => { el.textContent = 'A new preface. Attention is a   practice, not a destination. Every small observation matters.'; });
  await revisit.waitForTimeout(900);
  const changedPointFor = () => revisit.locator('#last').evaluate(el => {
    const range = document.createRange(), start = el.firstChild.textContent.indexOf('Attention');
    range.setStart(el.firstChild,start); range.setEnd(el.firstChild,start+9);
    const rect = range.getClientRects()[0]; return {x:rect.x+8,y:rect.y+rect.height/2};
  });
  let changedPoint = await changedPointFor();
  await revisit.mouse.click(changedPoint.x,changedPoint.y);
  await expect(revisit.locator('#editor blockquote')).toHaveText('Attention is a practice, not a destination.');
  await revisit.getByRole('button', {name:'Close note',exact:true}).click();
  await revisit.evaluate(() => history.pushState({},'', '/another-article'));
  await revisit.waitForTimeout(1200);
  await revisit.mouse.click(changedPoint.x,changedPoint.y);
  await expect(revisit.locator('#editor')).toHaveCount(0);
  await revisit.evaluate(() => history.back());
  await revisit.waitForTimeout(1200);
  await revisit.locator('#last').scrollIntoViewIfNeeded();
  changedPoint = await changedPointFor();
  await revisit.mouse.click(changedPoint.x,changedPoint.y);
  await expect(revisit.locator('#editor')).toBeVisible();
  await revisit.getByRole('button', {name:'Close note',exact:true}).click();
  console.log('✓ Dynamic text replacement, whitespace fallback, and History API navigation');

  const missing = await send(library, {op:'create',annotation:{...saved,url:`${base}/missing`,quote:'This passage was removed from the source.',note:'Still safely saved.'}});
  assert.equal(missing.ok,true);
  const missingPagePromise = context.waitForEvent('page');
  assert.equal((await send(library,{op:'open',id:missing.data.id})).ok,true);
  const missingPage = await missingPagePromise; currentPage = missingPage;
  await expect(missingPage.locator('#editor')).toBeVisible({timeout:12000});
  await expect(missingPage.locator('#message')).toContainText('could not be located');
  await expect(missingPage.locator('#margin-note')).toHaveValue('Still safely saved.');
  await send(library,{op:'delete',id:missing.data.id});
  await missingPage.close();
  console.log('✓ Removed source passage gives an honest fallback while keeping the saved note');

  currentPage = library;
  await library.bringToFront();
  await library.locator('summary').click();
  const downloadPromise = library.waitForEvent('download');
  await library.getByRole('button', {name:'JSON backup', exact:true}).click();
  const download = await downloadPromise;
  const backupPath = 'target/roundtrip.json'; await download.saveAs(backupPath);
  const backup = JSON.parse(await readFile(backupPath, 'utf8'));
  assert.equal(backup.version, 1); assert.equal(backup.annotations.length, 3);
  await library.locator('#import-file').setInputFiles(backupPath);
  await expect(library.locator('#toast')).toContainText('Imported 0 highlights');
  const malicious = await send(library, {op:'import',backup:{version:1,annotations:[{...saved,id:'evil',url:'javascript:alert(1)'}]}});
  assert.equal(malicious.ok, false); assert.equal((await storage()).length,3);
  const unsafeText = '<img src=x onerror="window.__marginXSS=true">';
  const literal = await send(library,{op:'create',annotation:{...saved,title:unsafeText,quote:unsafeText,note:unsafeText}});
  await expect(library.locator('.note-card').filter({hasText:unsafeText})).toBeVisible();
  assert.equal(await library.locator('.note-card img').count(),0);
  assert.equal(await library.evaluate(() => !!window.__marginXSS),false);
  await send(library,{op:'delete',id:literal.data.id});
  const staleUpdate = await send(library,{op:'update',id:literal.data.id,patch:{note:'Do not resurrect a deleted note'}});
  assert.equal(staleUpdate.ok,false);
  const concurrent = await library.evaluate(sample => Promise.all(Array.from({length:12},(_,i) => chrome.runtime.sendMessage({op:'create', annotation:{...sample,note:`Concurrent ${i}`}}))), saved);
  assert.ok(concurrent.every(result => result.ok));
  assert.equal((await storage()).length, 15);
  // Clean temporary stress-test records without directly bypassing the write queue.
  await Promise.all(concurrent.map(result => send(library,{op:'delete',id:result.data.id})));
  await expect(library.locator('.note-card')).toHaveCount(3);
  console.log('✓ JSON round-trip, unsafe URL/XSS protection, stale-update rejection, and 12 concurrent saves');

  await library.locator('.note-card.yellow').getByRole('button',{name:'Edit note',exact:true}).click();
  library.once('dialog',dialog=>dialog.accept());
  await library.getByRole('button',{name:'Delete',exact:true}).click();
  await expect(library.locator('.note-card')).toHaveCount(2);
  await library.setViewportSize({width:520,height:900});
  await library.screenshot({path:'target/screenshots/library-mobile.png',fullPage:true});
  assert.equal(await library.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
  const popup = await context.newPage(); currentPage = popup;
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(popup.getByRole('button',{name:'Open your library'})).toBeVisible();
  await popup.setViewportSize({width:380,height:620});
  await popup.screenshot({path:'target/screenshots/popup.png',fullPage:true});
  console.log('✓ Delete, responsive library, and popup');
  assert.deepEqual(errors, [], 'No uncaught browser errors');
  console.log('\nAll browser checks passed. Screenshots: target/screenshots/');
} catch (error) {
  if (currentPage && !currentPage.isClosed()) await currentPage.screenshot({path:'target/screenshots/failure.png',fullPage:true}).catch(()=>{});
  console.error('Browser errors:', errors);
  throw error;
} finally {
  await context.close(); server.close(); await rm(profile,{recursive:true,force:true});
}
