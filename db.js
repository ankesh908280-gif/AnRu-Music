/**
 * ANRU MUSIC - RESILIENT DATABASE & STORAGE CONTROLLER
 * Supports IndexedDB Offline Audio Storage with LocalStorage fallbacks
 */

const storage = {
  get: (key, def = null) => {
    try {
      const v = localStorage.getItem(key);
      return v !== null ? v : def;
    } catch (e) {
      return def;
    }
  },
  set: (key, val) => {
    try {
      localStorage.setItem(key, val);
    } catch (e) {}
  },
  remove: (key) => {
    try {
      localStorage.removeItem(key);
    } catch (e) {}
  }
};

class MusicDB {
  constructor() {
    this.dbName = 'AnruMusicDB';
    this.version = 2;
    this.db = null;
    this.initPromise = null;
  }

  async init() {
    if (this.db) return this.db;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve) => {
      try {
        if (!window.indexedDB) {
          console.warn('IndexedDB not supported, falling back to local storage');
          return resolve(null);
        }

        const request = indexedDB.open(this.dbName, this.version);

        const safetyTimer = setTimeout(() => {
          console.warn('IndexedDB open safety timeout reached');
          resolve(this.db);
        }, 1200);

        request.onblocked = () => {
          console.warn('IndexedDB upgrade blocked by another connection');
          clearTimeout(safetyTimer);
          resolve(this.db);
        };

        request.onupgradeneeded = (event) => {
          try {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('downloads')) {
              db.createObjectStore('downloads', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('favorites')) {
              db.createObjectStore('favorites', { keyPath: 'id' });
            }
          } catch (e) {
            console.warn('DB onupgradeneeded notice:', e);
          }
        };

        request.onsuccess = (event) => {
          clearTimeout(safetyTimer);
          this.db = event.target.result;
          resolve(this.db);
        };

        request.onerror = (event) => {
          clearTimeout(safetyTimer);
          console.warn('IndexedDB open notice:', event.target.error);
          resolve(null);
        };
      } catch (err) {
        console.warn('IndexedDB init exception notice:', err);
        resolve(null);
      }
    });

    return this.initPromise;
  }

  async saveDownload(song, audioBlob) {
    try {
      if (!this.db) await this.init();
      if (!this.db) return song;
      return new Promise((resolve) => {
        try {
          const tx = this.db.transaction('downloads', 'readwrite');
          const store = tx.objectStore('downloads');
          const record = {
            ...song,
            audioBlob: audioBlob,
            downloadedAt: new Date().toISOString()
          };
          const req = store.put(record);
          req.onsuccess = () => resolve(record);
          req.onerror = () => resolve(song);
        } catch (e) {
          resolve(song);
        }
      });
    } catch (e) {
      return song;
    }
  }

  async getDownload(id) {
    try {
      if (!this.db) await this.init();
      if (!this.db) return null;
      return new Promise((resolve) => {
        try {
          const tx = this.db.transaction('downloads', 'readonly');
          const store = tx.objectStore('downloads');
          const req = store.get(String(id));
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => resolve(null);
        } catch (e) {
          resolve(null);
        }
      });
    } catch (e) {
      return null;
    }
  }

  async getAllDownloads() {
    try {
      if (!this.db) await this.init();
      if (!this.db) return [];
      return new Promise((resolve) => {
        try {
          const tx = this.db.transaction('downloads', 'readonly');
          const store = tx.objectStore('downloads');
          const req = store.getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => resolve([]);
        } catch (e) {
          resolve([]);
        }
      });
    } catch (e) {
      return [];
    }
  }

  async deleteDownload(id) {
    try {
      if (!this.db) await this.init();
      if (!this.db) return true;
      return new Promise((resolve) => {
        try {
          const tx = this.db.transaction('downloads', 'readwrite');
          const store = tx.objectStore('downloads');
          const req = store.delete(String(id));
          req.onsuccess = () => resolve(true);
          req.onerror = () => resolve(false);
        } catch (e) {
          resolve(false);
        }
      });
    } catch (e) {
      return false;
    }
  }

  async clearAllDownloads() {
    try {
      if (!this.db) await this.init();
      if (!this.db) return true;
      return new Promise((resolve) => {
        try {
          const tx = this.db.transaction('downloads', 'readwrite');
          const store = tx.objectStore('downloads');
          const req = store.clear();
          req.onsuccess = () => resolve(true);
          req.onerror = () => resolve(false);
        } catch (e) {
          resolve(false);
        }
      });
    } catch (e) {
      return false;
    }
  }

  async toggleFavorite(song) {
    try {
      if (!this.db) await this.init();
      if (!this.db) {
        const favs = JSON.parse(storage.get('anru-local-favs', '[]'));
        const idx = favs.findIndex(f => f.id === song.id);
        if (idx >= 0) {
          favs.splice(idx, 1);
          storage.set('anru-local-favs', JSON.stringify(favs));
          return false;
        } else {
          favs.push(song);
          storage.set('anru-local-favs', JSON.stringify(favs));
          return true;
        }
      }
      const isFav = await this.isFavorite(song.id);
      return new Promise((resolve) => {
        try {
          const tx = this.db.transaction('favorites', 'readwrite');
          const store = tx.objectStore('favorites');
          if (isFav) {
            const req = store.delete(String(song.id));
            req.onsuccess = () => resolve(false);
            req.onerror = () => resolve(false);
          } else {
            const req = store.put({ ...song, favoritedAt: new Date().toISOString() });
            req.onsuccess = () => resolve(true);
            req.onerror = () => resolve(false);
          }
        } catch (e) {
          resolve(false);
        }
      });
    } catch (e) {
      return false;
    }
  }

  async isFavorite(id) {
    try {
      if (!this.db) await this.init();
      if (!this.db) {
        const favs = JSON.parse(storage.get('anru-local-favs', '[]'));
        return favs.some(f => f.id === id);
      }
      return new Promise((resolve) => {
        try {
          const tx = this.db.transaction('favorites', 'readonly');
          const store = tx.objectStore('favorites');
          const req = store.get(String(id));
          req.onsuccess = () => resolve(!!req.result);
          req.onerror = () => resolve(false);
        } catch (e) {
          resolve(false);
        }
      });
    } catch (e) {
      return false;
    }
  }

  async getAllFavorites() {
    try {
      if (!this.db) await this.init();
      if (!this.db) {
        return JSON.parse(storage.get('anru-local-favs', '[]'));
      }
      return new Promise((resolve) => {
        try {
          const tx = this.db.transaction('favorites', 'readonly');
          const store = tx.objectStore('favorites');
          const req = store.getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => resolve([]);
        } catch (e) {
          resolve([]);
        }
      });
    } catch (e) {
      return [];
    }
  }
}

const db = new MusicDB();

if (typeof window !== 'undefined') { window.db = db; window.storage = storage; }
if (typeof globalThis !== 'undefined') { globalThis.db = db; globalThis.storage = storage; }
