import { buildInventory, INDEX_FILE } from './indexer.mjs';

const inventory = await buildInventory();
console.log(`Indexed ${inventory.entryCount} passages from ${inventory.fileCount} files.`);
console.log(`Hidden index: ${INDEX_FILE}`);
