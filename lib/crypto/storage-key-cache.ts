import type { EncryptedHeader } from "@mojsoski/server-crypto";
import type { InMemoryKeyCacheOptions } from "./in-memory-key-cache";
import type { KeyCache } from "./object-manager";

type Timestamped<T> = T & { expiresAt?: number };

type CachedEntry = {
  decrypted?: Timestamped<{
    header: EncryptedHeader;
    key: string;
    iv: string;
  }>;
  encrypted?: Timestamped<{
    key: string;
    iv: string;
  }>;
};

type StoredEntry = CachedEntry & {
  updatedAt: number;
};

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
}

export interface StorageKeyCacheOptions extends InMemoryKeyCacheOptions {
  prefix?: string;
}

export class StorageKeyCache implements KeyCache {
  private readonly ttlMs?: number;
  private readonly maxEntries?: number;
  private readonly prefix: string;

  constructor(
    private readonly storage: StorageLike,
    options: StorageKeyCacheOptions = {}
  ) {
    this.ttlMs = options.ttlMs;
    this.maxEntries = options.maxEntries;
    this.prefix = options.prefix ?? "telentir:key-cache:";
  }

  public async getDecryptedKey(id: string) {
    const entry = await this.readEntry(id);
    return entry?.decrypted
      ? {
          header: entry.decrypted.header,
          key: entry.decrypted.key,
          iv: entry.decrypted.iv,
        }
      : undefined;
  }

  public async getEncryptedKey(id: string) {
    const entry = await this.readEntry(id);
    return entry?.encrypted
      ? {
          key: entry.encrypted.key,
          iv: entry.encrypted.iv,
        }
      : undefined;
  }

  public async persistDecryptedKey(
    id: string,
    key: string,
    iv: string,
    header: EncryptedHeader
  ) {
    const entry = (await this.readEntry(id)) ?? {};
    const expiresAt = this.computeExpiry();
    entry.decrypted = { key, iv, header, expiresAt };
    entry.encrypted = {
      key: header.key,
      iv: header.iv,
      expiresAt,
    };
    await this.storeEntry(id, entry);
    await this.evictIfNeeded();
  }

  public async persistEncryptedKey(id: string, key: string, iv: string) {
    const entry = (await this.readEntry(id)) ?? {};
    entry.encrypted = { key, iv, expiresAt: this.computeExpiry() };
    await this.storeEntry(id, entry);
    await this.evictIfNeeded();
  }

  private computeExpiry(): number | undefined {
    return this.ttlMs ? Date.now() + this.ttlMs : undefined;
  }

  private sanitizeId(id: string): string {
    return encodeURIComponent(id);
  }

  private storageKey(id: string): string {
    return `${this.prefix}${this.sanitizeId(id)}`;
  }

  private isExpired(entry: Timestamped<unknown>, now: number): boolean {
    return entry.expiresAt !== undefined && entry.expiresAt <= now;
  }

  private async readEntry(id: string): Promise<CachedEntry | undefined> {
    const storageKey = this.storageKey(id);
    const raw = this.storage.getItem(storageKey);
    if (raw === null) {
      return undefined;
    }

    let entry: StoredEntry;
    try {
      entry = JSON.parse(raw) as StoredEntry;
    } catch {
      this.storage.removeItem(storageKey);
      return undefined;
    }

    const now = Date.now();
    const decryptedExpired =
      entry.decrypted && this.isExpired(entry.decrypted, now);
    const encryptedExpired =
      entry.encrypted && this.isExpired(entry.encrypted, now);

    if (decryptedExpired) {
      entry.decrypted = undefined;
    }

    if (encryptedExpired) {
      entry.encrypted = undefined;
    }

    if (!entry.decrypted && !entry.encrypted) {
      this.storage.removeItem(storageKey);
      return undefined;
    }

    if (decryptedExpired || encryptedExpired) {
      this.setStoredEntry(storageKey, {
        decrypted: entry.decrypted,
        encrypted: entry.encrypted,
        updatedAt: entry.updatedAt ?? now,
      });
    }

    return {
      decrypted: entry.decrypted,
      encrypted: entry.encrypted,
    };
  }

  private async storeEntry(id: string, entry: CachedEntry) {
    const storageKey = this.storageKey(id);
    if (!entry.decrypted && !entry.encrypted) {
      this.storage.removeItem(storageKey);
      return;
    }

    this.setStoredEntry(storageKey, {
      decrypted: entry.decrypted,
      encrypted: entry.encrypted,
      updatedAt: Date.now(),
    });
  }

  private setStoredEntry(storageKey: string, entry: StoredEntry) {
    this.storage.setItem(storageKey, JSON.stringify(entry));
  }

  private getPrefixedKeys(): string[] {
    const keys: string[] = [];
    for (let index = 0; index < this.storage.length; index++) {
      const key = this.storage.key(index);
      if (key && key.startsWith(this.prefix)) {
        keys.push(key);
      }
    }
    return keys;
  }

  private async evictIfNeeded() {
    if (this.maxEntries === undefined) {
      return;
    }

    const keys = this.getPrefixedKeys();
    if (keys.length <= this.maxEntries) {
      return;
    }

    const entries = keys
      .map((storageKey) => {
        const raw = this.storage.getItem(storageKey);
        if (raw === null) {
          this.storage.removeItem(storageKey);
          return undefined;
        }

        try {
          const entry = JSON.parse(raw) as StoredEntry;
          if (typeof entry.updatedAt !== "number") {
            entry.updatedAt = 0;
          }
          return { storageKey, entry };
        } catch {
          this.storage.removeItem(storageKey);
          return undefined;
        }
      })
      .filter(
        (value): value is { storageKey: string; entry: StoredEntry } =>
          value !== undefined
      );

    if (entries.length <= this.maxEntries) {
      return;
    }

    entries.sort((a, b) => a.entry.updatedAt - b.entry.updatedAt);
    const excess = entries.length - this.maxEntries;

    for (let index = 0; index < excess; index++) {
      this.storage.removeItem(entries[index].storageKey);
    }
  }
}
