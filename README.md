# Telentir SDK

TypeScript client for interacting with the Telentir platform. It wraps
the REST API, encrypted object stores and helper endpoints required to
manage campaigns, contacts, knowledge bases, and more.

## Installation

```bash
npm install @silyze/telentir-sdk
```

Then install the needed dependencies for `BrowserCrypto` or `NodeCrypto`:

```bash
# for BrowserCrypto
npm install jose

# for NodeCrypto
npm install jsonwebtoken
```

## Quick Start

```ts
import "dotenv/config";
import { Telentir, crypto } from "@silyze/telentir-sdk";

async function main() {
  const telentir = await Telentir.connect({
    apiKey: process.env.TELENTIR_API_KEY!,
    crypto: new crypto.BrowserCrypto(await import("jose")),
    keyCache: new crypto.InMemoryKeyCache(), // optional
  });

  const contacts = await telentir.contacts.all();
  console.log(contacts);
}

void main();
```

## Key Cache Implementations

Telentir ships with several cache adapters for reusing encryption keys across requests:

- `InMemoryKeyCache` keeps data in process memory with optional TTL and max entries.
- `FsKeyCache` persists encrypted material to disk. Pass Node's `fs/promises` and a directory, for example:

  ```ts
  import { promises as fs } from "fs";

  const keyCache = new crypto.FsKeyCache(fs, {
    directory: "./.telentir-keys",
    ttlMs: 15 * 60_000,
  });
  ```

- `StorageKeyCache` targets Web Storage implementations like `localStorage` or `sessionStorage`:

  ```ts
  const keyCache = new crypto.StorageKeyCache(window.localStorage, {
    ttlMs: 5 * 60_000,
    maxEntries: 100,
  });
  ```

## Working with Repositories

### Contacts

```ts
const createdId = await telentir.contacts.create({
  name: "Simeon",
  phone: "+123456789",
  tags: ["vip"],
  status: "active",
});

const contact = await telentir.contacts.get(createdId);

await telentir.contacts.update(createdId, { ...contact, status: "inactive" });
await telentir.contacts.delete(createdId);
```

#### Fetching leads via `/api/connect`

```ts
await telentir.contacts.fetchLeads({
  credits: 25,
  industry: ["software"],
  country: ["US"],
});
```

### Campaigns

```ts
const campaignId = await telentir.campaigns.create({
  name: "Spring Outreach",
  type: "prompt",
  prompt: { text: "Call and schedule a demo." },
  agents: [],
  contacts: { tags: ["warm"], items: [] },
  relations: {},
});

// Start the campaign (encrypts for the remote server and triggers jobs)
await telentir.campaigns.publish(campaignId);

// Stop it when needed
await telentir.campaigns.unpublish(campaignId);
```

### Knowledge Bases

```ts
const kb = await telentir.knowledgeBases.create({
  name: "Support Playbook",
  description: "Support processes and scripts",
});

await telentir.knowledgeBases.uploadLinks(kb.id, [
  "https://example.com/process",
  "https://example.com/scripts",
]);

const results = await telentir.knowledgeBases.search(kb.id, "refund policy");
console.log(results);
```

### Session Calls

Use `telentir.sessions.call` to generate the JWT and start the call in a single step (you can still access `createCallJwt` and `startCall` individually if needed).

```ts
await telentir.sessions.call({
  type: "prompt",
  prompt: "Reach out and collect feedback.",
  contact: {
    id: contactId,
    name: "Mihail",
    phone: "+111111111",
    tags: [],
    status: "active",
  },
  agent: {
    id: agentId,
    type: "ai",
    persona: "openai-verse",
    avatar: "",
    firstName: "Demo",
    lastName: "Agent",
    language: "en",
  },
});
```

## Billing & Credits

```ts
const state = await telentir.billing.getState();
console.log(state.plan, state.usage);
```

## Events Stream

```ts
const abort = new AbortController();

for await (const event of telentir.events.listen("object_created", undefined, {
  signal: abort.signal,
})) {
  console.log("object created", event);
}

abort.abort();
```
