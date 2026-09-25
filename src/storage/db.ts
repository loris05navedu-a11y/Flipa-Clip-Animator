/** Tiny promise wrapper around IndexedDB (works with fake-indexeddb in tests). */

export const DB_NAME = 'frameloom';
export const DB_VERSION = 1;
export type StoreName = 'meta' | 'docs' | 'blobs' | 'recovery' | 'kv';

export function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new DOMException('Transaction aborted', 'AbortError'));
  });
}

export class Db {
  private constructor(readonly idb: IDBDatabase) {}

  static open(factory: IDBFactory = indexedDB, name = DB_NAME): Promise<Db> {
    return new Promise((resolve, reject) => {
      const req = factory.open(name, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('docs')) {
          const s = db.createObjectStore('docs', { keyPath: 'key' });
          s.createIndex('byProject', 'projectId');
        }
        if (!db.objectStoreNames.contains('blobs')) {
          const s = db.createObjectStore('blobs', { keyPath: 'key' });
          s.createIndex('byProject', 'projectId');
        }
        if (!db.objectStoreNames.contains('recovery')) db.createObjectStore('recovery', { keyPath: 'projectId' });
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      };
      req.onsuccess = () => resolve(new Db(req.result));
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('database-blocked'));
    });
  }

  tx(stores: StoreName | StoreName[], mode: IDBTransactionMode = 'readonly'): IDBTransaction {
    return this.idb.transaction(stores, mode, { durability: 'strict' } as IDBTransactionOptions);
  }

  async get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
    return reqToPromise(this.tx(store).objectStore(store).get(key)) as Promise<T | undefined>;
  }

  async getAll<T>(store: StoreName): Promise<T[]> {
    return reqToPromise(this.tx(store).objectStore(store).getAll()) as Promise<T[]>;
  }

  async getAllByProject<T>(store: 'docs' | 'blobs', projectId: string): Promise<T[]> {
    return reqToPromise(this.tx(store).objectStore(store).index('byProject').getAll(projectId)) as Promise<T[]>;
  }

  async keysByProject(store: 'docs' | 'blobs', projectId: string): Promise<string[]> {
    return reqToPromise(this.tx(store).objectStore(store).index('byProject').getAllKeys(projectId)) as Promise<string[]>;
  }

  async put(store: StoreName, value: unknown, key?: IDBValidKey): Promise<void> {
    const tx = this.tx(store, 'readwrite');
    tx.objectStore(store).put(value, key);
    await txDone(tx);
  }

  async delete(store: StoreName, key: IDBValidKey): Promise<void> {
    const tx = this.tx(store, 'readwrite');
    tx.objectStore(store).delete(key);
    await txDone(tx);
  }

  close(): void {
    this.idb.close();
  }
}
