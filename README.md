# Darinals CLI Tool

A command-line tool for creating and managing Dash inscriptions (DARinals) on the Dash blockchain.

## Quick Start

```bash
# Install dependencies
npm install

# Create a wallet
node darinals.js wallet new

# Sync UTXOs
node darinals.js wallet sync

# Mint an inscription
node darinals.js mint <address> <file>
```

## Features

- ✅ Wallet management (create, sync, balance, send, split)
- ✅ Inscription minting with commit/reveal pattern
- ✅ DAR-20 token operations (deploy, mint, transfer)
- ✅ HTTP server for viewing inscriptions
- ✅ No treasury fees (simplified fee structure)

## Installation

1. Clone or download this repository
2. Install dependencies: `npm install`
3. Copy `.env.example` to `.env` and configure your Dash node RPC credentials
4. Make executable: `chmod +x darinals.js`

## Configuration

Edit `.env` file with your Dash node RPC settings:

```env
NODE_RPC_URL=http://127.0.0.1:9998
NODE_RPC_USER=dashrpc
NODE_RPC_PASS=your_password
```

## Usage

See [usage.md](usage.md) for complete documentation.

### Basic Commands

```bash
# Wallet operations
node darinals.js wallet new          # Create new wallet
node darinals.js wallet sync         # Sync UTXOs
node darinals.js wallet balance      # Check balance
node darinals.js wallet send <addr> <amount>  # Send DASH

# Inscription operations
node darinals.js mint <address> <file>        # Mint inscription from file
node darinals.js mint <address> <type> <hex>  # Mint from hex data

# DAR-20 token operations
node darinals.js dar-20 deploy <addr> <ticker> <max> <limit>
node darinals.js dar-20 mint <addr> <ticker> <amount> [repeat]
node darinals.js dar-20 transfer <addr> <ticker> <amount> [repeat]

# Server
node darinals.js server              # Start HTTP server
```

## Fee Structure

- **Commit fee**: 2000 satoshis (default)
- **Reveal fee**: 1000 satoshis (default)
- **Inscription amount**: 15000 satoshis (default)
- **Total per inscription**: ~18000 satoshis (~0.00018 DASH)

## File Size Limits

- Maximum content size: 1500 bytes (~1.5 KB)
- Content is automatically chunked into 500-byte pieces
- Individual push limit: 520 bytes (network policy)

## Requirements

- Node.js 14+ 
- Access to a Dash node with RPC enabled
- Sufficient DASH balance for fees

## Security

⚠️ **Important**: 
- Never share your `.wallet.json` file (contains private key)
- Always backup your wallet file
- Test on testnet before mainnet use
- Keep your RPC credentials secure

## License

This tool is provided as-is for creating and managing Dash inscriptions.

## Support

For detailed usage instructions, see [usage.md](usage.md).

