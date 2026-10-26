// Asks the game to save the world before a backup copies it (backup.sh runs
// this first). Always exits 0: if the save can't happen the backup still runs,
// just from whatever the game last wrote.
//
//   node src/save-world.js

import { config } from './config.js';
import { initLogFile, logger } from './log.js';
import { saveWorld } from './world-save.js';

initLogFile(config.dataDir);
const log = logger('save');

if (!config.saveFunction) {
    log.info('SAVE_FUNCTION not set, backing up the last save the game wrote');
} else {
    const result = await saveWorld();
    if (result.changed) log.info(result.message);
    else log.warn(`world not saved: ${result.message}`);
}
