#!/usr/bin/env node

const bitcoinjs = require('bitcoinjs-lib');
const axios = require('axios');
const fs = require('fs');
const dotenv = require('dotenv');
const mime = require('mime-types');
const express = require('express');
const { ECPairFactory } = require('ecpair');
const ecc = require('@bitcoinerlab/secp256k1');
const { dashNetwork } = require('./dash-network');

const ECPair = ECPairFactory(ecc);

dotenv.config();

// Fee constants (no treasury fee)
const DEFAULT_COMMIT_FEE = parseInt(process.env.COMMIT_FEE_SATOSHIS) || 2000;
const DEFAULT_REVEAL_FEE = parseInt(process.env.REVEAL_FEE_SATOSHIS) || 1000;
const DEFAULT_TOTAL_FEE = parseInt(process.env.TOTAL_FEE_SATOSHIS) || 20000;
const DEFAULT_INSCRIPTION_AMOUNT = parseInt(process.env.INSCRIPTION_AMOUNT_SATOSHIS) || 15000;

const WALLET_PATH = process.env.WALLET || ".wallet.json";
const MAX_CONTENT_SIZE = 1500; // Maximum content size in bytes
const CHUNK_SIZE = 500; // Chunk size for content splitting
const MAX_SCRIPT_ELEMENT_SIZE = 520;
const SCRIPT_SIG_MAX_SIZE = 1650;

async function main() {
  let cmd = process.argv[2];

  if (fs.existsSync("pending-txs.json")) {
    console.log("found pending-txs.json. rebroadcasting...");
    const txs = JSON.parse(fs.readFileSync("pending-txs.json"));
    await broadcastAll(txs, false);
    return;
  }

  if (cmd == "mint") {
    await mint();
  } else if (cmd == "wallet") {
    await wallet();
  } else if (cmd == "server") {
    await server();
  } else if (cmd == "dar-20") {
    await dar20();
  } else {
    throw new Error(`unknown command: ${cmd}`);
  }
}

async function dar20() {
  let subcmd = process.argv[3];

  if (subcmd === "mint") {
    await dar20Transfer("mint");
  } else if (subcmd === "transfer") {
    await dar20Transfer();
  } else if (subcmd === "deploy") {
    await dar20Deploy();
  } else {
    throw new Error(`unknown subcommand: ${subcmd}`);
  }
}

async function dar20Deploy() {
  const argAddress = process.argv[4];
  const argTicker = process.argv[5];
  const argMax = process.argv[6];
  const argLimit = process.argv[7];

  const dar20Tx = {
    p: "dar-20",
    op: "deploy",
    tick: `${argTicker.toLowerCase()}`,
    max: `${argMax}`,
    lim: `${argLimit}`,
  };

  const parsedDar20Tx = JSON.stringify(dar20Tx);
  const encodedDar20Tx = Buffer.from(parsedDar20Tx).toString("hex");

  console.log("Deploying dar-20 token...");
  await mint(argAddress, "text/plain;charset=utf-8", encodedDar20Tx);
}

async function dar20Transfer(operation = "transfer") {
  const argAddress = process.argv[4];
  const argTicker = process.argv[5];
  const argAmount = process.argv[6];
  const argRepeat = Number(process.argv[7]) || 1;

  const dar20Tx = {
    p: "dar-20",
    op: operation,
    tick: `${argTicker.toLowerCase()}`,
    amt: `${argAmount}`,
  };

  const parsedDar20Tx = JSON.stringify(dar20Tx);
  const encodedDar20Tx = Buffer.from(parsedDar20Tx).toString("hex");

  for (let i = 0; i < argRepeat; i++) {
    console.log(`Minting dar-20 token... ${i + 1} of ${argRepeat} times`);
    await mint(argAddress, "text/plain;charset=utf-8", encodedDar20Tx);
  }
}

