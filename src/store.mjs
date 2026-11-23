import { promises as fs } from 'node:fs';
import path from 'node:path';

const queues = new Map();

export async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return structuredClone(fallback);
    throw error;
  }
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.copyFile(temporary, file);
  await fs.unlink(temporary);
}

export function mutateJson(file, fallback, mutator) {
  const previous = queues.get(file) ?? Promise.resolve();
  const operation = previous.then(async () => {
    const data = await readJson(file, fallback);
    const result = await mutator(data);
    await writeJson(file, data);
    return result;
  });
  queues.set(file, operation.catch(() => {}));
  return operation;
}
