import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class AssetStorageService {
  private readonly dbName = 'twin-simulator-assets';
  private readonly storeName = 'assets';
  private dbPromise: Promise<IDBDatabase> | null = null;
  private objectUrls = new Map<string, string>();

  saveAsset(projectId: string, file: File): Promise<string> {
    const key = `${projectId}/source.glb`;

    return this.withStore('readwrite', store => {
      store.put({
        key,
        blob: file,
        fileName: file.name,
        type: file.type || 'model/gltf-binary',
        updatedAt: new Date().toISOString()
      });
    }).then(() => `indexeddb://${key}`);
  }

  async resolveAssetUrl(reference: string): Promise<string> {
    if (!reference.startsWith('indexeddb://')) {
      return reference;
    }

    if (this.objectUrls.has(reference)) {
      return this.objectUrls.get(reference)!;
    }

    const key = reference.replace('indexeddb://', '');
    const record = await this.getAssetRecord(key);

    if (!record?.blob) {
      throw new Error('Stored GLB asset was not found. Re-import the project.');
    }

    const objectUrl = URL.createObjectURL(record.blob);
    this.objectUrls.set(reference, objectUrl);

    return objectUrl;
  }

  private getAssetRecord(key: string): Promise<{ blob: Blob } | undefined> {
    return this.withStore('readonly', store => store.get(key));
  }

  private async withStore<T>(
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest<T> | void
  ): Promise<T> {
    const db = await this.getDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, mode);
      const store = transaction.objectStore(this.storeName);
      const request = action(store);
      let result: T;

      if (request) {
        request.onsuccess = () => {
          result = request.result;
        };
        request.onerror = () => reject(request.error);
      }

      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  private getDb(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);

      request.onupgradeneeded = () => {
        const db = request.result;

        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'key' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    return this.dbPromise;
  }
}
