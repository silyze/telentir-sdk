import type { EncryptedHeader } from "@mojsoski/server-crypto";
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

export interface InMemoryKeyCacheOptions {
  /**
   * Maximum number of key entries to retain. Oldest entries are evicted first.
   */
  maxEntries?: number;

  /**
   * Time-to-live for cached entries in milliseconds. Entries are discarded after expiry.
   */
  ttlMs?: number;
}

/**
 * A simple in-memory KeyCache implementation that keeps decrypted and encrypted
 * key material in Maps. Optionally bounds the cache by entry count and/or TTL.
 */
export class InMemoryKeyCache implements KeyCache {
  private readonly entries = new Map<string, CachedEntry>();
  private readonly maxEntries?: number;
  private readonly ttlMs?: number;

  constructor(options: InMemoryKeyCacheOptions = {}) {
    this.maxEntries = options.maxEntries;
    this.ttlMs = options.ttlMs;
  }

  public async getDecryptedKey(id: string) {
    const entry = this.readEntry(id);
    return entry?.decrypted
      ? {
          header: entry.decrypted.header,
          key: entry.decrypted.key,
          iv: entry.decrypted.iv,
        }
      : undefined;
  }

  public async getEncryptedKey(id: string) {
    const entry = this.readEntry(id);
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
    const entry = this.ensureEntry(id);
    const expiresAt = this.computeExpiry();
    entry.decrypted = { key, iv, header, expiresAt };
    entry.encrypted = { key: header.key, iv: header.iv, expiresAt };
    this.evictIfNeeded();
  }

  public async persistEncryptedKey(id: string, key: string, iv: string) {
    const entry = this.ensureEntry(id);
    entry.encrypted = { key, iv, expiresAt: this.computeExpiry() };
    this.evictIfNeeded();
  }

  private computeExpiry(): number | undefined {
    return this.ttlMs ? Date.now() + this.ttlMs : undefined;
  }

  private readEntry(id: string): CachedEntry | undefined {
    const entry = this.entries.get(id);
    if (!entry) {
      return undefined;
    }

    const now = Date.now();
    if (entry.decrypted && this.isExpired(entry.decrypted, now)) {
      entry.decrypted = undefined;
    }
    if (entry.encrypted && this.isExpired(entry.encrypted, now)) {
      entry.encrypted = undefined;
    }

    if (!entry.decrypted && !entry.encrypted) {
      this.entries.delete(id);
      return undefined;
    }

    return entry;
  }

  private ensureEntry(id: string): CachedEntry {
    const existing = this.readEntry(id);
    if (existing) {
      return existing;
    }
    const created: CachedEntry = {};
    this.entries.set(id, created);
    return created;
  }

  private isExpired(entry: Timestamped<unknown>, now: number): boolean {
    return entry.expiresAt !== undefined && entry.expiresAt <= now;
  }

  private evictIfNeeded() {
    if (this.maxEntries === undefined || this.entries.size <= this.maxEntries) {
      return;
    }

    const excess = this.entries.size - this.maxEntries;
    if (excess <= 0) {
      return;
    }

    const iterator = this.entries.keys();
    for (let removed = 0; removed < excess; removed++) {
      const next = iterator.next();
      if (next.done) {
        break;
      }
      this.entries.delete(next.value);
    }
  }
}
