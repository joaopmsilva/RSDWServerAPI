// Prints how many players are online, for scripts deciding whether to warn
// before a restart. 0 when the server is down or still loading.
//
//   node src/online.js

import { api } from './api.js';

try {
    console.log((await api.players()).length);
} catch {
    console.log(0);
}
