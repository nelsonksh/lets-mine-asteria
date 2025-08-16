import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import {
  builtinByteString,
  conStr0,
  hexToString,
  integer,
  mConStr0,
  MeshTxBuilder,
  MeshWallet,
  SLOT_CONFIG_NETWORK,
  slotToBeginUnixTime,
  stringToHex,
} from "@meshsdk/core";
import {
  authAddress,
  authToken,
  fuelPolicy,
  provider,
  refScripts,
  shipPolicy,
  shipyardAddress,
} from "./common";

async function createShip(spawnX: number, spawnY: number) {
  dotenv.config();
  if (!process.env.PRIVATE_KEY) {
    throw new Error("PRIVATE_KEY not found in .env");
  }
  const wallet = new MeshWallet({
    networkId: 1,
    fetcher: provider,
    submitter: provider,
    key: {
      type: "root",
      bech32: process.env.PRIVATE_KEY,
    },
  });
  await wallet.init();
  const walletAddress = wallet.addresses.enterpriseAddressBech32;

  const tipSlot = Number((await provider.fetchLatestBlock()).slot);

  const invalidHereafter = tipSlot + 250;
  const invalidHereafterTimestamp = slotToBeginUnixTime(
    invalidHereafter,
    SLOT_CONFIG_NETWORK.mainnet
  );

  const walletUtxos = await wallet.getUtxos("enterprise");
  if (walletUtxos.length === 0) {
    throw new Error("Wallet is empty");
  }

  const adaOnlyUtxos = walletUtxos.filter(
    (utxo) =>
      utxo.output.amount.length === 1 &&
      utxo.output.amount[0].unit === "lovelace"
  );
  if (adaOnlyUtxos.length === 0) {
    throw new Error("There is no collateral UTxO");
  }

  let authUtxos = await provider.fetchAddressUTxOs(authAddress, authToken);
  if (!authUtxos || authUtxos.length === 0) {
    throw new Error("Auth UTxO not found");
  }
  const authUtxo = authUtxos[0];
  console.log("✓ Auth UTxO found");

  const spawnTimestamp = Date.now() + 1000 * 60 * 5; // Add 5 min to the current time
  console.log(`Ship spawn position: (${spawnX}, ${spawnY})`);
  console.log(`Ship spawn timestamp: ${spawnTimestamp}`);
  console.log("Invalid Hereafter:", invalidHereafterTimestamp);

  if (spawnTimestamp < invalidHereafterTimestamp) {
    console.error("❌ Transaction timing validation failed!");
    throw new Error("Transaction is invalid");
  }
  console.log("✓ Transaction timing is valid");

  const ships = (await provider.fetchAddressUTxOs(shipyardAddress)).filter(
    (u) => u.output.amount.some((a) => a.unit.substring(0, 56) === shipPolicy)
  );
  const shipsNos: number[] = [];
  ships.forEach((s) => {
    const ship = s.output.amount.find(
      (a) => a.unit.substring(0, 56) === shipPolicy
    );
    const shipName = hexToString(ship!.unit.substring(56));
    shipsNos.push(parseInt(shipName.substring(4)));
  });
  const shipNo = shipsNos.length > 0 ? Math.max(...shipsNos) + 1 : 1;
  // Write ship no to .env file
  const envPath = path.join(process.cwd(), ".env");
  const envContent = `\nSHIP_NO=${shipNo}`;
  fs.appendFileSync(envPath, envContent);
  console.log(`Creating SHIP${shipNo} ...`);

  console.log("=== Building Transaction ===");
  console.log("⚠️ Only Utxos containing ADA only are used as inputs here");
  console.log("1. Inputs:");
  console.log(
    `   - Auth UTxO: ${authUtxo.input.txHash}#${authUtxo.input.outputIndex}`
  );
  for (const utxo of adaOnlyUtxos) {
    console.log(
      `   - User UTxO: ${utxo.input.txHash}#${utxo.input.outputIndex}`
    );
  }
  console.log("2. Minting:");
  console.log(`   - SHIP${shipNo} token: 1`);
  console.log(`   - PILOT${shipNo} token: 1`);
  console.log(`   - FUEL tokens: 5`);
  console.log("3. Outputs:");
  console.log(`   - Ship to shipyard with 5 fuel`);
  console.log(`   - Updated auth token`);
  console.log(`   - Pilot token to wallet`);

  const txBuilder = new MeshTxBuilder({
    fetcher: provider,
    evaluator: provider,
  });
  const tx = await txBuilder
    .setNetwork("mainnet")
    // Choose from wallet UTxOs
    .selectUtxosFrom(adaOnlyUtxos)

    // Auth UTxO spending (script spending)
    .spendingPlutusScriptV3()
    .txIn(authUtxo.input.txHash, authUtxo.input.outputIndex)
    .txInInlineDatumPresent()
    .spendingTxInReference(refScripts, 1)
    .txInRedeemerValue(mConStr0([]))

    // Mint SHIP token
    .mintPlutusScriptV3()
    .mint("1", shipPolicy, stringToHex("SHIP" + shipNo.toString()))
    .mintTxInReference(refScripts, 0)
    .mintReferenceTxInRedeemerValue(mConStr0([]))
    // Mint PILOT token
    .mintPlutusScriptV3()
    .mint("1", shipPolicy, stringToHex("PILOT" + shipNo.toString()))
    .mintTxInReference(refScripts, 0)
    .mintReferenceTxInRedeemerValue(mConStr0([]))
    // Mint FUEL tokens
    .mintPlutusScriptV3()
    .mint("5", fuelPolicy, stringToHex("FUEL"))
    .mintTxInReference(refScripts, 2)
    .mintReferenceTxInRedeemerValue(mConStr0([]))
    // Ship output to shipyard
    .txOut(shipyardAddress, [
      {
        unit: shipPolicy + stringToHex("SHIP" + shipNo.toString()),
        quantity: "1",
      },
      {
        unit: fuelPolicy + stringToHex("FUEL"),
        quantity: "5",
      },
    ])
    .txOutInlineDatumValue(
      conStr0([
        integer(spawnX),
        integer(spawnY),
        builtinByteString(stringToHex("SHIP" + shipNo.toString())),
        builtinByteString(stringToHex("PILOT" + shipNo.toString())),
        integer(spawnTimestamp),
      ]),
      "JSON"
    )
    // Updated auth token output
    .txOut(authAddress, [
      {
        unit: "lovelace",
        quantity: (
          Number(
            authUtxo.output.amount.find((a: any) => a.unit === "lovelace")!
              .quantity
          ) + 1000000
        ).toString(),
      },
      {
        unit: authToken,
        quantity: "1",
      },
    ])
    .txOutInlineDatumValue(
      conStr0([integer(shipNo + 1), builtinByteString(shipPolicy)]),
      "JSON"
    )
    // Pilot token to wallet
    .txOut(walletAddress!, [
      {
        unit: shipPolicy + stringToHex("PILOT" + shipNo.toString()),
        quantity: "1",
      },
    ])
    .invalidHereafter(invalidHereafter)

    .txInCollateral(
      adaOnlyUtxos[0].input.txHash,
      adaOnlyUtxos[0].input.outputIndex
    )
    .changeAddress(walletAddress!)
    .complete();

  console.log("✓ Transaction built successfully");

  const signedTx = await wallet.signTx(tx);
  const hash = await provider.submitTx(signedTx);

  console.log("✓ Transaction submitted successfully", hash);
}

// Get command line arguments
let args = process.argv.slice(2);
// Filter out '--' if present
args = args.filter((arg) => arg !== "--");

if (args.length < 2) {
  console.error("Usage: npm run create-ship -- <spawnX> <spawnY>");
  console.error("Example: npm run create-ship -- 16 -35");
  process.exit(1);
}

const spawnX = parseInt(args[0]);
const spawnY = parseInt(args[1]);

if (isNaN(spawnX) || isNaN(spawnY)) {
  console.error("Error: spawnX and spawnY must be valid numbers");
  console.error("Example: npm run create-ship -- 16 -35");
  process.exit(1);
}

createShip(spawnX, spawnY).catch(console.error);
