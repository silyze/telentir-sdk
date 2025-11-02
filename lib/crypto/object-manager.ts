import { assert } from "@mojsoski/assert";
import {
  CurrentServer,
  EncryptedHeader,
  EncryptionContext,
  ICryptoProvider,
  RemoteServer,
  Server,
  ServerManager,
} from "@mojsoski/server-crypto";
import { h2b, b2h } from "../utils/hex";

type KeyResponse = {
  id: string;
  metadata: object;
  created_at: string;
  updated_at: string;
  user_id: string;
  server: string;
  key: string;
  iv: string;
};

type ObjectResponse = {
  id: string;
  metadata: object;
  created_at: string;
  updated_at: string;
  user_id: string;
  key_id: string;
  auth_tag: string;
  content: string;
  related_object_id: string;
};

type RemoteResponse = {
  current: string;
  keys: Record<
    string,
    {
      "application/pkix-spki": string;
      "application/jwk+json": object;
    }
  >;
};

type RootResponse = {
  stores: Record<string, { defaultKey: string; id: string }>;
  servers: Record<
    string,
    { publicKey: string; privateKey?: string; deprecated: boolean }
  >;
};

type LocalAuth = { publicKey: string; privateKey: string };

export interface ObjectManagerConfig {
  apiKey: string;
  api?: string;
  localAuth?: LocalAuth[];
  keyCache?: KeyCache;
}

export interface KeyCache {
  persistEncryptedKey?: (id: string, key: string, iv: string) => Promise<void>;

  persistDecryptedKey?: (
    id: string,
    key: string,
    iv: string,
    header: EncryptedHeader
  ) => Promise<void>;

  getDecryptedKey?: (id: string) => Promise<
    | {
        /**
         * The encrypted version of the key (so we won't need to re-encrypt, as-is from decrypted context operation, so we can reconstruct the whole context)
         */
        header: EncryptedHeader;

        /**
         * Base64 encoded key (assume h2b has already been called if response was hex)
         */
        key: string;
        /**
         * Base64 encoded iv (assume h2b has already been called if response was hex)
         */
        iv: string;
      }
    | undefined
  >;

  getEncryptedKey?: (id: string) => Promise<
    | {
        /**
         * Base64 encoded (+ encrypted) key  (assume h2b has already been called if response was hex)
         */
        key: string;
        /**
         * Base64 encoded (+ encrypted) iv  (assume h2b has already been called if response was hex)
         */
        iv: string;
      }
    | undefined
  >;
}

interface KeyInsertOptions {
  server: string;
  metadata?: object;
  context?: EncryptionContext;
}

interface KeyPatchOptions {
  metadata?: object;
  context?: EncryptionContext;
  server?: string;
}

interface ObjectEncryptionOptions {
  keyId?: string;
  keyServer?: string;
  keyMetadata?: object;
  context?: EncryptionContext;
  fallbackKeyId?: string;
}

interface ObjectInsertOptions<T> extends ObjectEncryptionOptions {
  content: T;
  metadata?: object;
  relatedObjectId?: string | null;
}

interface ObjectPatchOptions<T> extends ObjectEncryptionOptions {
  content?: T;
  metadata?: object;
  relatedObjectId?: string | null;
}

export class ObjectManager<T> {
  private readonly provider: ICryptoProvider<T>;
  private readonly apiKey: string;
  private readonly apiBase: string;
  private readonly localAuth?: LocalAuth[];
  private readonly keyCache?: KeyCache;

  private remotes: RemoteServer<T>[] = [];
  private servers: Server<T>[] = [];
  private remoteNameValue?: string;
  private storesValue?: Record<string, { defaultKey: string; id: string }>;
  private readonly objectCache = new Map<string, ObjectResponse>();
  private readonly keyResponseCache = new Map<string, KeyResponse>();
  private readonly relatedObjectsCache = new Map<string, ObjectResponse[]>();

  constructor(provider: ICryptoProvider<T>, config: ObjectManagerConfig) {
    assert(config.apiKey, "ObjectManager requires an apiKey.");
    this.keyCache = config.keyCache;
    this.provider = provider;
    this.apiKey = config.apiKey;
    this.localAuth = config.localAuth;
    this.apiBase = (config.api ?? "https://telentir.com/api").replace(
      /\/$/,
      ""
    );
  }

