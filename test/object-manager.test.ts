import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { InMemoryKeyCache, ObjectManager } from "../lib/crypto";
import {
  BrowserCrypto,
  CurrentServer,
  Server,
  type EncryptedHeader,
} from "@mojsoski/server-crypto";
import jose from "jose";
import { b2h, h2b } from "../lib/utils/hex";
import { webcrypto } from "crypto";

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

interface TestState {
  serverName: string;
  serverPublicKey: string;
  serverPrivateKey: string;
  serverPublicJwk: object;
  stores: Record<string, { defaultKey: string; id: string }>;
  keys: Map<
    string,
    {
      response: KeyResponse;
      header: EncryptedHeader;
    }
  >;
  objects: Map<string, ObjectResponse>;
  relations: Map<string, Set<string>>;
  keyCounter: number;
  objectCounter: number;
}

const API_BASE = "https://api.test";
const USER_ID = "user-1";

if (!globalThis.crypto) {
  // Ensure WebCrypto is available when running under Node.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).crypto = webcrypto;
}

const provider = new BrowserCrypto(jose);
let currentServer: CurrentServer<CryptoKey>;
let serverPublicKey: string;
let serverPrivateKey: string;
let serverPublicJwk: object;

beforeAll(async () => {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 2048,
      publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
      hash: "SHA-256",
    },
    true,
    ["encrypt", "decrypt"]
  );

  serverPublicKey = await provider.crypto.stringifyPublicKey(keyPair.publicKey);
  serverPrivateKey = await provider.crypto.stringifyPrivateKey(
    keyPair.privateKey
  );
  serverPublicJwk = await provider.crypto.jwkPublicKey(keyPair.publicKey);
  currentServer = new CurrentServer<CryptoKey>(
    "main",
    keyPair.publicKey,
    keyPair.privateKey,
    provider
  );
});