async function wallet() {
  let subcmd = process.argv[3];

  if (subcmd == "new") {
    walletNew();
  } else if (subcmd == "sync") {
    await walletSync();
  } else if (subcmd == "balance") {
    walletBalance();
  } else if (subcmd == "send") {
    await walletSend();
  } else if (subcmd == "split") {
    await walletSplit();
  } else {
    throw new Error(`unknown subcommand: ${subcmd}`);
  }
}

function walletNew() {
  if (!fs.existsSync(WALLET_PATH)) {
    const keyPair = ECPair.makeRandom({ network: dashNetwork });
    const privkey = keyPair.toWIF();
    const address = bitcoinjs.payments.p2pkh({ pubkey: keyPair.publicKey, network: dashNetwork }).address;
    const json = { privkey, address, utxos: [] };
    fs.writeFileSync(WALLET_PATH, JSON.stringify(json, 0, 2));
    console.log("address", address);
  } else {
    throw new Error("wallet already exists");
  }
}

async function walletSync() {
  let wallet = JSON.parse(fs.readFileSync(WALLET_PATH));

  console.log("syncing utxos with local Dash node via RPC");

  const body = {
    jsonrpc: "1.0",
    id: "walletsync",
    method: "listunspent",
    params: [0, 9999999, [wallet.address]],
  };

  const options = {
    auth: {
      username: process.env.NODE_RPC_USER,
      password: process.env.NODE_RPC_PASS,
    },
  };

  let response = await axios.post(process.env.NODE_RPC_URL, body, options);
  let utxos = response.data.result;

  wallet.utxos = utxos.map((utxo) => {
    return {
      txid: utxo.txid,
      vout: utxo.vout,
      script: utxo.scriptPubKey,
      satoshis: Math.round(utxo.amount * 1e8),
    };
  });

  fs.writeFileSync(WALLET_PATH, JSON.stringify(wallet, 0, 2));

  let balance = wallet.utxos.reduce((acc, curr) => acc + curr.satoshis, 0);

  console.log("balance", balance);
}

function walletBalance() {
  let wallet = JSON.parse(fs.readFileSync(WALLET_PATH));

  let balance = wallet.utxos.reduce((acc, curr) => acc + curr.satoshis, 0);

  console.log(wallet.address, balance);
}

async function walletSend() {
  const argAddress = process.argv[4];
  const argAmount = process.argv[5];

  let wallet = JSON.parse(fs.readFileSync(WALLET_PATH));

  let balance = wallet.utxos.reduce((acc, curr) => acc + curr.satoshis, 0);
  if (balance == 0) throw new Error("no funds to send");

  let amount = parseInt(argAmount);
  if (!amount) throw new Error("amount required");

  const keyPair = ECPair.fromWIF(wallet.privkey, dashNetwork);
  const tx = new bitcoinjs.Transaction();
  tx.version = 2;
  tx.locktime = 0;

  // Add inputs
  let totalInput = 0;
  for (const utxo of wallet.utxos) {
    const txidBuffer = Buffer.from(utxo.txid, 'hex').reverse();
    tx.addInput(txidBuffer, utxo.vout);
    totalInput += utxo.satoshis;
    if (totalInput >= amount + 1000) break; // Add some buffer for fees
  }

  if (totalInput < amount + 1000) {
    throw new Error("not enough funds");
  }

  // Add output
  const outputScript = bitcoinjs.address.toOutputScript(argAddress, dashNetwork);
  tx.addOutput(outputScript, BigInt(amount));

  // Add change output
  const fee = 1000; // Estimated fee
  const change = totalInput - amount - fee;
  if (change >= 546) {
    const changeScript = bitcoinjs.address.toOutputScript(wallet.address, dashNetwork);
    tx.addOutput(changeScript, BigInt(change));
  }

  // Sign inputs
  for (let i = 0; i < tx.ins.length; i++) {
    const utxo = wallet.utxos[i];
    const scriptPubKey = Buffer.from(utxo.script, 'hex');
    const hashType = bitcoinjs.Transaction.SIGHASH_ALL;
    const signatureHash = tx.hashForSignature(i, scriptPubKey, hashType);
    const signature = keyPair.sign(signatureHash);
    const signatureDER = toDER(signature);
    const signatureWithHashType = Buffer.concat([signatureDER, Buffer.from([hashType])]);
    const scriptSig = bitcoinjs.script.compile([signatureWithHashType, keyPair.publicKey]);
    tx.setInputScript(i, scriptSig);
  }

  await broadcast(tx.toHex(), true);

  console.log(tx.getId());
}