  public static async create<T>(
    provider: ICryptoProvider<T>,
    config: ObjectManagerConfig
  ): Promise<ObjectManager<T>> {
    const manager = new ObjectManager<T>(provider, config);
    await manager.refreshRemotes();
    await manager.refreshRoot();
    return manager;
  }

  public async fetch<R = unknown>(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<R> {
    const resolvedInput =
      typeof input === "string" || input instanceof URL
        ? this.resolveUrl(input)
        : input;

    const request = new Request(resolvedInput, init);
    const headers = new Headers(request.headers);
    headers.set("authorization", `Bearer ${this.apiKey}`);

    const finalRequest = new Request(request, { headers });
    const response = await fetch(finalRequest);
    const responseText = await response.text();

    if (!response.ok) {
      throw new Error(
        `Request failed: ${response.status} ${response.statusText}:\n${responseText}`
      );
    }

    if (!responseText.length) {
      return undefined as R;
    }

    try {
      return JSON.parse(responseText) as R;
    } catch {
      throw new Error(
        `Failed to parse JSON response from ${
          request.method ?? "GET"
        } ${resolvedInput}:\n${responseText}`
      );
    }
  }

  public get remoteName(): string {
    assert(
      this.remoteNameValue,
      "Remote metadata not loaded. Call refreshRemotes first."
    );
    return this.remoteNameValue;
  }

  public get stores(): Record<string, { defaultKey: string; id: string }> {
    assert(
      this.storesValue,
      "Root metadata not loaded. Call refreshRoot first."
    );
    return this.storesValue;
  }

  public async getObject(
    object: string | ObjectResponse
  ): Promise<ObjectResponse> {
    if (typeof object !== "string") {
      return this.cacheObjectResponse(object);
    }

    const cached = this.objectCache.get(object);
    if (cached) {
      return cached;
    }

    const fetched = await this.fetch<ObjectResponse>(`/objects/${object}`);
    return this.cacheObjectResponse(fetched);
  }

  public async decryptObject<T = unknown>(
    object: string | ObjectResponse,
    context?: EncryptionContext
  ) {
    const objectResponse = await this.getObject(object);
    const resolvedContext =
      context ?? (await this.decryptKey(objectResponse.key_id));

    const content = await Server.decrypt(
      resolvedContext,
      {
        authTag: h2b(objectResponse.auth_tag),
        content: h2b(objectResponse.content),
      },
      this.provider
    );

    return JSON.parse(content.toString("utf-8")) as T;
  }

  public async getRelatedObjects(
    object: string | ObjectResponse
  ): Promise<ObjectResponse[]> {
    const baseObject = await this.getObject(object);
    const cached = this.relatedObjectsCache.get(baseObject.id);
    if (cached) {
      return cached;
    }

    const related = await this.fetch<ObjectResponse[]>(
      `/objects/${baseObject.id}/related`
    );
    const cachedRelated = related.map((item) => this.cacheObjectResponse(item));
    this.relatedObjectsCache.set(baseObject.id, cachedRelated);
    return cachedRelated;
  }

  public async decryptRelatedObjects<T = unknown>(
    object: string | ObjectResponse
  ): Promise<T[]> {
    const related = await this.getRelatedObjects(object);
    return await Promise.all(
      related.map((item) => this.decryptObject<T>(item))
    );
  }

  public async getKey(key: string | KeyResponse): Promise<KeyResponse> {
    if (typeof key !== "string") {
      const cached = this.cacheKeyResponse(key);
      await this.keyCache?.persistEncryptedKey?.(
        cached.id,
        h2b(cached.key),
        h2b(cached.iv)
      );
      return cached;
    }

    const cachedResponse = this.keyResponseCache.get(key);
    if (cachedResponse) {
      return cachedResponse;
    }

    const encryptedCache = await this.keyCache?.getEncryptedKey?.(key);
    const fetched = await this.fetch<KeyResponse>(`/keys/${key}`);

    const finalResponse: KeyResponse = encryptedCache
      ? {
          ...fetched,
          key: b2h(encryptedCache.key),
          iv: b2h(encryptedCache.iv),
        }
      : fetched;

    const cached = this.cacheKeyResponse(finalResponse);

    if (!encryptedCache) {
      await this.keyCache?.persistEncryptedKey?.(
        key,
        h2b(cached.key),
        h2b(cached.iv)
      );
    }

    return cached;
  }

  public async insertKey(options: KeyInsertOptions): Promise<KeyResponse> {
    const serverManager = this.serverManagerOf(options.server);
    const context =
      options.context ?? (await serverManager.self.createContext());

    const body: Record<string, unknown> = {
      server: options.server,
      key: b2h(context.header.key),
      iv: b2h(context.header.iv),
    };

    if (options.metadata !== undefined) {
      body.metadata = options.metadata;
    }

    const response = await this.fetch<KeyResponse>("/keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    const cached = this.cacheKeyResponse(response);
    await this.persistKeyContext(cached.id, context);
    return cached;
  }

  public async patchKey(
    id: string,
    options: KeyPatchOptions
  ): Promise<KeyResponse> {
    let context = options.context;

    if (!context && options.server) {
      context = await this.serverManagerOf(options.server).self.createContext();
    }

    const body: Record<string, unknown> = {};

    if (options.metadata !== undefined) {
      body.metadata = options.metadata;
    }

    if (context) {
      body.key = b2h(context.header.key);
      body.iv = b2h(context.header.iv);
    }

    if (!Object.keys(body).length) {
      throw new Error("patchKey called without any fields to update.");
    }

    const response = await this.fetch<KeyResponse>(`/keys/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    const cached = this.cacheKeyResponse(response);

    if (context) {
      await this.persistKeyContext(id, context);
    } else if (this.keyCache?.persistEncryptedKey) {
      await this.keyCache.persistEncryptedKey(
        id,
        h2b(cached.key),
        h2b(cached.iv)
      );
    }

    return cached;
  }

  public async deleteKey(id: string): Promise<void> {
    await this.fetch(`/keys/${id}`, { method: "DELETE" });
    this.keyResponseCache.delete(id);
  }

  public async decryptKey(key: string | KeyResponse) {
    const keyId = typeof key === "string" ? key : key.id;
    const cache = this.keyCache;

    if (keyId && cache?.getDecryptedKey) {
      const cachedContext = await cache.getDecryptedKey(keyId);
      if (cachedContext) {
        return {
          header: cachedContext.header,
          key: Buffer.from(cachedContext.key, "base64"),
          iv: Buffer.from(cachedContext.iv, "base64"),
        };
      }
    }

    const keyResponse = await this.getKey(key);
    const serverManager = this.serverManagerOf(keyResponse.server);
    const context = await serverManager.self.decryptContext({
      key: h2b(keyResponse.key),
      iv: h2b(keyResponse.iv),
    });

    if (keyId) {
      await this.persistKeyContext(keyId, context);
    }

    return context;
  }

  public async insertObject<T>(
    options: ObjectInsertOptions<T>
  ): Promise<ObjectResponse> {
    const { keyId, context } = await this.prepareObjectEncryption({
      keyId: options.keyId,
      keyServer: options.keyServer,
      keyMetadata: options.keyMetadata,
      context: options.context,
      fallbackKeyId: options.fallbackKeyId,
    });

    const encrypted = await this.encryptContent(options.content, context);

    const body: Record<string, unknown> = {
      keyId: keyId,
      content: encrypted.content,
      authTag: encrypted.auth_tag,
    };

    if (options.metadata !== undefined) {
      body.metadata = options.metadata;
    }

    if (options.relatedObjectId !== undefined) {
      body.related_object_id = options.relatedObjectId;
    }

    const response = await this.fetch<ObjectResponse>("/objects", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    return this.cacheObjectResponse(response);
  }

  public async patchObject<T>(
    id: string,
    options: ObjectPatchOptions<T>
  ): Promise<ObjectResponse> {
    const current = await this.getObject(id);
    let keyId = options.keyId ?? current.key_id;

    const body: Record<string, unknown> = {};

    if (options.metadata !== undefined) {
      body.metadata = options.metadata;
    }

    if (options.relatedObjectId !== undefined) {
      body.related_object_id = options.relatedObjectId;
    }

    if (options.content !== undefined) {
      const { keyId: resolvedKeyId, context } =
        await this.prepareObjectEncryption({
          keyId,
          keyServer: options.keyServer,
          keyMetadata: options.keyMetadata,
          context: options.context,
          fallbackKeyId: options.fallbackKeyId ?? current.key_id,
        });
      keyId = resolvedKeyId;
      const encrypted = await this.encryptContent(options.content, context);
      body.key_id = keyId;
      body.content = encrypted.content;
      body.auth_tag = encrypted.auth_tag;
    } else {
      body.key_id = keyId;
    }

    const response = await this.fetch<ObjectResponse>(`/objects/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    return this.cacheObjectResponse(response);
  }

  public async deleteObject(id: string): Promise<void> {
    const existing = this.objectCache.get(id);
    await this.fetch(`/objects/${id}`, { method: "DELETE" });
    this.objectCache.delete(id);
    this.relatedObjectsCache.delete(id);
    if (existing?.related_object_id) {
      this.relatedObjectsCache.delete(existing.related_object_id);
    }
  }

  public async refreshRemotes(): Promise<RemoteServer<T>[]> {
    const data = await this.fetch<RemoteResponse>("/server");
    const remotes: RemoteServer<T>[] = [];

    for (const [name, keyData] of Object.entries(data.keys)) {
      const publicKey = await this.provider.crypto.parsePublicKey(
        keyData["application/pkix-spki"]
      );
      remotes.push(new RemoteServer<T>(name, publicKey, this.provider));
    }

    this.remoteNameValue = data.current.toLocaleLowerCase();
    this.remotes = remotes;
    return remotes;
  }

  public async refreshRoot(): Promise<Server<T>[]> {
    const data = await this.fetch<RootResponse>("/root");
    const servers: Server<T>[] = [];

    for (const [name, keyData] of Object.entries(data.servers)) {
      const publicKey = await this.provider.crypto.parsePublicKey(
        keyData.publicKey
      );

      if (keyData.privateKey) {
        const privateKey = await this.provider.crypto.parsePrivateKey(
          keyData.privateKey
        );

        servers.push(
          new CurrentServer<T>(name, publicKey, privateKey, this.provider)
        );
        continue;
      }

      const localItem = this.localAuth?.find(
        (item) => item.publicKey === keyData.publicKey
      );

      if (localItem) {
        const privateKey = await this.provider.crypto.parsePrivateKey(
          localItem.privateKey
        );
        servers.push(
          new CurrentServer<T>(name, publicKey, privateKey, this.provider)
        );
      } else {
        servers.push(new RemoteServer<T>(name, publicKey, this.provider));
      }
    }

    this.servers = servers;
    this.storesValue = data.stores;
    return servers;
  }

  public currentServerNames(): string[] {
    assert(
      this.servers.length,
      "Root metadata not loaded. Call refreshRoot first."
    );
    return this.servers
      .filter(
        (server): server is CurrentServer<T> => server instanceof CurrentServer
      )
      .map((server) => server.name);
  }

  public defaultCurrentServerName(): string {
    const servers = this.currentServerNames();
    assert(servers.length > 0, "No current servers available.");
    const preferred = servers.find((name) => name === "default");
    return (preferred ?? servers[0]).toLocaleLowerCase();
  }

  public getCurrentServer(name?: string): CurrentServer<T> {
    const target = (
      name ?? this.defaultCurrentServerName()
    ).toLocaleLowerCase();
    const server = this.servers.find(
      (item): item is CurrentServer<T> =>
        item instanceof CurrentServer && item.name === target
    );
    assert(server, `Current server '${target}' was not found.`);
    return server;
  }

  /**
   * Publishes an object by encrypting its payload with the current remote server
   * and inserting a transient object consumed by the backend job handler.
   */
  public async publishObject(type: string, relatedId: string): Promise<void> {
    assert(
      this.remoteNameValue,
      "Remote metadata not loaded. Call refreshRemotes first."
    );

    const targetName = this.remoteNameValue;
    const remote = this.remotes.find((server) => server.name === targetName);
    assert(remote, "Remote server not available.");

    const baseObject = await this.getObject(relatedId);
    const payload = await this.decryptObject(baseObject);
    const metadata =
      baseObject.metadata && typeof baseObject.metadata === "object"
        ? baseObject.metadata
        : {};
    const context = await remote.createContext();

    const keyResponse = await this.fetch<KeyResponse>("/keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        server: remote.name,
        key: b2h(context.header.key),
        iv: b2h(context.header.iv),
      }),
    });

    this.cacheKeyResponse(keyResponse);
    await this.persistKeyContext(keyResponse.id, context);

    const encrypted = await Server.encrypt(
      context,
      Buffer.from(JSON.stringify(payload ?? null), "utf-8"),
      this.provider
    );

    const created = await this.fetch<ObjectResponse>("/objects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        key_id: keyResponse.id,
        related_object_id: relatedId,
        content: b2h(encrypted.content),
        auth_tag: b2h(encrypted.authTag),
        metadata,
      }),
    });

    this.cacheObjectResponse(created);

    await this.fetch(
      `/objects/publish/${encodeURIComponent(type)}/${encodeURIComponent(
        relatedId
      )}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ objectId: created.id }),
      }
    );
  }

  /**
   * Cancels an active publish job for the given object identifier.
   */
  public async unpublishObject(type: string, relatedId: string): Promise<void> {
    await this.fetch(
      `/objects/publish/${encodeURIComponent(type)}/${encodeURIComponent(
        relatedId
      )}`,
      {
        method: "DELETE",
      }
    );
  }

  public serverManagerOf(name: string): ServerManager<T> {
    assert(
      this.servers.length,
      "Root metadata not loaded. Call refreshRoot before getManager."
    );
    assert(
      this.remotes.length,
      "Remote metadata not loaded. Call refreshRemotes before getManager."
    );

    const allServers = [...this.servers, ...this.remotes];
    const server = allServers.find((item) => item.name === name);
    assert(
      server instanceof CurrentServer,
      `Server with name ${name} doesn't contain a private key.`
    );

    const remoteServers = allServers.filter(
      (item): item is RemoteServer<T> => item instanceof RemoteServer
    );

    return new ServerManager<T>(server, remoteServers, this.provider);
  }

  private cacheObjectResponse(object: ObjectResponse): ObjectResponse {
    this.objectCache.set(object.id, object);
    this.relatedObjectsCache.delete(object.id);
    if (object.related_object_id) {
      this.relatedObjectsCache.delete(object.related_object_id);
    }
    return object;
  }

  private cacheKeyResponse(key: KeyResponse): KeyResponse {
    this.keyResponseCache.set(key.id, key);
    return key;
  }

  private async persistKeyContext(
    keyId: string,
    context: EncryptionContext
  ): Promise<void> {
    const cache = this.keyCache;
    if (!cache) {
      return;
    }

    const tasks: Promise<void>[] = [];

    if (cache.persistDecryptedKey) {
      tasks.push(
        cache.persistDecryptedKey(
          keyId,
          context.key.toString("base64"),
          context.iv.toString("base64"),
          context.header
        )
      );
    }

    if (cache.persistEncryptedKey) {
      tasks.push(
        cache.persistEncryptedKey(keyId, context.header.key, context.header.iv)
      );
    }

    if (tasks.length) {
      await Promise.allSettled(tasks);
    }
  }

  private async prepareObjectEncryption(
    options: ObjectEncryptionOptions
  ): Promise<{ keyId: string; context: EncryptionContext }> {
    let { keyId, context } = options;

    if (keyId && context) {
      await this.persistKeyContext(keyId, context);
      return { keyId, context };
    }

    if (keyId) {
      if (!context) {
        context = await this.decryptKey(keyId);
      }
      return { keyId, context };
    }

    let server = options.keyServer;

    if (!server && options.fallbackKeyId) {
      const fallbackKey = await this.getKey(options.fallbackKeyId);
      server = fallbackKey.server;
    }

    if (!server) {
      throw new Error("A key server must be provided to create a new key.");
    }

    if (!context) {
      context = await this.serverManagerOf(server).self.createContext();
    }

    const keyResponse = await this.insertKey({
      server,
      metadata: options.keyMetadata,
      context,
    });

    return { keyId: keyResponse.id, context };
  }

  private async encryptContent(
    payload: unknown,
    context: EncryptionContext
  ): Promise<{ content: string; auth_tag: string }> {
    const serialized = JSON.stringify(payload === undefined ? null : payload);
    const buffer = Buffer.from(serialized, "utf-8");
    const encrypted = await Server.encrypt(context, buffer, this.provider);

    return {
      content: b2h(encrypted.content),
      auth_tag: b2h(encrypted.authTag),
    };
  }

  private resolveUrl(target: string | URL): string {
    const value = target instanceof URL ? target.toString() : target;
    if (/^https?:\/\//i.test(value)) {
      return value;
    }
    const suffix = value.startsWith("/") ? value : `/${value}`;
    return `${this.apiBase}${suffix}`;
  }
}
