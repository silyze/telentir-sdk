import "dotenv/config";
import { ObjectManager } from "./lib/crypto";
import { BrowserCrypto } from "@mojsoski/server-crypto";
import { assertNonNull } from "@mojsoski/assert";
import jose from "jose";

async function main() {
  assertNonNull(process.env.TELENTIR_API_KEY, "TELENTIR_API_KEY");

  const objectManager = await ObjectManager.create(new BrowserCrypto(jose), {
    apiKey: process.env.TELENTIR_API_KEY,
  });

  console.log(
    await objectManager.decryptObject("bb6a1b14-b6c6-4ef8-a28f-d88c75530d87")
  );
}

main().then();
