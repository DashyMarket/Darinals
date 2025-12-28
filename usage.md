# DARinals CLI Tool - Usage Guide

## Overview

DARinals is a command-line tool for creating and managing Dash inscriptions (DARinals) on the Dash blockchain. It uses the commit/reveal pattern to embed data in transactions, similar to Bitcoin Ordinals but adapted for Dash.

## Installation

1. **Install dependencies:**
   ```bash
   cd /root/darinals
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your Dash node RPC credentials
   ```

3. **Make executable (optional):**
   ```bash
   chmod +x darinals.js
   ```

## Environment Configuration

Create a `.env` file in the darinals directory with the following variables:

```env
# Dash Node RPC Configuration
NODE_RPC_URL=http://127.0.0.1:9998
NODE_RPC_USER=dashrpc
NODE_RPC_PASS=your_rpc_password

# Network Configuration
TESTNET=false

# Transaction Fees (in satoshis)
COMMIT_FEE_SATOSHIS=2000
REVEAL_FEE_SATOSHIS=1000
TOTAL_FEE_SATOSHIS=20000

# Inscription Amount (P2SH output)
INSCRIPTION_AMOUNT_SATOSHIS=15000

# Wallet Configuration
WALLET=.wallet.json

# Server Configuration
SERVER_PORT=3000
```

## Commands

### Wallet Management

#### Create New Wallet
```bash
node darinals.js wallet new
```
Creates a new wallet file (`.wallet.json` by default) with a new private key and address.

#### Sync Wallet
```bash
node darinals.js wallet sync
```
Syncs UTXOs from your Dash node and updates the local wallet file.

#### Check Balance
```bash
node darinals.js wallet balance
```
Displays the current balance of your wallet.

#### Send DASH
```bash
node darinals.js wallet send <address> <amount>
```
Sends DASH to the specified address.

Example:
```bash
node darinals.js wallet send Xg6ua9TM9n7wGPAfNSzey42ize9rFyN8Gc 1000000
```

#### Split UTXOs
```bash
node darinals.js wallet split <number_of_splits>
```
Splits your UTXOs into multiple outputs (useful for creating multiple spendable outputs).

Example:
```bash
node darinals.js wallet split 5
```

### Inscription Minting

#### Mint from File
```bash
node darinals.js mint <destination_address> <file_path>
```

Example:
```bash
node darinals.js mint Xg6ua9TM9n7wGPAfNSzey42ize9rFyN8Gc image.png
```

#### Mint from Hex Data
```bash
node darinals.js mint <destination_address> <content_type> <hex_data>
```

Example:
```bash
node darinals.js mint Xg6ua9TM9n7wGPAfNSzey42ize9rFyN8Gc "text/plain" "48656c6c6f20576f726c64"
```

### DAR-20 Token Operations

DAR-20 is a token standard for Dash, similar to BRC-20 on Bitcoin.

#### Deploy Token
```bash
node darinals.js dar-20 deploy <address> <ticker> <max_supply> <mint_limit>
```

Example:
```bash
node darinals.js dar-20 deploy Xg6ua9TM9n7wGPAfNSzey42ize9rFyN8Gc DAR 1000000 1000
```

#### Mint Tokens
```bash
node darinals.js dar-20 mint <address> <ticker> <amount> [repeat_count]
```

Example:
```bash
node darinals.js dar-20 mint Xg6ua9TM9n7wGPAfNSzey42ize9rFyN8Gc DAR 1000 10
```

#### Transfer Tokens
```bash
node darinals.js dar-20 transfer <address> <ticker> <amount> [repeat_count]
```

Example:
```bash
node darinals.js dar-20 transfer Xg6ua9TM9n7wGPAfNSzey42ize9rFyN8Gc DAR 500
```

### HTTP Server

Start a server to extract and view inscriptions:

```bash
node darinals.js server
```

The server will start on port 3000 (or the port specified in `SERVER_PORT` environment variable).

Access inscriptions via:
```
http://localhost:3000/tx/<transaction_id>
```

Example:
```
http://localhost:3000/tx/15f3b73df7e5c072becb1d84191843ba080734805addfccb650929719080f62e
```

## Fee Structure

### Per Inscription Costs

- **Commit fee**: 2000 satoshis (default, configurable via `COMMIT_FEE_SATOSHIS`)
- **Reveal fee**: 1000 satoshis (default, configurable via `REVEAL_FEE_SATOSHIS`)
- **P2SH output**: 15000 satoshis (default, configurable via `INSCRIPTION_AMOUNT_SATOSHIS`)
- **Total minimum**: ~18000 satoshis (~0.00018 DASH) per inscription

### Fee Distribution

- **Network fees**: Commit + Reveal fees paid to miners
- **Inscription output**: Held in P2SH until reveal transaction
- **No treasury fee**: Simplified fee structure

### Commit/Reveal Pattern

