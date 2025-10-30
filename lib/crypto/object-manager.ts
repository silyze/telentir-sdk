import { assert } from "@mojsoski/assert";
import {
  CurrentServer,
  EncryptionContext,
  ICryptoProvider,
  RemoteServer,
  Server,
  ServerManager,
} from "@mojsoski/server-crypto";
import { h2b } from "../utils/hex";

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
}

export class ObjectManager<T> {
  private readonly provider: ICryptoProvider<T>;
  private readonly apiKey: string;
  private readonly apiBase: string;
  private readonly localAuth?: LocalAuth[];

  private remotes: RemoteServer<T>[] = [];
  private servers: Server<T>[] = [];
  private remoteNameValue?: string;
  private storesValue?: Record<string, { defaultKey: string; id: string }>;

  constructor(provider: ICryptoProvider<T>, config: ObjectManagerConfig) {
    assert(config.apiKey, "ObjectManager requires an apiKey.");
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

    if (!response.ok) {
      throw new Error(
        `Request failed: ${response.status} ${response.statusText}`
      );
    }

    return (await response.json()) as R;
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

  public async decryptObject<T = unknown>(
    object: string | ObjectResponse,
    context?: EncryptionContext
  ) {
    object =
      typeof object === "string"
        ? await this.fetch<ObjectResponse>(`/objects/${object}`)
        : object;
    context ??= await this.decryptKey(object.key_id);

    const content = await Server.decrypt(
      context,
      {
        authTag: h2b(object.auth_tag),
        content: h2b(object.content),
      },
      this.provider
    );

    return JSON.parse(content.toString("utf-8")) as T;
  }

  public async decryptKey(key: string | KeyResponse) {
    key =
      typeof key === "string"
        ? await this.fetch<KeyResponse>(`/keys/${key}`)
        : key;
    const serverManager = this.serverManagerOf(key.server);
    return await serverManager.self.decryptContext({
      key: h2b(key.key),
      iv: h2b(key.iv),
    });
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

    this.remoteNameValue = data.current;
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

  private resolveUrl(target: string | URL): string {
    const value = target instanceof URL ? target.toString() : target;
    if (/^https?:\/\//i.test(value)) {
      return value;
    }
    const suffix = value.startsWith("/") ? value : `/${value}`;
    return `${this.apiBase}${suffix}`;
  }
}
