// Dash network configuration for bitcoinjs-lib
// This matches the network parameters used by Dash mainnet
const dashNetwork = {
  messagePrefix: '\x19DarkCoin Signed Message:\n',
  bech32: 'dash',
  bip32: {
    public: 0x02fe52f8,
    private: 0x02fe52cc,
  },
  pubKeyHash: 0x4c,  // Addresses start with 'X'
  scriptHash: 0x10,  // P2SH addresses start with '7'
  wif: 0xcc,         // Private keys start with 'X'
};

module.exports = { dashNetwork };