describe("ObjectManager", () => {
  let state: TestState;
  let manager: ObjectManager<CryptoKey>;

  beforeEach(async () => {
    state = await createInitialState();
    const fetchMock = buildFetchStub(state);
    vi.stubGlobal("fetch", fetchMock);

    manager = await ObjectManager.create(provider, {
      apiKey: "test-token",
      api: API_BASE,
      keyCache: new InMemoryKeyCache(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("decrypts related objects using the contacts store", async () => {
    const contactsStoreId = state.stores.contacts.id;

    const decrypted = await manager.decryptRelatedObjects<{ name: string }>(
      contactsStoreId
    );

    expect(decrypted).toEqual([{ name: "Alice" }]);
  });

  it("inserts a new object with a freshly generated key and decrypts it", async () => {
    const initialKeyCount = state.keys.size;
    const contactsStoreId = state.stores.contacts.id;
    const payload = { name: "Bob" };

    const created = await manager.insertObject({
      keyServer: state.serverName,
      keyMetadata: { scope: "contacts" },
      relatedObjectId: contactsStoreId,
      content: payload,
      metadata: { tag: "friend" },
    });

    expect(state.objects.has(created.id)).toBe(true);
    expect(state.keys.size).toBeGreaterThan(initialKeyCount);

    const decrypted = await manager.decryptObject<typeof payload>(created.id);
    expect(decrypted).toEqual(payload);
  });

  it("patches an existing object without rotating its key", async () => {
    const contact = [...state.objects.values()].find(
      (item) => item.related_object_id === state.stores.contacts.id
    );
    expect(contact).toBeDefined();
    const contactId = contact!.id;
    const originalKeyId = contact!.key_id;
    const updatedPayload = { name: "Alice Updated" };

    const patched = await manager.patchObject(contactId, {
      content: updatedPayload,
      metadata: { tag: "updated" },
    });

    expect(patched.key_id).toBe(originalKeyId);
    const decrypted = await manager.decryptObject<typeof updatedPayload>(
      contactId
    );
    expect(decrypted).toEqual(updatedPayload);
  });

  it("deletes an object and removes it from related results", async () => {
    const contact = [...state.objects.values()].find(
      (item) => item.related_object_id === state.stores.contacts.id
    );
    expect(contact).toBeDefined();
    const contactId = contact!.id;

    await manager.deleteObject(contactId);

    expect(state.objects.has(contactId)).toBe(false);
    const related = await manager.getRelatedObjects(state.stores.contacts.id);
    expect(related.some((item) => item.id === contactId)).toBe(false);
  });
});

function now(): string {
  return new Date().toISOString();
}

async function createInitialState(): Promise<TestState> {
  const context = await currentServer.createContext();
  const keyId = "key-1";

  const keyResponse: KeyResponse = {
    id: keyId,
    metadata: {},
    created_at: now(),
    updated_at: now(),
    user_id: USER_ID,
    server: "main",
    key: b2h(context.header.key),
    iv: b2h(context.header.iv),
  };

  const stores = {
    contacts: {
      id: "store-contacts",
      defaultKey: keyId,
    },
  };

  const state: TestState = {
    serverName: "main",
    serverPublicKey,
    serverPrivateKey,
    serverPublicJwk,
    stores,
    keys: new Map(),
    objects: new Map(),
    relations: new Map(),
    keyCounter: 2,
    objectCounter: 2,
  };

  state.keys.set(keyId, {
    response: keyResponse,
    header: context.header,
  });

  const storePayload = { title: "Contacts Store" };
  const storeEncrypted = await Server.encrypt(
    context,
    Buffer.from(JSON.stringify(storePayload), "utf-8"),
    provider
  );

  const storeObject: ObjectResponse = {
    id: stores.contacts.id,
    metadata: {},
    created_at: now(),
    updated_at: now(),
    user_id: USER_ID,
    key_id: keyId,
    auth_tag: b2h(storeEncrypted.authTag),
    content: b2h(storeEncrypted.content),
    related_object_id: "root",
  };

  addObject(state, storeObject);

  const contactPayload = { name: "Alice" };
  const contactEncrypted = await Server.encrypt(
    context,
    Buffer.from(JSON.stringify(contactPayload), "utf-8"),
    provider
  );

  const contactObject: ObjectResponse = {
    id: "object-1",
    metadata: {},
    created_at: now(),
    updated_at: now(),
    user_id: USER_ID,
    key_id: keyId,
    auth_tag: b2h(contactEncrypted.authTag),
    content: b2h(contactEncrypted.content),
    related_object_id: stores.contacts.id,
  };

  addObject(state, contactObject);

  return state;
}

function addObject(state: TestState, object: ObjectResponse): void {
  const existing = state.objects.get(object.id);
  if (existing) {
    removeRelation(state, existing.related_object_id, existing.id);
  }

  state.objects.set(object.id, object);

  if (object.related_object_id) {
    let set = state.relations.get(object.related_object_id);
    if (!set) {
      set = new Set<string>();
      state.relations.set(object.related_object_id, set);
    }
    set.add(object.id);
  }
}

function removeRelation(
  state: TestState,
  parentId: string,
  childId: string
): void {
  const set = state.relations.get(parentId);
  if (!set) {
    return;
  }
  set.delete(childId);
  if (!set.size) {
    state.relations.delete(parentId);
  }
}

function buildFetchStub(state: TestState) {
  return vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const request =
        input instanceof Request
          ? input
          : new Request(
              typeof input === "string" ? input : input.toString(),
              init
            );
      const url = new URL(request.url);
      const method = (request.method ?? "GET").toUpperCase();
      const path = url.pathname;

      const readJson = async () => {
        const text = await request.text();
        return text.length ? (JSON.parse(text) as Record<string, unknown>) : {};
      };

      if (method === "GET" && path === "/server") {
        return jsonResponse({
          current: state.serverName,
          keys: {
            [state.serverName]: {
              "application/pkix-spki": state.serverPublicKey,
              "application/jwk+json": state.serverPublicJwk,
            },
          },
        });
      }

      if (method === "GET" && path === "/root") {
        return jsonResponse({
          stores: state.stores,
          servers: {
            [state.serverName]: {
              publicKey: state.serverPublicKey,
              privateKey: state.serverPrivateKey,
              deprecated: false,
            },
          },
        });
      }

      if (path.startsWith("/keys")) {
        const resourceId = path.split("/")[2];

        if (method === "GET" && resourceId) {
          const record = state.keys.get(resourceId);
          if (!record) {
            return notFound(`Key ${resourceId} not found`);
          }
          return jsonResponse(record.response);
        }

        if (method === "POST" && path === "/keys") {
          const body = await readJson();
          const id = `key-${state.keyCounter++}`;
          const created = now();

          const keyHex = String(body.key ?? "");
          const ivHex = String(body.iv ?? "");
          const header: EncryptedHeader = {
            key: h2b(keyHex),
            iv: h2b(ivHex),
          };

          const response: KeyResponse = {
            id,
            metadata: (body.metadata as object) ?? {},
            created_at: created,
            updated_at: created,
            user_id: USER_ID,
            server: String(body.server ?? state.serverName),
            key: keyHex,
            iv: ivHex,
          };

          state.keys.set(id, { response, header });
          return jsonResponse(response, 201);
        }

        if (method === "PATCH" && resourceId) {
          const record = state.keys.get(resourceId);
          if (!record) {
            return notFound(`Key ${resourceId} not found`);
          }

          const body = await readJson();
          const updated = { ...record.response };

          if (body.metadata !== undefined) {
            updated.metadata = body.metadata as object;
          }

          if (body.key !== undefined && body.iv !== undefined) {
            const keyHex = String(body.key);
            const ivHex = String(body.iv);
            record.header = { key: h2b(keyHex), iv: h2b(ivHex) };
            updated.key = keyHex;
            updated.iv = ivHex;
          }

          if (body.server !== undefined) {
            updated.server = String(body.server);
          }

          updated.updated_at = now();
          record.response = updated;
          state.keys.set(resourceId, record);
          return jsonResponse(updated);
        }

        if (method === "DELETE" && resourceId) {
          state.keys.delete(resourceId);
          return new Response(null, { status: 204 });
        }
      }

      if (path.startsWith("/objects")) {
        const segments = path.split("/");
        const resourceId = segments[2];

        if (method === "GET" && segments.length === 3 && resourceId) {
          const object = state.objects.get(resourceId);
          if (!object) {
            return notFound(`Object ${resourceId} not found`);
          }
          return jsonResponse(object);
        }

        if (
          method === "GET" &&
          segments.length === 4 &&
          resourceId &&
          segments[3] === "related"
        ) {
          const relatedIds =
            state.relations.get(resourceId) ?? new Set<string>();
          const objects = [...relatedIds]
            .map((id) => state.objects.get(id))
            .filter((item): item is ObjectResponse => Boolean(item));
          return jsonResponse(objects);
        }

        if (method === "POST" && path === "/objects") {
          const body = await readJson();
          const id = `object-${state.objectCounter++}`;
          const created = now();

          const response: ObjectResponse = {
            id,
            metadata: (body.metadata as object) ?? {},
            created_at: created,
            updated_at: created,
            user_id: USER_ID,
            key_id: String(body.key_id),
            auth_tag: String(body.auth_tag),
            content: String(body.content),
            related_object_id: String(body.related_object_id ?? ""),
          };

          addObject(state, response);
          return jsonResponse(response, 201);
        }

        if (method === "PATCH" && resourceId) {
          const existing = state.objects.get(resourceId);
          if (!existing) {
            return notFound(`Object ${resourceId} not found`);
          }

          const body = await readJson();
          const updated: ObjectResponse = {
            ...existing,
            metadata:
              body.metadata !== undefined
                ? (body.metadata as object)
                : existing.metadata,
            key_id:
              body.key_id !== undefined ? String(body.key_id) : existing.key_id,
            auth_tag:
              body.auth_tag !== undefined
                ? String(body.auth_tag)
                : existing.auth_tag,
            content:
              body.content !== undefined
                ? String(body.content)
                : existing.content,
            related_object_id:
              body.related_object_id !== undefined
                ? String(body.related_object_id)
                : existing.related_object_id,
            updated_at: now(),
          };

          removeRelation(state, existing.related_object_id, existing.id);
          addObject(state, updated);
          return jsonResponse(updated);
        }

        if (method === "DELETE" && resourceId) {
          const existing = state.objects.get(resourceId);
          if (existing) {
            removeRelation(state, existing.related_object_id, existing.id);
            state.objects.delete(resourceId);
            state.relations.delete(resourceId);
          }
          return new Response(null, { status: 204 });
        }
      }

      return notFound(`Unhandled request: ${method} ${path}`);
    }
  );
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function notFound(message: string): Response {
  return new Response(message, { status: 404 });
}
