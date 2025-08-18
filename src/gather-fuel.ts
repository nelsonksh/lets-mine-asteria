import * as dotenv from "dotenv";
import {
  conStr0,
  conStr1,
  deserializeDatum,
  integer,
  MeshTxBuilder,
  MeshWallet,
  SLOT_CONFIG_NETWORK,
  slotToBeginUnixTime,
  stringToHex,
} from "@meshsdk/core";
import {
  authToken,
  fuelPolicy,
  pelletAddress,
  provider,
  refScripts,
  shipPolicy,
  shipyardAddress,
} from "./common";

async function gatherFuel() {
  dotenv.config();
  if (!process.env.PRIVATE_KEY) {
    throw new Error("PRIVATE_KEY not found in .env");
  }
  if (!process.env.SHIP_NO) {
    throw new Error("SHIP_NO not found in .env");
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
    console.error("❌ No ADA-only UTxO found for collateral");
    throw new Error("Need a UTxO with only ADA for collateral");
  }

  const shipNo = parseInt(process.env.SHIP_NO);
  console.log(`Ship number: ${shipNo}`);

  const shipUtxo = (
    await provider.fetchAddressUTxOs(
      shipyardAddress,
      shipPolicy + stringToHex("SHIP" + shipNo.toString())
    )
  )[0];

  console.log("Ship UTxO found:");
  console.log(`  TxHash: ${shipUtxo.input.txHash}`);
  console.log(`  Output Index: ${shipUtxo.input.outputIndex}`);
  console.log(`  Assets:`, shipUtxo.output.amount);
  console.log(`  Datum:`, shipUtxo.output.plutusData);

  const currentFuel = Number(
    shipUtxo.output.amount.find(
      (a) => a.unit === fuelPolicy + stringToHex("FUEL")
    )?.quantity || 0
  );

  console.log(`Current fuel: ${currentFuel}`);

  // Game constraint: max_ship_fuel = 5
  const maxShipFuel = 5;

  // Find fuel pickup UTxO at the pallet address
  const palletUtxos = await provider.fetchAddressUTxOs(pelletAddress);

  // Get current ship position from its datum
  const currentDatum = shipUtxo.output.plutusData;
  if (!currentDatum) {
    throw new Error("Ship has no datum");
  }

  const datumJson = deserializeDatum(currentDatum);
  const currentX = parseInt(datumJson.fields[0]?.int?.toString());
  const currentY = parseInt(datumJson.fields[1]?.int?.toString());
  console.log(`Ship is currently at position (${currentX}, ${currentY})`);
  console.log(`Looking for fuel pickup at position (${currentX}, ${currentY})`);

  // Log fuel UTxOs for debugging
  const fuelUtxos = palletUtxos.filter((utxo) =>
    utxo.output.amount.some(
      (asset) => asset.unit === fuelPolicy + stringToHex("FUEL")
    )
  );

  // Find fuel pickup at ship's current position
  const fuelPickupUtxo = palletUtxos.find((utxo) => {
    const hasFuel = utxo.output.amount.some(
      (asset) => asset.unit === fuelPolicy + stringToHex("FUEL")
    );

    if (!hasFuel || !utxo.output.plutusData) return false;

    try {
      const datumJson = deserializeDatum(utxo.output.plutusData);
      if (datumJson?.fields?.length >= 2) {
        const x = datumJson.fields[0]?.int?.toString();
        const y = datumJson.fields[1]?.int?.toString();
        return x === currentX.toString() && y === currentY.toString();
      }
    } catch (e) {
      console.warn("Could not parse fuel pickup datum:", e);
    }
    return false;
  });

  if (!fuelPickupUtxo) {
    console.error(
      `❌ No fuel pickup found at position (${currentX}, ${currentY})`
    );
    throw new Error(
      `No fuel pickup available at ship's current position (${currentX}, ${currentY})`
    );
  }

  const fuelPickupAmount = Number(
    fuelPickupUtxo.output.amount.find(
      (asset) => asset.unit === fuelPolicy + stringToHex("FUEL")
    )?.quantity || 0
  );

  console.log("✓ Fuel pickup UTxO found:");
  console.log(JSON.stringify(fuelPickupUtxo, null, 2));
  console.log(`  TxHash: ${fuelPickupUtxo.input.txHash}`);
  console.log(`  Output Index: ${fuelPickupUtxo.input.outputIndex}`);
  console.log(`  Available fuel: ${fuelPickupAmount}`);

  // Calculate fuel amounts
  const actualFuelToGather = maxShipFuel - currentFuel;
  const newFuelAmount = currentFuel + actualFuelToGather;

  console.log(`Current fuel: ${currentFuel}`);
  console.log(`Fuel to gather: ${actualFuelToGather}`);
  console.log(`New fuel amount: ${newFuelAmount}`);

  if (actualFuelToGather <= 0) {
    throw new Error("Ship fuel is already at maximum capacity");
  }

  if (fuelPickupAmount < actualFuelToGather) {
    throw new Error(
      `Insufficient fuel in pickup! Need ${actualFuelToGather} but only ${fuelPickupAmount} available`
    );
  }

  console.log(`Current tip slot: ${tipSlot}`);

  const invalidBefore = tipSlot - 100;
  const invalidBeforeTimestamp = slotToBeginUnixTime(
    invalidBefore,
    SLOT_CONFIG_NETWORK.mainnet
  );
  const invalidHereafter = tipSlot + 300;
  const invalidHereafterTimestamp = slotToBeginUnixTime(
    invalidHereafter,
    SLOT_CONFIG_NETWORK.mainnet
  );

  const now = Date.now();

  console.log("=== Transaction Validity Window ===");
  console.log("Invalid Before:", invalidBeforeTimestamp);
  console.log("Now:", now);
  console.log("Invalid Hereafter:", invalidHereafterTimestamp);
  console.log(`Slot range: ${invalidBefore} - ${invalidHereafter}`);

  if (now < invalidBeforeTimestamp || now > invalidHereafterTimestamp) {
    console.error("❌ Transaction timing validation failed!");
    throw new Error("Transaction is invalid");
  }
  console.log("✓ Transaction timing is valid");

  const pilotUtxo = walletUtxos.find((utxo) =>
    utxo.output.amount.some(
      (asset) =>
        asset.unit === shipPolicy + stringToHex("PILOT" + shipNo.toString())
    )
  );

  if (!pilotUtxo) {
    console.error("❌ Pilot token not found in wallet UTxOs");
    console.log(
      "Available assets in wallet:",
      walletUtxos.map((u) =>
        u.output.amount.filter((a) => a.unit.startsWith(shipPolicy))
      )
    );
    throw new Error("Pilot token not found in wallet UTxOs");
  }

  console.log("✓ Pilot UTxO found:");
  console.log(`  TxHash: ${pilotUtxo.input.txHash}`);
  console.log(`  Output Index: ${pilotUtxo.input.outputIndex}`);
  console.log(`  Assets:`, pilotUtxo.output.amount);

  console.log("=== Building Transaction ===");
  console.log("1. Inputs:");
  console.log(
    `   - Pilot UTxO: ${pilotUtxo.input.txHash}#${pilotUtxo.input.outputIndex}`
  );
  console.log(
    `   - Ship UTxO: ${shipUtxo.input.txHash}#${shipUtxo.input.outputIndex}`
  );
  console.log(
    `   - Fuel UTxO: ${fuelPickupUtxo.input.txHash}#${fuelPickupUtxo.input.outputIndex}`
  );
  console.log("2. Outputs:");
  console.log(`   - Ship back to shipyard with fuel: ${newFuelAmount}`);
  console.log(`   - Pilot token back to wallet`);
  console.log(
    `   - Remaining fuel back to pallet: ${
      fuelPickupAmount - actualFuelToGather
    }`
  );

  // Create redeemers
  const shipRedeemer = conStr1([integer(actualFuelToGather)]); // GatherFuel constructor
  const fuelPickupRedeemer = conStr0([integer(actualFuelToGather)]);

  try {
    let txBuilder = new MeshTxBuilder({
      fetcher: provider,
      evaluator: provider,
    });

    txBuilder = txBuilder
      .setNetwork("mainnet")

      // Pilot UTxO (simple spending)
      .txIn(pilotUtxo.input.txHash, pilotUtxo.input.outputIndex)

      // Ship UTxO (script spending)
      .spendingPlutusScriptV3()
      .txIn(shipUtxo.input.txHash, shipUtxo.input.outputIndex)
      .txInInlineDatumPresent()
      .txInRedeemerValue(shipRedeemer, "JSON")
      .spendingTxInReference(refScripts, 1)

      // Fuel pickup UTxO (script spending)
      .spendingPlutusScriptV3()
      .txIn(fuelPickupUtxo.input.txHash, fuelPickupUtxo.input.outputIndex)
      .txInInlineDatumPresent()
      .txInRedeemerValue(fuelPickupRedeemer, "JSON")
      .spendingTxInReference(refScripts, 2)

      // Ship output with additional fuel
      .txOut(shipyardAddress, [
        {
          unit: shipPolicy + stringToHex("SHIP" + shipNo.toString()),
          quantity: "1",
        },
        {
          unit: fuelPolicy + stringToHex("FUEL"),
          quantity: newFuelAmount.toString(),
        },
      ])
      .txOutInlineDatumValue(currentDatum!, "CBOR")

      // Remaining fuel back to pallet
      .txOut(pelletAddress, [
        {
          unit: "lovelace",
          quantity:
            fuelPickupUtxo.output.amount.find((a) => a.unit === "lovelace")
              ?.quantity || "0",
        },
        {
          unit: fuelPolicy + stringToHex("FUEL"),
          quantity: (fuelPickupAmount - actualFuelToGather).toString(),
        },
        {
          unit: authToken,
          quantity: "1",
        },
      ])
      .txOutInlineDatumValue(fuelPickupUtxo.output.plutusData!, "CBOR")

      // Pilot token back to wallet
      .txOut(walletAddress!, [
        {
          unit: shipPolicy + stringToHex("PILOT" + shipNo.toString()),
          quantity: "1",
        },
      ]);

    if (fuelPickupUtxo.output.amount.length > 3) {
      txBuilder = txBuilder.txOut(
        walletAddress!,
        fuelPickupUtxo.output.amount.filter(
          (a) =>
            a.unit !== "lovelace" &&
            a.unit !== authToken &&
            a.unit !== fuelPolicy + stringToHex("FUEL")
        )
      );
    }

    const tx = await txBuilder
      .invalidBefore(invalidBefore)
      .invalidHereafter(invalidHereafter)
      .txInCollateral(
        adaOnlyUtxos[0].input.txHash,
        adaOnlyUtxos[0].input.outputIndex
      )
      .changeAddress(walletAddress!)
      .selectUtxosFrom(adaOnlyUtxos)
      .complete();

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

gatherFuel().catch(console.error);