async function walletSplit() {
  let splits = parseInt(process.argv[4]);

  let wallet = JSON.parse(fs.readFileSync(WALLET_PATH));

  let balance = wallet.utxos.reduce((acc, curr) => acc + curr.satoshis, 0);
  if (balance == 0) throw new Error("no funds to split");

  const keyPair = ECPair.fromWIF(wallet.privkey, dashNetwork);
  const tx = new bitcoinjs.Transaction();
  tx.version = 2;
  tx.locktime = 0;

  // Add all inputs
  let totalInput = 0;
  for (const utxo of wallet.utxos) {
    const txidBuffer = Buffer.from(utxo.txid, 'hex').reverse();
    tx.addInput(txidBuffer, utxo.vout);
    totalInput += utxo.satoshis;
  }

  const fee = 1000 * wallet.utxos.length;
  const splitAmount = Math.floor((totalInput - fee) / splits);
  const changeScript = bitcoinjs.address.toOutputScript(wallet.address, dashNetwork);

  for (let i = 0; i < splits - 1; i++) {
    tx.addOutput(changeScript, BigInt(splitAmount));
  }
  tx.addOutput(changeScript, BigInt(totalInput - fee - splitAmount * (splits - 1)));

  // Sign inputs
  for (let i = 0; i < tx.ins.length; i++) {
    const utxo = wallet.utxos[i];
    const scriptPubKey = Buffer.from(utxo.script, 'hex');
    const hashType = bitcoinjs.Transaction.SIGHASH_ALL;
    const signatureHash = tx.hashForSignature(i, scriptPubKey, hashType);
    const signature = keyPair.sign(signatureHash);
    const signatureDER = toDER(signature);
    const signatureWithHashType = Buffer.concat([signatureDER, Buffer.from([hashType])]);
    const scriptSig = bitcoinjs.script.compile([signatureWithHashType, keyPair.publicKey]);
    tx.setInputScript(i, scriptSig);
  }

  await broadcast(tx.toHex(), true);

  console.log(tx.getId());
}

function toDER(signature) {
  const sigBuffer = Buffer.isBuffer(signature) ? signature : Buffer.from(signature);
  
  if (sigBuffer.length === 64) {
    const r = sigBuffer.slice(0, 32);
    const s = sigBuffer.slice(32, 64);

    let rTrimmed = r;
    let sTrimmed = s;

    while (rTrimmed[0] === 0 && rTrimmed.length > 1 && (rTrimmed[1] & 0x80) === 0) {
      rTrimmed = rTrimmed.slice(1);
    }
    while (sTrimmed[0] === 0 && sTrimmed.length > 1 && (sTrimmed[1] & 0x80) === 0) {
      sTrimmed = sTrimmed.slice(1);
    }

    if (rTrimmed[0] & 0x80) {
      rTrimmed = Buffer.concat([Buffer.from([0]), rTrimmed]);
    }
    if (sTrimmed[0] & 0x80) {
      sTrimmed = Buffer.concat([Buffer.from([0]), sTrimmed]);
    }

    const rLen = rTrimmed.length;
    const sLen = sTrimmed.length;
    const totalLen = 4 + rLen + sLen;

    return Buffer.concat([
      Buffer.from([0x30, totalLen, 0x02, rLen]),
      rTrimmed,
      Buffer.from([0x02, sLen]),
      sTrimmed,
    ]);
  }

  return sigBuffer;
}

