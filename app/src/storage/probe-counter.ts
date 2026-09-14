import { openDB } from 'idb';

export const PROBE_DATABASE_NAME = 'wpstudbook-probe';

const STORE_NAME = 'counter';
const COUNTER_KEY = 'loadCount';

export async function incrementProbeCounter(): Promise<number> {
  const database = await openDB(PROBE_DATABASE_NAME, 1, {
    upgrade(upgradeDatabase) {
      upgradeDatabase.createObjectStore(STORE_NAME);
    },
  });
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const current: unknown = await transaction.store.get(COUNTER_KEY);
    const next = (typeof current === 'number' ? current : 0) + 1;
    await transaction.store.put(next, COUNTER_KEY);
    await transaction.done;
    return next;
  } finally {
    database.close();
  }
}
