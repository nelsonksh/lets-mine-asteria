import { MeshWallet } from "@meshsdk/core";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

function createAddress() {
  const privatekey = MeshWallet.brew(true);

  // Write private key to .env file
  const envPath = path.join(process.cwd(), ".env");

  // Create .env file if it doesn't exist
  if (!fs.existsSync(envPath)) {
    fs.writeFileSync(envPath, "# Environment variables\n");
  }

  const envContent = `\nPRIVATE_KEY=${privatekey}`;

  fs.appendFileSync(envPath, envContent);

  console.log("Private key recorded to .env file");
  return privatekey;
}

async function logAddress() {
  // Load environment variables from .env file
  dotenv.config();

  if (!process.env.PRIVATE_KEY) {
    console.error("PRIVATE_KEY not found in environment variables");
    return;
  }

  const wallet = new MeshWallet({
    networkId: 1,
    key: {
      type: "root",
      bech32: process.env.PRIVATE_KEY,
    },
  });
  await wallet.init();
  console.log("Fresh address:", wallet.addresses.enterpriseAddressBech32);
}

async function main() {
  createAddress();
  await logAddress();
}

main().catch(console.error);