async function mint(paramAddress, paramContentTypeOrFilename, paramHexData) {
  const argAddress = paramAddress || process.argv[3];
  const argContentTypeOrFilename = paramContentTypeOrFilename || process.argv[4];
  const argHexData = paramHexData || process.argv[5];

  let contentType;
  let data;

  if (fs.existsSync(argContentTypeOrFilename)) {
    contentType = mime.contentType(mime.lookup(argContentTypeOrFilename));
    data = fs.readFileSync(argContentTypeOrFilename);
  } else {
    contentType = argContentTypeOrFilename;
    if (!/^[a-fA-F0-9]*$/.test(argHexData)) throw new Error("data must be hex");
    data = Buffer.from(argHexData, "hex");
  }

  if (data.length == 0) {
    throw new Error("no data to mint");
  }

  if (contentType.length > MAX_SCRIPT_ELEMENT_SIZE) {
    throw new Error("content type too long");
  }

  if (data.length > MAX_CONTENT_SIZE) {
    throw new Error(`content too large. Maximum size is ${MAX_CONTENT_SIZE} bytes`);
  }

  let wallet = JSON.parse(fs.readFileSync(WALLET_PATH));

  const result = await inscribe(wallet, argAddress, contentType, data);

  console.log("Commit transaction:", result.commitTxId);
  console.log("Reveal transaction:", result.revealTxId);
  console.log("Inscription ID:", result.inscriptionId);
}

function createRedeemScript(publicKey, numContentChunks) {
  const totalDrops = numContentChunks + 4; // 4 = ord, OP_1, content-type, OP_0

  const scriptParts = [
    publicKey,
    bitcoinjs.opcodes.OP_CHECKSIGVERIFY,
  ];

  for (let i = 0; i < totalDrops; i++) {
    scriptParts.push(bitcoinjs.opcodes.OP_DROP);
  }

  scriptParts.push(bitcoinjs.opcodes.OP_1);

  return Buffer.from(bitcoinjs.script.compile(scriptParts));
}

function createP2SHAddress(redeemScript) {
  const scriptHash = bitcoinjs.crypto.hash160(redeemScript);
  return bitcoinjs.address.toBase58Check(scriptHash, dashNetwork.scriptHash);
}

async function buildCommitTransaction(wallet, publicKey, inscriptionAmount, commitFee, numContentChunks) {
  const keyPair = ECPair.fromWIF(wallet.privkey, dashNetwork);
  const requiredAmount = inscriptionAmount + commitFee;

  // Get UTXOs
  const body = {
    jsonrpc: "1.0",
    id: "getutxos",
    method: "listunspent",
    params: [0, 9999999, [wallet.address]],
  };

  const options = {
    auth: {
      username: process.env.NODE_RPC_USER,
      password: process.env.NODE_RPC_PASS,
    },
  };

  let response = await axios.post(process.env.NODE_RPC_URL, body, options);
  let utxos = response.data.result;

  if (utxos.length === 0) {
    throw new Error("no UTXOs available");
  }

  // Filter and sort UTXOs
  const MIN_UTXO_SIZE = 1000;
  const largeUtxos = utxos.filter(u => u.amount * 1e8 >= MIN_UTXO_SIZE);
  if (largeUtxos.length === 0) {
    throw new Error(`no UTXOs available with at least ${MIN_UTXO_SIZE} satoshis`);
  }

  const sortedUtxos = [...largeUtxos].sort((a, b) => b.amount - a.amount);

  // Select UTXOs
  const selectedUtxos = [];
  let totalInputSatoshis = 0;

  for (const utxo of sortedUtxos) {
    selectedUtxos.push(utxo);
    totalInputSatoshis += Math.round(utxo.amount * 1e8);
    if (totalInputSatoshis >= requiredAmount) {
      break;
    }
  }

  if (totalInputSatoshis < requiredAmount) {
    throw new Error(`insufficient balance. Need ${requiredAmount} satoshis, have ${totalInputSatoshis} satoshis`);
  }

  // Create redeem script and P2SH address
  const redeemScript = createRedeemScript(publicKey, numContentChunks);
  const p2shAddress = createP2SHAddress(redeemScript);

  // Build transaction
  const tx = new bitcoinjs.Transaction();
  tx.version = 2;
  tx.locktime = 0;

  // Add inputs
  for (const utxo of selectedUtxos) {
    const txidBuffer = Buffer.from(utxo.txid, 'hex').reverse();
    tx.addInput(txidBuffer, utxo.vout);
  }

  // Add P2SH output
  const p2shScript = bitcoinjs.address.toOutputScript(p2shAddress, dashNetwork);
  tx.addOutput(p2shScript, BigInt(inscriptionAmount));
  const p2shOutputIndex = 0;

  // Add change output if needed
  const changeAmount = totalInputSatoshis - inscriptionAmount - commitFee;
  if (changeAmount >= 546) {
    const changeScript = bitcoinjs.address.toOutputScript(wallet.address, dashNetwork);
    tx.addOutput(changeScript, BigInt(changeAmount));
  }

  // Sign inputs
  for (let i = 0; i < selectedUtxos.length; i++) {
    const utxo = selectedUtxos[i];
    const scriptPubKey = bitcoinjs.address.toOutputScript(wallet.address, dashNetwork);
    const hashType = bitcoinjs.Transaction.SIGHASH_ALL;
    const signatureHash = tx.hashForSignature(i, scriptPubKey, hashType);
    const signature = keyPair.sign(signatureHash);
    const signatureDER = toDER(signature);
    const signatureWithHashType = Buffer.concat([signatureDER, Buffer.from([hashType])]);
    const scriptSig = bitcoinjs.script.compile([signatureWithHashType, publicKey]);
    tx.setInputScript(i, scriptSig);
  }

  return {
    commitTxHex: tx.toHex(),
    commitTxId: tx.getId(),
    p2shAddress,
    p2shOutputIndex,
    p2shAmount: inscriptionAmount,
    redeemScriptHex: redeemScript.toString('hex'),
    publicKeyHex: publicKey.toString('hex'),
  };
}

