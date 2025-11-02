import "dotenv/config";
import { crypto, Telentir } from "./lib";

async function main() {
  const telentir = await Telentir.connect({
    apiKey: process.env.TELENTIR_API_KEY!,

    // what crypto implementation should we use? BrowserCrypto, NodeCrypto or some custom implementation
    crypto: new crypto.BrowserCrypto(
      // jose library for JWT generation (requirement for BrowserCrypto)
      await import("jose")
    ),

    // this is optional (speeds up decryption)
    keyCache: new crypto.InMemoryKeyCache(),
  });

  console.log(await telentir.contacts.all());
}

void main();
