# Lets Mine Asteria

Ready to go toolkit to start playing [Asteria](https://asteria.txpipe.io) - a fully on-chain game built on Cardano where you explore space, mine resources, and build your fleet!

## What is Asteria?

Asteria is a decentralized space exploration game running entirely on the Cardano blockchain. In Asteria, you:
- **Command ships** that exist as tokens on-chain
- **Explore the galaxy** by moving your ships to different coordinates
- **Mine fuel** from scattered fuel pickups across space

Every action in the game - from creating ships to moving them - happens through Cardano smart contracts, making your progress truly yours and permanently recorded on the blockchain.

## What This Toolkit Provides

This project gives you all the tools you need to start playing Asteria:

- **Create a Cardano wallet** and generate your game address
- **Spawn new ships** at any coordinates in the Asteria universe
- **Move your ships** around space (costs fuel!)
- **Gather fuel** from pickups to keep exploring

## Getting Started

### Prerequisites
- Node.js (v16 or higher)
- npm
- Some ADA in your wallet for transaction fees (small amounts, usually < 1 ADA per transaction)

### Installation
```bash
git clone https://github.com/nelsonksh/lets-mine-asteria
cd lets-mine-asteria
npm install
```

## How to Play Asteria

Follow these steps to start your space exploration journey:

### Step 1: Create Your Game Wallet

> **💡 Tip:** If you want to proceed with CLI generated keys, visit [Mesh Wallet](https://meshjs.dev/apis/wallets/meshwallet#initWallet)

First, you need a Cardano address to play Asteria. This will be your in-game identity and where your ships and resources are stored.

Run the following command to create a new Cardano private key and address:

```bash
npm run create-address
```

This will:
1. Generate a new private key using MeshSDK
2. Save the private key to `.env` file (creates the file if it doesn't exist)
3. Display the generated Cardano address

**Example output:**
```
Private key recorded to .env file
Fresh address: addr1vxrvs.......
```

**⚠️ Important Security Note:**
- The private key is saved in `.env` file  
- Never share your private key with anyone
- Never commit `.env` file to version control (it's your wallet!)
- Keep your private key secure and private

**💰 Next:** You'll need some ADA in this address to pay for transaction costs. Send some amount to your generated address before proceeding.

### Step 2: Launch Your First Ship

Now for the exciting part - launching your first ship into the Asteria universe! Ships are NFTs that represent your presence in the game.

Ships must be spawned within a Manhattan distance of 50 from the origin (0,0) - meaning |spawnX| + |spawnY| ≤ 50.

```bash
npm run create-ship -- <spawnX> <spawnY>
```

**Parameters:**
- `spawnX`: X coordinate for ship spawn position (integer)
- `spawnY`: Y coordinate for ship spawn position (integer, can be negative)

**Example:**
```bash
npm run create-ship -- 21 30
# or with negative coordinates
npm run create-ship -- 16 -35
```

What happens when you create a ship:
1. 🚀 A new SHIP NFT is minted and placed in the game world
2. 👨‍🚀 A PILOT token is created and sent to your wallet (this proves you own the ship)
3. ⛽ The ship starts with 5 fuel units for exploration
4. 📍 Your ship appears at the coordinates you specified
5. 📝 Everything is recorded permanently on the Cardano blockchain

**Example output:**
```
✓ Auth UTxO found
Ship spawn position: (21, 30)
Creating SHIP43 ...
✓ Transaction built successfully
```

**🎮 Pro Tip:** Choose your spawn coordinates wisely! You might want to start near (0,0) or pick coordinates that seem interesting for exploration within this boundary.

### Step 3: Navigate the Galaxy

Now you can explore space! Moving your ship costs fuel, so plan your routes carefully.

**Movement Constraints:**
- Ships have a maximum speed limit: distance 1 per 12,096,000 milliseconds (~3.36 hours)
- This means you can only move 1 coordinate unit every ~3.36 hours
- Plan your exploration routes strategically to maximize efficiency within these time limits

**Fuel Management:**
- Each movement consumes fuel equal to the Manhattan distance traveled
- Ships start with 5 fuel units and can hold a maximum of 5 fuel
- Find fuel pickups scattered throughout the galaxy to refuel when needed

```bash
npm run move-ship -- <deltaX> <deltaY>
```

**Parameters:**
- `deltaX`: Change in X coordinate (integer, can be negative)
- `deltaY`: Change in Y coordinate (integer, can be negative)

**Prerequisites:**
- You must have a `SHIP_NO` variable in your `.env` file (automatically added when you create a ship)
- Your wallet must contain the PILOT token for that ship
- The ship must have enough fuel for the movement

**Navigation Examples:**
```bash
npm run move-ship -- 2 -3
# Moves ship 2 units right and 3 units down
npm run move-ship -- -1 1  
# Moves ship 1 unit left and 1 unit up
```

**Fuel Consumption:**
- Each movement consumes fuel equal to `|deltaX| + |deltaY|`
- Example: Moving (2, -3) consumes 2 + 3 = 5 fuel units
- Ships start with 5 fuel when created

This will:
1. Load your private key and ship number from `.env` file
2. Find your ship UTxO in the shipyard
3. Find your PILOT token in your wallet
4. Validate you have enough fuel for the movement
5. Build and submit a transaction that:
   - Burns the required fuel tokens
   - Updates the ship's position on-chain
   - Returns the ship to the shipyard with remaining fuel
   - Returns the PILOT token to your wallet

**Example output:**
```
✓ Ship UTxO found at position (21, 30)
✓ Pilot UTxO found
Current fuel: 5
Fuel consumption: 5
Remaining fuel: 0
Movement: (2, -3)
New position: (23, 27)
✓ Transaction built successfully
```

### Step 4: Refuel Your Ship

Ran out of fuel? No problem! The Asteria universe has fuel pickups scattered around that you can use to refuel your ship.

```bash
npm run gather-fuel
```

**Prerequisites:**
- You must have a `SHIP_NO` variable in your `.env` file
- Your wallet must contain the PILOT token for that ship  
- There must be a fuel pickup at your ship's current position
- Your ship must not already be at maximum fuel capacity (5 units)

**🔍 How to find fuel:**
- Fuel pickups are scattered throughout the Asteria galaxy
- You need to move your ship to a position where a fuel pickup exists
- The game will automatically detect if there's fuel at your current position
- Each pickup can refuel multiple ships (shared resources!)

**⛽ Refueling process:**
- Your ship automatically gathers fuel from the pickup at its current position
- The ship's fuel is refilled to maximum capacity (5 units)
- Only the exact amount needed is consumed from the pickup
- Remaining fuel stays in the pickup for other explorers

What happens during refueling:
1. Load your private key and ship number from `.env` file
2. Find your ship UTxO in the shipyard
3. Find your PILOT token in your wallet
4. Look for a fuel pickup at the ship's current position
5. Calculate how much fuel is needed to reach maximum capacity
6. Build and submit a transaction that:
   - Consumes the required fuel from the pickup
   - Updates the ship with maximum fuel (5 units)
   - Returns remaining fuel to the pickup location
   - Returns the PILOT token to your wallet

**Example output:**
```
✓ Ship UTxO found at position (15, -20)
✓ Pilot UTxO found
Ship is currently at position (15, -20)
✓ Fuel pickup UTxO found
Current fuel: 2
Fuel to gather: 3
New fuel amount: 5
✓ Transaction built successfully
✓ Transaction submitted successfully
```

### Available Scripts
- `npm run create-address` - Generate new Cardano address and private key
- `npm run create-ship -- <x> <y>` - Create a new ship at coordinates (x, y)
- `npm run move-ship -- <deltaX> <deltaY>` - Move your ship by the specified delta
- `npm run gather-fuel` - Refuel your ship from a pickup at current position

### Project Structure
```
src/
  index.ts              # Main application entry point
  create-address.ts     # Cardano address generation script
  create-ship.ts        # Ship creation and minting script
  move-ship.ts          # Ship movement and fuel consumption script
  gather-fuel.ts        # Fuel gathering from pickups script
  common.ts            # Shared constants and provider configuration
.env                    # Environment variables (private keys, ship number)
tsconfig.json          # TypeScript configuration
package.json           # Project dependencies and scripts
```