async function buildRevealTransaction(commitTxId, p2shOutputIndex, p2shAmount, redeemScriptHex, publicKeyHex, privateKeyWIF, contentType, content, destinationAddress, revealFee) {
  const keyPair = ECPair.fromWIF(privateKeyWIF, dashNetwork);
  const publicKey = Buffer.from(publicKeyHex, 'hex');
  const redeemScript = Buffer.from(redeemScriptHex, 'hex');

  // Split content into chunks
  const contentChunks = [];
  for (let i = 0; i < content.length; i += CHUNK_SIZE) {
    const chunk = content.slice(i, i + CHUNK_SIZE);
    if (chunk.length > MAX_SCRIPT_ELEMENT_SIZE) {
      throw new Error("content chunk too large");
    }
    contentChunks.push(chunk);
  }

  // Build reveal transaction
  const tx = new bitcoinjs.Transaction();
  tx.version = 2;
  tx.locktime = 0;

  // Add P2SH input
  const txidBuffer = Buffer.from(commitTxId, 'hex').reverse();
  tx.addInput(txidBuffer, p2shOutputIndex);

  // Add output
  const outputAmount = p2shAmount - revealFee;
  if (outputAmount < 546) {
    throw new Error(`output amount ${outputAmount} satoshis is below dust limit (546 satoshis)`);
  }
  const outputScript = bitcoinjs.address.toOutputScript(destinationAddress, dashNetwork);
  tx.addOutput(outputScript, BigInt(outputAmount));

  // Sign the transaction
  const hashType = bitcoinjs.Transaction.SIGHASH_ALL;
  const signatureHash = tx.hashForSignature(0, redeemScript, hashType);
  const signature = keyPair.sign(signatureHash);
  const signatureDER = toDER(signature);
  const signatureWithHashType = Buffer.concat([signatureDER, Buffer.from([hashType])]);

  // Build scriptSig: <ord> <1> <content-type> <0> <chunk1> ... <chunkN> <signature> <redeem_script>
  const scriptSigParts = [
    Buffer.from('ord', 'utf-8'),
    bitcoinjs.opcodes.OP_1,
    Buffer.from(contentType, 'utf-8'),
    bitcoinjs.opcodes.OP_0,
  ];

  for (const chunk of contentChunks) {
    scriptSigParts.push(chunk);
  }

  scriptSigParts.push(signatureWithHashType);
  scriptSigParts.push(redeemScript);

  const scriptSig = bitcoinjs.script.compile(scriptSigParts);

  if (scriptSig.length > SCRIPT_SIG_MAX_SIZE) {
    throw new Error(`scriptSig size ${scriptSig.length} bytes exceeds network limit of ${SCRIPT_SIG_MAX_SIZE} bytes`);
  }

  tx.setInputScript(0, scriptSig);

  return {
    revealTxHex: tx.toHex(),
    revealTxId: tx.getId(),
  };
}

