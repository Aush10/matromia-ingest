import { createHash, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { askOpenAI } from './openai.mjs';
import { buildInventory, REPO_ROOT, searchInventory, tokenize } from './indexer.mjs';
import { ingestContent } from './ingestion.mjs';
import { AutumnListeners } from './listeners.mjs';
import { mutateJson, readJson } from './store.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(REPO_ROOT, 'public');
const DATA_DIR = path.join(REPO_ROOT, 'data');
const FLAGS_FILE = path.join(DATA_DIR, 'user_flags.json');
const RUMORS_FILE = path.join(DATA_DIR, 'rumors.json');
const FLAGS_FALLBACK = { version: 1, description: 'Local user flags.', users: {} };
const RUMORS_FALLBACK = { version: 1, description: 'Unconfirmed listener-owned information.', entries: [] };

async function loadDotEnv() {
  try {
    const text = await fs.readFile(path.join(REPO_ROOT, '.env'), 'utf8');
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const split = line.indexOf('=');
      if (split < 1) continue;
      const key = line.slice(0, split).trim();
      const value = line.slice(split + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function verified(candidate, expected) {
  if (!candidate || !expected || expected === 'replace-with-a-long-random-secret') return false;
  const a = createHash('sha256').update(String(candidate)).digest();
  const b = createHash('sha256').update(String(expected)).digest();
  return timingSafeEqual(a, b);
}

function safeUserId(value) {
  const clean = String(value || 'guest').trim().slice(0, 80);
  return clean.replace(/[^\p{L}\p{N}_.@ -]/gu, '_') || 'guest';
}

function json(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store'
  });
  response.end(payload);
}

async function bodyJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error('Request body is too large.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function contentType(file) {
  return ({
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
  })[path.extname(file)] ?? 'application/octet-stream';
}

async function serveStatic(requestPath, response) {
  const requested = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
  const absolute = path.resolve(PUBLIC_DIR, requested);
  if (!absolute.toLowerCase().startsWith(`${PUBLIC_DIR.toLowerCase()}${path.sep}`)) return false;
  try {
    const data = await fs.readFile(absolute);
    response.writeHead(200, { 'Content-Type': contentType(absolute), 'Content-Length': data.length });
    response.end(data);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function sourceContext(results) {
  if (!results.length) return 'No matching canon excerpt was found.';
  return results.map((item, index) =>
    `[CANON ${index + 1} | ${item.sourceTier} | ${item.path} | ${item.section}]\n${item.text}`
  ).join('\n\n');
}

function searchRumors(rumors, query) {
  const terms = tokenize(query);
  return (rumors.entries ?? []).filter((entry) => {
    const haystack = JSON.stringify(entry).toLowerCase();
    return terms.some((term) => haystack.includes(term));
  }).slice(0, 4);
}

function localFallback(results, dreamMode) {
  if (dreamMode) return 'Dream, not canon: I can spin that possibility once my voice crystal is awake, but I won’t dress a guess up as history. :P';
  if (!results.length) return 'Ooh, my notes don’t give me a trustworthy answer for that one, friend. I’d rather admit the blank spot than decorate it with nonsense.';
  const first = results[0];
  const excerpt = first.text.replace(/\s+/g, ' ').slice(0, 420);
  return `I found this in my notes: ${excerpt}${first.text.length > 420 ? '…' : ''} (${first.path} — ${first.section})`;
}

async function main() {
  await loadDotEnv();
  let inventory = await buildInventory();
  const aiSpec = await fs.readFile(path.join(REPO_ROOT, 'AUTUMN_AI.md'), 'utf8');
  const port = Number(process.env.AUTUMN_PORT || 8787);
  const host = '127.0.0.1';
  const model = process.env.AUTUMN_MODEL || 'gpt-6-luna';
  const maxOutputTokens = Math.max(100, Math.min(Number(process.env.AUTUMN_MAX_OUTPUT_TOKENS || 350), 500));
  const listeners = new AutumnListeners(DATA_DIR, process.env.AUTUMN_SESSION_TOKEN_BUDGET || 2400);

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host || `${host}:${port}`}`);

      if (request.method === 'GET' && url.pathname === '/api/status') {
        return json(response, 200, {
          name: 'Autumn Solstice', model, maxOutputTokens,
          openAiConfigured: Boolean(process.env.OPENAI_API_KEY),
          authorConfigured: verified(process.env.AUTUMN_AUTHOR_KEY, process.env.AUTUMN_AUTHOR_KEY),
          inventory: { generatedAt: inventory.generatedAt, fileCount: inventory.fileCount, entryCount: inventory.entryCount }
        });
      }

      if (request.method === 'POST' && url.pathname === '/api/search') {
        const body = await bodyJson(request);
        return json(response, 200, { results: searchInventory(inventory, body.query, body.limit) });
      }

      if (request.method === 'GET' && url.pathname === '/api/flags') {
        const userId = safeUserId(url.searchParams.get('userId'));
        const flags = await readJson(FLAGS_FILE, FLAGS_FALLBACK);
        const saved = flags.users?.[userId] ?? { pinned: [], favorites: [] };
        const byId = new Map(inventory.entries.map((entry) => [entry.id, entry]));
        const expand = (ids) => ids.map((id) => byId.get(id)).filter(Boolean).map(({ keywords, ...entry }) => entry);
        return json(response, 200, { pinned: expand(saved.pinned), favorites: expand(saved.favorites) });
      }

      if (request.method === 'POST' && url.pathname === '/api/flags') {
        const body = await bodyJson(request);
        const userId = safeUserId(body.userId);
        const flag = body.flag;
        if (!['pinned', 'favorites'].includes(flag) || !inventory.entries.some((entry) => entry.id === body.itemId)) {
          return json(response, 400, { error: 'A valid item and pin/favorite flag are required.' });
        }
        const saved = await mutateJson(FLAGS_FILE, FLAGS_FALLBACK, (data) => {
          data.users ??= {};
          data.users[userId] ??= { pinned: [], favorites: [] };
          const list = data.users[userId][flag];
          const exists = list.includes(body.itemId);
          const enabled = typeof body.value === 'boolean' ? body.value : !exists;
          if (enabled && !exists) list.push(body.itemId);
          if (!enabled && exists) list.splice(list.indexOf(body.itemId), 1);
          return { ...data.users[userId] };
        });
        return json(response, 200, saved);
      }

      if (request.method === 'POST' && url.pathname === '/api/ingest') {
        const body = await bodyJson(request);
        if (!verified(body.authorKey, process.env.AUTUMN_AUTHOR_KEY)) {
          return json(response, 403, { error: 'Author credentials were not accepted.' });
        }
        const result = await ingestContent(REPO_ROOT, body);
        inventory = await buildInventory();
        return json(response, 200, { ...result, inventoryEntries: inventory.entryCount });
      }

      if (request.method === 'POST' && url.pathname === '/api/reindex') {
        const body = await bodyJson(request);
        if (!verified(body.authorKey, process.env.AUTUMN_AUTHOR_KEY)) {
          return json(response, 403, { error: 'Author credentials were not accepted.' });
        }
        inventory = await buildInventory();
        return json(response, 200, { fileCount: inventory.fileCount, entryCount: inventory.entryCount });
      }

      if (request.method === 'POST' && url.pathname === '/api/chat') {
        const body = await bodyJson(request);
        const userId = safeUserId(body.userId);
        const message = String(body.message || '').trim();
        if (!message || message.length > 4000) return json(response, 400, { error: 'Message must be 1–4,000 characters.' });
        const isAuthor = verified(body.authorKey, process.env.AUTUMN_AUTHOR_KEY);
        const gate = await listeners.begin(userId, message, isAuthor);
        if (!gate.proceed) return json(response, 200, { reply: gate.reply ?? null, noReply: Boolean(gate.noReply), state: gate });

        const results = searchInventory(inventory, message, 8);
        const rumors = await readJson(RUMORS_FILE, RUMORS_FALLBACK);
        const matchingRumors = searchRumors(rumors, message);
        const mood = await listeners.context(userId);
        const debugMode = isAuthor && message.startsWith('Debug:');
        const dreamMode = /\b(guess|suggest|imagine|fantas|dream|what if|could be)\b/i.test(message);
        const caughtInLie = /\b(you lied|that's? (not true|wrong|false)|caught you|liar|made that up|outdated)\b/i.test(message);
        const bardicImpulse = !debugMode && !dreamMode && !caughtInLie && Math.random() < 0.08;
        const history = Array.isArray(body.history) ? body.history.slice(-6)
          .filter((item) => ['user', 'assistant'].includes(item?.role) && typeof item?.content === 'string')
          .map((item) => `${item.role}: ${item.content.slice(0, 700)}`).join('\n') : '';
        const runtime = `\n\nRUNTIME CONTEXT\nVerified author: ${isAuthor ? 'yes' : 'no'}\nCurrent mood: ${mood.flavor}\nRemaining listener token budget: about ${gate.remainingTokens}\nDream request: ${dreamMode ? 'yes' : 'no'}\nBardic impulse active: ${bardicImpulse ? 'yes — one harmless low-stakes embellishment is permitted' : 'no'}\nPossibly caught in a lie or mistake: ${caughtInLie ? 'yes — correct important facts, then react in character' : 'no'}\n`;
        const rumorContext = matchingRumors.length ? `\n\nUNCONFIRMED RUMORS — LABEL AS RUMOR\n${JSON.stringify(matchingRumors)}` : '';
        const input = `${history ? `RECENT CHAT\n${history}\n\n` : ''}ARCHIVE LOOKUP\n${sourceContext(results)}${rumorContext}\n\nPERSON SPEAKING NOW\n${message}`;
        const instructions = debugMode
          ? 'The verified author invoked Debug mode. Answer the technical request plainly, accurately, and briefly. Do not roleplay.'
          : `${aiSpec}${runtime}`;

        let rawReply;
        let apiError = null;
        if (process.env.OPENAI_API_KEY) {
          try {
            rawReply = await askOpenAI({ apiKey: process.env.OPENAI_API_KEY, model, instructions, input, maxOutputTokens });
          } catch (error) {
            apiError = error.message;
            rawReply = localFallback(results, dreamMode);
          }
        } else {
          rawReply = localFallback(results, dreamMode);
        }

        const rejected = rawReply.includes('[[REJECTED]]');
        let visibleReply = rawReply.replaceAll('[[REJECTED]]', '').trim();
        if (dreamMode && !debugMode && !/^dream,? not canon:/i.test(visibleReply)) {
          visibleReply = `Dream, not canon: ${visibleReply}`;
        }
        const final = await listeners.finish(userId, message, visibleReply, { rejected, shouldYawn: gate.shouldYawn });
        return json(response, 200, {
          reply: final.reply, noReply: false, dream: dreamMode && !debugMode,
          sources: results.map(({ id, path: sourcePath, section, sourceTier, score }) => ({ id, path: sourcePath, section, sourceTier, score })),
          remainingTokens: final.remainingTokens, apiFallback: Boolean(apiError || !process.env.OPENAI_API_KEY),
          apiError
        });
      }

      if (request.method === 'GET' && await serveStatic(url.pathname, response)) return;
      json(response, 404, { error: 'Not found.' });
    } catch (error) {
      console.error(error);
      json(response, 500, { error: error.message || 'Unexpected server error.' });
    }
  });

  server.listen(port, host, () => {
    console.log(`Autumn Solstice is listening at http://${host}:${port}`);
    console.log(`Indexed ${inventory.entryCount} passages from ${inventory.fileCount} files using ${model}.`);
    if (!process.env.OPENAI_API_KEY) console.log('OPENAI_API_KEY is not set; local search fallback is active.');
    if (!process.env.AUTUMN_AUTHOR_KEY || process.env.AUTUMN_AUTHOR_KEY === 'replace-with-a-long-random-secret') {
      console.log('AUTUMN_AUTHOR_KEY is not configured; ingestion and authority features are locked.');
    }
  });
}

await main();
