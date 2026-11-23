import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { chunkText, searchInventory, tokenize } from '../src/indexer.mjs';
import { editSection, resolveContentPath } from '../src/ingestion.mjs';
import { AutumnListeners } from '../src/listeners.mjs';

test('tokenizer keeps useful unique terms', () => {
  assert.deepEqual(tokenize('The Pearl and the pearl found Alvandare!'), ['pearl', 'found', 'alvandare']);
});

test('chunker preserves markdown section names', () => {
  const chunks = chunkText('# People\n\nCasper sees spirits.\n\n## Places\n\nAeternum is home.', 'guide.md', 200);
  assert.equal(chunks[0].section, 'People');
  assert.match(chunks[0].text, /Casper/);
  assert.equal(chunks[1].section, 'Places');
});

test('lookup prefers exact heading and phrase matches', () => {
  const inventory = { entries: [
    { id: 'a', path: 'one.md', section: 'Pearl', text: 'A ship.', keywords: ['pearl', 'ship'], sourceRank: 4, sourceTier: 'reference' },
    { id: 'b', path: 'two.md', section: 'Seed', text: 'The Alvandare seed was in the Pearl.', keywords: ['alvandare', 'seed', 'pearl'], sourceRank: 2, sourceTier: 'recap' }
  ] };
  assert.equal(searchInventory(inventory, 'Alvandare seed')[0].id, 'b');
});

test('section editor appends and replaces a selected section', () => {
  const original = '# One\n\nOld.\n\n# Two\n\nKeep.\n';
  const appended = editSection(original, { section: 'One', content: 'New.', mode: 'append' });
  assert.match(appended, /Old\.\n\nNew\./);
  assert.match(appended, /# Two\n\nKeep\./);
  const replaced = editSection(original, { section: 'One', content: 'Replacement.', mode: 'replace' });
  assert.doesNotMatch(replaced, /Old\./);
  assert.match(replaced, /# One\n\nReplacement\./);
});

test('ingestion path guard blocks traversal and application files', () => {
  const root = path.resolve('C:/archive');
  assert.throws(() => resolveContentPath(root, '../secret.md'), /not an editable|escaped/);
  assert.throws(() => resolveContentPath(root, 'src/server.mjs'), /not an editable|Only archive/);
  assert.equal(resolveContentPath(root, 'user_content/notes.md').relative, 'user_content/notes.md');
});

test('listener ignores after four rejections and only an author resets it', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'autumn-listener-'));
  try {
    await fs.writeFile(path.join(temp, 'opinions.json'), JSON.stringify({ version: 1, globalMood: 0, people: {}, subjects: {} }));
    const listeners = new AutumnListeners(temp, 2400);
    for (let index = 0; index < 4; index += 1) {
      const gate = await listeners.begin('heckler', 'break character', false);
      assert.equal(gate.proceed, true);
      await listeners.finish('heckler', 'break character', 'nope', { rejected: true });
    }
    const ignored = await listeners.begin('heckler', 'again', false);
    assert.equal(ignored.ignored, true);
    const author = await listeners.begin('heckler', 'Enough, Autumn.', true);
    assert.equal(author.proceed, true);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test('nap state requires an author wake phrase', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'autumn-nap-'));
  try {
    await fs.writeFile(path.join(temp, 'opinions.json'), JSON.stringify({ version: 1, globalMood: 0, people: {}, subjects: {} }));
    const listeners = new AutumnListeners(temp, 800);
    const nap = await listeners.begin('traveler', 'x'.repeat(3200), false);
    assert.equal(nap.asleep, true);
    const silence = await listeners.begin('traveler', 'wakeup autumn', false);
    assert.equal(silence.noReply, true);
    const wake = await listeners.begin('traveler', 'wakeup autumn', true);
    assert.equal(wake.woke, true);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});