async function inscribe(wallet, destinationAddress, contentType, data) {
  const keyPair = ECPair.fromWIF(wallet.privkey, dashNetwork);
  const publicKey = keyPair.publicKey;

  // Calculate number of content chunks
  const numContentChunks = Math.ceil(data.length / CHUNK_SIZE);

  // Calculate fees
  const commitFee = DEFAULT_COMMIT_FEE;
  const revealFee = DEFAULT_REVEAL_FEE;
  const inscriptionAmount = DEFAULT_INSCRIPTION_AMOUNT;

  // Step 1: Build and broadcast commit transaction
  console.log("Building commit transaction...");
  const commit = await buildCommitTransaction(wallet, publicKey, inscriptionAmount, commitFee, numContentChunks);

  console.log("Broadcasting commit transaction...");
  await broadcast(commit.commitTxHex, false);
  console.log("Commit transaction broadcast:", commit.commitTxId);

  // Wait a bit for commit to propagate
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Step 2: Build and broadcast reveal transaction
  console.log("Building reveal transaction...");
  const reveal = await buildRevealTransaction(
    commit.commitTxId,
    commit.p2shOutputIndex,
    commit.p2shAmount,
    commit.redeemScriptHex,
    commit.publicKeyHex,
    wallet.privkey, // WIF format
    contentType,
    data,
    destinationAddress,
    revealFee
  );

  console.log("Broadcasting reveal transaction...");
  await broadcast(reveal.revealTxHex, false);
  console.log("Reveal transaction broadcast:", reveal.revealTxId);

  // Update wallet
  updateWalletAfterCommit(wallet, commit.commitTxId);
  fs.writeFileSync(WALLET_PATH, JSON.stringify(wallet, 0, 2));

  return {
    commitTxId: commit.commitTxId,
    revealTxId: reveal.revealTxId,
    inscriptionId: `${reveal.revealTxId}:0`,
  };
}

function updateWalletAfterCommit(wallet, commitTxId) {
  // Remove spent UTXOs (simplified - in production would need to track which UTXOs were used)
  // For now, just sync again after commit
}

async function broadcastAll(txs, retry) {
  for (let i = 0; i < txs.length; i++) {
    console.log(`broadcasting tx ${i + 1} of ${txs.length}`);
    try {
      await broadcast(txs[i], retry);
    } catch (e) {
      console.log("broadcast failed", e?.response?.data);
      if (e?.response?.data?.error?.message?.includes("bad-txns-inputs-spent") || 
          e?.response?.data?.error?.message?.includes("already in block chain")) {
        console.log("tx already sent, skipping");
        continue;
      }
      console.log("saving pending txs to pending-txs.json");
      console.log("to reattempt broadcast, re-run the command");
      fs.writeFileSync("pending-txs.json", JSON.stringify(txs.slice(i)));
      process.exit(1);
    }
  }

  try {
    fs.unlinkSync("pending-txs.json");
  } catch (err) {
    // ignore
  }
}

