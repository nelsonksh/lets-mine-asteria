import * as dotenv from "dotenv";
import {
  builtinByteString,
  conStr0,
  conStr1,
  deserializeDatum,
  integer,
  MeshTxBuilder,
  MeshWallet,
  SLOT_CONFIG_NETWORK,
  posixTime as createPosixTime,
  stringToHex,
  slotToBeginUnixTime,
  unixTimeToEnclosingSlot,
} from "@meshsdk/core";
import {
  fuelPolicy,
  maxSpeedTime,
  provider,
  refScripts,
  shipPolicy,
  shipyardAddress,
} from "./common";

export async function moveShip(deltaX: number, deltaY: number) {
  dotenv.config();
  if (!process.env.PRIVATE_KEY) {
    throw new Error("PRIVATE_KEY not found in .env");
  }
  if (!process.env.SHIP_NO) {
    throw new Error("SHIP_NO not found in .env");
  }
  const shipNo = Number(process.env.SHIP_NO);

  const tipSlot = Number((await provider.fetchLatestBlock()).slot);
  console.log(`Current tip slot: `, tipSlot);

  console.log("=== Starting move-ship transaction ===");
  console.log(`Delta X: ${deltaX}, Delta Y: ${deltaY}`);

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
  const walletUtxos = await provider.fetchAddressUTxOs(walletAddress!);
  const adaOnlyUtxos = walletUtxos.filter(
    (utxo) =>
      utxo.output.amount.length === 1 &&
      utxo.output.amount[0].unit === "lovelace"
  );

  if (adaOnlyUtxos.length === 0) {
    console.error("❌ No ADA-only UTxO found for collateral");
    throw new Error("Need a UTxO with only ADA for collateral");
  }

  const shipUtxo = (
    await provider.fetchAddressUTxOs(
      shipyardAddress,
      shipPolicy + stringToHex("SHIP" + shipNo.toString())
    )
  )[0];

  console.log("✓ Ship UTxO found");

  const fuelToBurn = Math.abs(deltaX) + Math.abs(deltaY);
  const remainingFuel =
    Number(
      shipUtxo.output.amount.find(
        (a) => a.unit === fuelPolicy + stringToHex("FUEL")
      )?.quantity || 0
    ) -
    (Math.abs(deltaX) + Math.abs(deltaY));

  console.log(`Fuel consumption: ${Math.abs(deltaX) + Math.abs(deltaY)}`);
  console.log(`Remaining fuel: ${remainingFuel}`);

  if (remainingFuel < 0) {
    throw new Error(
      `Insufficient fuel! Need ${
        Math.abs(deltaX) + Math.abs(deltaY)
      } but only have ${Number(
        shipUtxo.output.amount.find(
          (a) => a.unit === fuelPolicy + stringToHex("FUEL")
        )?.quantity || 0
      )}`
    );
  }

  const pilotUtxo = walletUtxos.find((utxo) =>
    utxo.output.amount.some(
      (asset) =>
        asset.unit === shipPolicy + stringToHex("PILOT" + shipNo.toString())
    )
  );

  if (!pilotUtxo) {
    console.error("❌ Pilot token not found in wallet UTxOs");
    throw new Error("Pilot token not found in wallet UTxOs");
  }

  console.log("✓ Pilot UTxO found:");

  const currentDatum = shipUtxo.output.plutusData;
  const datumJson = deserializeDatum(currentDatum!);
  const currentX = parseInt(datumJson.fields[0]?.int?.toString());
  const currentY = parseInt(datumJson.fields[1]?.int?.toString());
  const lastMoveTime = parseInt(datumJson.fields[4]?.int?.toString());

  console.log(`Parsed current position: (${currentX}, ${currentY})`);


  // Calculate new position
  const newX = currentX + deltaX;
  const newY = currentY + deltaY;
  console.log(`New position: (${newX}, ${newY})`);

  const redeemer = conStr0([integer(deltaX), integer(deltaY)]);

  let last_move_latest_time = lastMoveTime + maxSpeedTime * fuelToBurn;
  const last_move_time_slot = unixTimeToEnclosingSlot(
    lastMoveTime,
    SLOT_CONFIG_NETWORK.mainnet
  );
  let validity_range_upper_bound;
  let validity_range_lower_bound;
  if (last_move_time_slot + (maxSpeedTime / 1000) * fuelToBurn <= tipSlot) {
    validity_range_upper_bound = tipSlot + 100;
    last_move_latest_time = slotToBeginUnixTime(validity_range_upper_bound + 1, SLOT_CONFIG_NETWORK.mainnet);
    validity_range_lower_bound = last_move_time_slot + 1
  } else {
    console.error(
      `❌ Ship timing validation failed! Last move time is too recent.\n\n`,
      `can move at: ${new Date(last_move_latest_time).toLocaleString()}\n\n`,
      `can move 1 step at: ${new Date(lastMoveTime + maxSpeedTime).toLocaleString()}\n\n`,
      `can move 2 steps at: ${new Date(lastMoveTime + 2 * maxSpeedTime).toLocaleString()}\n\n`,
      `can move 3 steps at: ${new Date(lastMoveTime + 3 * maxSpeedTime).toLocaleString()}\n\n`,
      `can move 4 steps at: ${new Date(lastMoveTime + 4 * maxSpeedTime).toLocaleString()}\n\n`,
      `can move 5 steps at: ${new Date(lastMoveTime + 5 * maxSpeedTime).toLocaleString()}`
    );
    throw new Error("Ship was moved too recently");
  }  

  const newDatum = conStr0([
    integer(newX),
    integer(newY),
    builtinByteString(stringToHex("SHIP" + shipNo.toString())),
    builtinByteString(stringToHex("PILOT" + shipNo.toString())),
    createPosixTime(last_move_latest_time),
  ]);

  try {
    console.log("Validations:");
    console.log("1. must_include_pilot_token:");
    console.log(JSON.stringify(pilotUtxo, null, 2));

    console.log("2. must_spend_one_ship_input:");
    console.log(JSON.stringify(shipUtxo, null, 2));

    console.log("3. must_respect_max_speed:");
    console.log((validity_range_upper_bound - validity_range_lower_bound) * 1000, " >= ", maxSpeedTime);

    console.log("4. must_respect_latest_time:");
    console.log(lastMoveTime, " < ", slotToBeginUnixTime(validity_range_lower_bound, SLOT_CONFIG_NETWORK.mainnet));

    console.log("5. must_have_correct_datum")
    console.log(JSON.stringify(newDatum, null, 2));
    console.log(last_move_latest_time, " >= ", slotToBeginUnixTime(validity_range_upper_bound, SLOT_CONFIG_NETWORK.mainnet));

    console.log("6. must_have_correct_value")
    console.log(`Check ship utxo`)

    console.log("7. must_burn_spent_fuel")
    console.log(0 - fuelToBurn)

    console.log("=== Building Transaction ===");
    const txBuilder = new MeshTxBuilder({
      fetcher: provider,
      evaluator: provider,
    });

    txBuilder
      .setNetwork("mainnet")

      // Pilot UTxO first (simple spending)
      .txIn(pilotUtxo.input.txHash, pilotUtxo.input.outputIndex)

      // Ship UTxO second (script spending with datum and redeemer)
      .spendingPlutusScriptV3()
      .txIn(shipUtxo.input.txHash, shipUtxo.input.outputIndex)
      .txInInlineDatumPresent()
      .txInRedeemerValue(redeemer, "JSON")
      .spendingTxInReference(refScripts, 1)

      // Burn the consumed fuel using the fuel policy (pellet validator)
      .mintPlutusScriptV3()
      .mint((0 - fuelToBurn).toString(), fuelPolicy, stringToHex("FUEL"))
      .mintTxInReference(refScripts, 2) // Fuel policy script is at index 2
      .mintRedeemerValue(conStr1([]), "JSON");

    if (remainingFuel === 0) {
      txBuilder
        .txOut(shipyardAddress, [
          {
            unit: shipPolicy + stringToHex("SHIP" + shipNo.toString()),
            quantity: "1",
          },
        ])
        .txOutInlineDatumValue(newDatum, "JSON");
    } else {
      txBuilder
        .txOut(shipyardAddress, [
          {
            unit: shipPolicy + stringToHex("SHIP" + shipNo.toString()),
            quantity: "1",
          },
          {
            unit: fuelPolicy + stringToHex("FUEL"),
            quantity: remainingFuel.toString(),
          },
        ])
        .txOutInlineDatumValue(newDatum, "JSON");
    }

    txBuilder
      .txOut(walletAddress!, [
        {
          unit: shipPolicy + stringToHex("PILOT" + shipNo.toString()),
          quantity: "1",
        },
      ])

      .invalidBefore(validity_range_lower_bound)

      .invalidHereafter(validity_range_upper_bound)

      .txInCollateral(
        adaOnlyUtxos[0].input.txHash,
        adaOnlyUtxos[0].input.outputIndex
      )

      .changeAddress(walletAddress!)
      .selectUtxosFrom(adaOnlyUtxos);

    const tx = await txBuilder.complete();

    console.log("✓ Transaction built successfully");

    const signedTx = await wallet.signTx(tx);
    const hash = await wallet.submitTx(signedTx);

    console.log("✓ Transaction submitted successfully");
    console.log("Transaction ID:", hash);
  } catch (error) {
    console.error("❌ Transaction building failed:");

    if (error instanceof Error) {
      console.error("Error:", error.message);
    } else {
      console.error("Unknown error:", error);
    }

    throw error;
  }
}

// Get command line arguments
let args = process.argv.slice(2);
// Filter out '--' if present
args = args.filter((arg) => arg !== "--");

if (args.length < 2) {
  console.error("Usage: npm run move-ship -- <deltaX> <deltaY>");
  console.error("Example: npm run move-ship -- 1 -1");
  process.exit(1);
}

const deltaX = parseInt(args[0]);
const deltaY = parseInt(args[1]);

if (isNaN(deltaX) || isNaN(deltaY)) {
  console.error("Error: deltaX and deltaY must be valid numbers");
  console.error("Example: npm run move-ship -- 1 -1");
  process.exit(1);
}

moveShip(deltaX, deltaY).catch(console.error);
