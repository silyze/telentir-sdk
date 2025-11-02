import { assert } from "@mojsoski/assert";
import { ObjectManager } from "../crypto";

/**
 * Generic repository wrapper around encrypted Telentir object stores.
 *
 * @typeParam T - Crypto key representation.
 * @typeParam TModel - Shape of the decrypted object payload.
 */
export class ObjectRepository<T, TModel extends object> {
  private constructor(
    private manager: ObjectManager<T>,
    private rootId: string,
    private description: string,
    private defaultKey: string
  ) {}

  /**
   * Creates a repository instance bound to a named store.
   *
   * @param manager - Shared {@link ObjectManager} instance.
   * @param name - Store identifier as returned by `/api/root`.
   */
  static create<T, TModel extends object>(
    manager: ObjectManager<T>,
    name: string
  ) {
    return new ObjectRepository<T, TModel>(
      manager,
      manager.stores[name].id,
      name,
      manager.stores[name].defaultKey
    );
  }

  /**
   * Retrieves and decrypts every object within the store.
   */
  async all(): Promise<Array<TModel & { id: string }>> {
    const related = await this.manager.getRelatedObjects(this.rootId);
    const uniqueKeyIds = Array.from(
      new Set(related.map((item) => item.key_id))
    );

    type DecryptionContext = Awaited<
      ReturnType<ObjectManager<T>["decryptKey"]>
    >;

    const contextByKey = new Map<string, DecryptionContext>();

    await Promise.all(
      uniqueKeyIds.map(async (keyId) =>
        contextByKey.set(keyId, await this.manager.decryptKey(keyId))
      )
    );

    return Promise.all(
      related.map(async (item) => {
        const decrypted = await this.manager.decryptObject<TModel>(
          item,
          contextByKey.get(item.key_id)
        );
        return { ...decrypted, id: item.id } as TModel & { id: string };
      })
    );
  }

  /**
   * Fetches and decrypts a single object, asserting it belongs to this store.
   */
  async get(id: string): Promise<TModel & { id: string }> {
    const obj = await this.manager.getObject(id);
    assert(
      obj.related_object_id === this.rootId,
      `'${id}' is not a valid instance of ${this.description}`
    );
    const decrypted = await this.manager.decryptObject<TModel>(obj);
    return { ...decrypted, id: obj.id } as TModel & { id: string };
  }

  /**
   * Removes an object from the Telentir store.
   */
  async delete(id: string): Promise<void> {
    const obj = await this.manager.getObject(id);
    assert(
      obj.related_object_id === this.rootId,
      `'${id}' is not a valid instance of ${this.description}`
    );
    await this.manager.deleteObject(id);
  }

  /**
   * Inserts a new object into the store using the default key.
   *
   * @param payload - Plain JSON payload to encrypt.
   * @returns Created object identifier.
   */
  async create(payload: TModel): Promise<string> {
    const obj = await this.manager.insertObject<TModel>({
      relatedObjectId: this.rootId,
      content: payload,
      keyId: this.defaultKey,
    });
    return obj.id;
  }

  /**
   * Replaces the encrypted content of an existing object.
   */
  async update(id: string, payload: TModel) {
    const obj = await this.manager.getObject(id);
    assert(
      obj.related_object_id === this.rootId,
      `'${id}' is not a valid instance of ${this.description}`
    );
    await this.manager.patchObject(id, { content: payload, keyId: obj.key_id });
  }

  private resolveId(input: string | { id: string }): string {
    if (typeof input === "string") {
      return input;
    }
    return input.id;
  }

  /**
   * Publishes an object, triggering downstream jobs (e.g., campaign execution).
   */
  async publish(id: string | { id: string }): Promise<void> {
    await this.manager.publishObject(this.description, this.resolveId(id));
  }

  /**
   * Stops an active publish job for the given object.
   */
  async unpublish(id: string | { id: string }): Promise<void> {
    await this.manager.unpublishObject(this.description, this.resolveId(id));
  }
}