async function broadcast(txHex, retry) {
  const body = {
    jsonrpc: "1.0",
    id: 0,
    method: "sendrawtransaction",
    params: [txHex],
  };

  const options = {
    auth: {
      username: process.env.NODE_RPC_USER,
      password: process.env.NODE_RPC_PASS,
    },
  };

  while (true) {
    try {
      await axios.post(process.env.NODE_RPC_URL, body, options);
      break;
    } catch (e) {
      if (!retry) throw e;
      let msg = e.response && e.response.data && e.response.data.error && e.response.data.error.message;
      if (msg && msg.includes("too-long-mempool-chain")) {
        console.warn("retrying, too-long-mempool-chain");
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } else {
        throw e;
      }
    }
  }
}

function chunkToNumber(chunk) {
  if (chunk.opcodenum == 0) return 0;
  if (chunk.opcodenum == 1) return chunk.buf[0];
  if (chunk.opcodenum == 2) return chunk.buf[1] * 255 + chunk.buf[0];
  if (chunk.opcodenum > 80 && chunk.opcodenum <= 96) return chunk.opcodenum - 80;
  return undefined;
}

async function extract(txid) {
  const body = {
    jsonrpc: "1.0",
    id: "extract",
    method: "getrawtransaction",
    params: [txid, true],
  };

  const options = {
    auth: {
      username: process.env.NODE_RPC_USER,
      password: process.env.NODE_RPC_PASS,
    },
  };

  let response = await axios.post(process.env.NODE_RPC_URL, body, options);
  let transaction = response.data.result;

  let inputs = transaction.vin;
  if (!inputs || inputs.length === 0) {
    throw new Error("no inputs found in transaction");
  }

  let scriptHex = inputs[0].scriptSig.hex;
  if (!scriptHex) {
    throw new Error("no scriptSig found");
  }

  let script = bitcoinjs.script.decompile(Buffer.from(scriptHex, 'hex'));
  if (!script) {
    throw new Error("could not decompile script");
  }

  // Find "ord" prefix
  let ordIndex = -1;
  for (let i = 0; i < script.length; i++) {
    if (Buffer.isBuffer(script[i]) && script[i].toString('utf-8') === 'ord') {
      ordIndex = i;
      break;
    }
  }

  if (ordIndex === -1) {
    throw new Error("not a darinal");
  }

  // Parse inscription data
  // Format: <ord> <OP_1> <content-type> <OP_0> <chunk1> ... <chunkN> <signature> <redeem_script>
  let idx = ordIndex + 1;
  
  // Skip OP_1
  if (script[idx] !== bitcoinjs.opcodes.OP_1) {
    throw new Error("invalid inscription format");
  }
  idx++;

  // Get content type
  if (!Buffer.isBuffer(script[idx])) {
    throw new Error("invalid content type");
  }
  const contentType = script[idx].toString('utf-8');
  idx++;

  // Skip OP_0
  if (script[idx] !== bitcoinjs.opcodes.OP_0) {
    throw new Error("invalid inscription format");
  }
  idx++;

  // Collect content chunks (everything until signature)
  const contentChunks = [];
  while (idx < script.length - 2) { // -2 for signature and redeem script
    if (Buffer.isBuffer(script[idx])) {
      contentChunks.push(script[idx]);
    }
    idx++;
  }

  const data = Buffer.concat(contentChunks);

  return {
    contentType,
    data,
  };
}

function server() {
  const app = express();
  const port = process.env.SERVER_PORT ? parseInt(process.env.SERVER_PORT) : 3000;

  app.get("/tx/:txid", (req, res) => {
    extract(req.params.txid)
      .then((result) => {
        res.setHeader("content-type", result.contentType);
        res.send(result.data);
      })
      .catch((e) => res.send(e.message));
  });

  app.listen(port, () => {
    console.log(`Listening on port ${port}`);
    console.log();
    console.log(`Example:`);
    console.log(`http://localhost:${port}/tx/15f3b73df7e5c072becb1d84191843ba080734805addfccb650929719080f62e`);
  });
}

main().catch((e) => {
  let reason = e.response && e.response.data && e.response.data.error && e.response.data.error.message;
  console.error(reason ? e.message + ":" + reason : e.message);
  process.exit(1);
});

