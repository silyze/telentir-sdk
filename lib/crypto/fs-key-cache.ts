import type { EncryptedHeader } from "@mojsoski/server-crypto";
import { join } from "path";
import type { InMemoryKeyCacheOptions } from "./in-memory-key-cache";
import type { KeyCache } from "./object-manager";

type Timestamped<T> = T & { expiresAt?: number };

type StoredEntry = {
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

export interface FsKeyCacheOptions extends InMemoryKeyCacheOptions {
  directory: string;
}

export class FsKeyCache implements KeyCache {
  private readonly ttlMs?: number;
  private readonly maxEntries?: number;
  private readonly directoryReady: Promise<void>;

  constructor(
    private readonly fs: typeof import("fs/promises"),
    private readonly options: FsKeyCacheOptions
  ) {
    this.ttlMs = options.ttlMs;
    this.maxEntries = options.maxEntries;
    this.directoryReady = this.fs
      .mkdir(options.directory, { recursive: true })
      .then(() => undefined);
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
    return Buffer.from(id, "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  }

  private filePath(id: string): string {
    return join(this.options.directory, `${this.sanitizeId(id)}.json`);
  }

  private isExpired(entry: Timestamped<unknown>, now: number): boolean {
    return entry.expiresAt !== undefined && entry.expiresAt <= now;
  }

  private async readEntry(id: string): Promise<StoredEntry | undefined> {
    await this.directoryReady;
    const file = this.filePath(id);

    let raw: string;
    try {
      raw = await this.fs.readFile(file, "utf8");
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: string }).code === "ENOENT"
      ) {
        return undefined;
      }
      throw error;
    }

    let entry: StoredEntry;
    try {
      entry = JSON.parse(raw) as StoredEntry;
    } catch {
      await this.safeUnlink(file);
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
      await this.safeUnlink(file);
      return undefined;
    }

    if (decryptedExpired || encryptedExpired) {
      await this.writeFile(file, entry);
    }

    return entry;
  }

  private async storeEntry(id: string, entry: StoredEntry) {
    if (!entry.decrypted && !entry.encrypted) {
      await this.safeUnlink(this.filePath(id));
      return;
    }
    await this.directoryReady;
    await this.writeFile(this.filePath(id), entry);
  }

  private async writeFile(file: string, entry: StoredEntry) {
    const serialized = JSON.stringify(entry);
    await this.fs.writeFile(file, serialized, "utf8");
  }

  private async safeUnlink(file: string) {
    try {
      await this.fs.unlink(file);
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: string }).code === "ENOENT"
      ) {
        return;
      }
      throw error;
    }
  }

  private async evictIfNeeded() {
    if (this.maxEntries === undefined) {
      return;
    }

    await this.directoryReady;
    const dirents = await this.fs.readdir(this.options.directory, {
      withFileTypes: true,
    });

    const files = dirents
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => ({
        name: entry.name,
        path: join(this.options.directory, entry.name),
      }));

    if (files.length <= this.maxEntries) {
      return;
    }

    const stats = await Promise.all(
      files.map(async (file) => {
        try {
          const stat = await this.fs.stat(file.path);
          return { ...file, mtimeMs: stat.mtimeMs };
        } catch {
          return undefined;
        }
      })
    );

    const existing = stats.filter(
      (value): value is { name: string; path: string; mtimeMs: number } =>
        value !== undefined
    );

    if (existing.length <= this.maxEntries) {
      return;
    }

    existing.sort((a, b) => a.mtimeMs - b.mtimeMs);
    const excess = existing.length - this.maxEntries;

    for (let index = 0; index < excess; index++) {
      await this.safeUnlink(existing[index].path);
    }
  }
}