1. **Commit Transaction**:
   - Creates a P2SH output with redeem script
   - Includes commit transaction fee
   - P2SH output amount: 15000 satoshis (default)
   - Change output back to wallet if needed

2. **Reveal Transaction**:
   - Spends P2SH output with inscription data in scriptSig
   - Includes reveal transaction fee
   - Transfers inscription to destination address
   - Output amount: P2SH amount - reveal fee

## File Size Limitations

- **Maximum content size**: 1500 bytes (~1.5 KB)
- **Content is split into chunks**: 500 bytes per chunk
- **Individual push limit**: 520 bytes (network policy)
- **ScriptSig limit**: 1650 bytes (network standard transaction limit)

For larger files, consider:
- Using IPFS and storing the IPFS hash on-chain
- Splitting content across multiple inscriptions
- Using external storage solutions

## Supported File Types

The tool automatically detects MIME types for common file formats:

- **Images**: PNG, JPEG, GIF, WebP, SVG
- **Text**: Plain text, Markdown, HTML
- **JSON**: Application/json
- **Other**: Any file type (detected via mime-types library)

## Troubleshooting

### RPC Connection Issues

If you get connection errors:

1. **Check Dash node is running:**
   ```bash
   dash-cli getblockchaininfo
   ```

2. **Verify RPC credentials:**
   Check your `.dashcore/dash.conf` file:
   ```
   rpcuser=dashrpc
   rpcpassword=your_password
   rpcport=9998
   ```

3. **Check firewall/network settings:**
   Ensure port 9998 is accessible

### Transaction Broadcasting Fails

- **Check transaction size**: Large inscriptions may exceed network limits
- **Verify sufficient balance**: Ensure you have enough DASH for fees
- **Check Dash node sync**: Ensure your node is synced
- **Verify transaction fees**: Fees may need adjustment

### Inscription Not Found

- **Verify transaction is confirmed**: Wait for confirmation
- **Check transaction has inscription data**: Verify scriptSig contains "ord" prefix
- **Verify parsing logic**: Check extraction function matches encoding format

### Insufficient Balance Errors

- **Sync wallet**: Run `wallet sync` to update UTXO list
- **Check UTXO size**: Small UTXOs (<1000 satoshis) are filtered out
- **Consolidate UTXOs**: Use `wallet split` to create larger UTXOs

### Pending Transactions

If a transaction fails, the tool saves pending transactions to `pending-txs.json`. To retry:

```bash
# Simply re-run the same command
node darinals.js mint <address> <file>
```

The tool will automatically detect and rebroadcast pending transactions.

## Security Notes

⚠️ **Important Security Considerations:**

- **Never expose private keys**: The wallet file contains your private key in WIF format
- **Backup wallet file**: Keep secure backups of `.wallet.json`
- **Use testnet first**: Test all operations on testnet before mainnet
- **Validate file types**: Be cautious with file uploads
- **Rate limiting**: Consider implementing rate limiting for production use

## Examples

### Complete Workflow

```bash
# 1. Create wallet
node darinals.js wallet new

# 2. Sync UTXOs
node darinals.js wallet sync

# 3. Check balance
node darinals.js wallet balance

# 4. Mint an inscription
node darinals.js mint Xg6ua9TM9n7wGPAfNSzey42ize9rFyN8Gc myimage.png

# 5. Deploy DAR-20 token
node darinals.js dar-20 deploy Xg6ua9TM9n7wGPAfNSzey42ize9rFyN8Gc MYTOKEN 1000000 1000

# 6. Mint DAR-20 tokens
node darinals.js dar-20 mint Xg6ua9TM9n7wGPAfNSzey42ize9rFyN8Gc MYTOKEN 1000 5

# 7. Start server to view inscriptions
node darinals.js server
```

## API Reference

### Inscription Format

Inscriptions embed data in the transaction `scriptSig` following this pattern:

```
scriptSig = [
  OP_PUSHDATA("ord"),           // Protocol identifier
  OP_1,                         // Version marker
  OP_PUSHDATA(contentType),    // MIME type
  OP_0,                         // Separator
  OP_PUSHDATA(chunk1),         // Content chunk 1
  OP_PUSHDATA(chunk2),         // Content chunk 2
  ...
  OP_PUSHDATA(signature),       // ECDSA signature
  OP_PUSHDATA(redeem_script)   // Redeem script
]
```

### DAR-20 Format

DAR-20 tokens use JSON inscriptions:

```json
{
  "p": "dar-20",
  "op": "deploy" | "mint" | "transfer",
  "tick": "TOKEN",
  "max": "1000000",    // For deploy
  "lim": "1000",       // For deploy
  "amt": "1000"        // For mint/transfer
}
```

## Support

For issues or questions:
- Check the implementation files for reference patterns
- Review transaction examples in the Dash blockchain
- Test on testnet before mainnet use

## License

This tool is provided as-is for creating and managing Dash inscriptions.

