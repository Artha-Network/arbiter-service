/**
 * Generate ed25519 keypair for the arbiter
 * Usage: node scripts/generate-keypair.js
 */

import nacl from "tweetnacl";

function generateKeypair() {
  const keypair = nacl.sign.keyPair();

  // Extract the 32-byte seed from the 64-byte secret key
  const seed = keypair.secretKey.slice(0, 32);
  const seedHex = Buffer.from(seed).toString("hex");
  const publicHex = Buffer.from(keypair.publicKey).toString("hex");

  console.log("🔐 New Arbiter Keypair Generated");
  console.log("================================");
  console.log("");
  console.log("Secret Key Seed (add to .env as ARBITER_ED25519_SECRET_HEX):");
  console.log(seedHex);
  console.log("");
  console.log("Public Key (register onchain as authorized arbiter):");
  console.log(publicHex);
  console.log("");
  console.log("⚠️  Keep the secret key secure and never share it!");
  console.log(
    "✅ The public key should be added to your onchain arbiter allowlist"
  );
}

generateKeypair();
