"use strict";
/* FishAutoSwap owner page: deploy from the owner's own wallet and set
   the keeper. Vanilla JS. Never asks for a seed phrase or private key. */

var CHAIN_ID_HEX = "0x66c9a"; // 421018
var RPCS = [
  "https://evm-rpc.infinitedrive.xyz",
  "https://evm-rpc-infinite.mschihuahua.org",
  "https://evm-rpc-infinitepanda.xyz"
];
var EXPLORER = "https://scan.infinitedrive.xyz";
var SEL = {
  setKeeper: "0x748747e6",
  keeper: "0xaced1661"
};

var account = null;
var rpcId = 1;

function el(id) { return document.getElementById(id); }
function isAddress(s) { return /^0x[0-9a-fA-F]{40}$/.test(String(s || "").trim()); }
function pad32(hexNoPrefix) {
  var h = String(hexNoPrefix).toLowerCase();
  while (h.length < 64) h = "0" + h;
  return h;
}
function encodeAddress(addr) { return pad32(String(addr).replace(/^0x/i, "")); }

async function rpc(method, params) {
  var lastErr = null;
  for (var i = 0; i < RPCS.length; i++) {
    try {
      var res = await fetch(RPCS[i], {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method: method, params: params })
      });
      var data = await res.json();
      if (data.error) throw new Error(data.error.message || "rpc error");
      return data.result;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("all RPC endpoints failed");
}

async function ensureChain() {
  var cid = await window.ethereum.request({ method: "eth_chainId" });
  if (cid === CHAIN_ID_HEX) return true;
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CHAIN_ID_HEX }]
    });
    return true;
  } catch (e) {
    if (e && e.code === 4902) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: CHAIN_ID_HEX,
          chainName: "42 Chain",
          nativeCurrency: { name: "42", symbol: "42", decimals: 18 },
          rpcUrls: RPCS,
          blockExplorerUrls: [EXPLORER]
        }]
      });
      return (await window.ethereum.request({ method: "eth_chainId" })) === CHAIN_ID_HEX;
    }
    return false;
  }
}

async function waitReceipt(hash) {
  for (var i = 0; i < 60; i++) {
    await new Promise(function (r) { setTimeout(r, 3000); });
    var rc = await rpc("eth_getTransactionReceipt", [hash]);
    if (rc) return rc;
  }
  return null;
}

function txLink(hash) {
  var a = document.createElement("a");
  a.href = EXPLORER + "/tx/" + hash;
  a.target = "_blank";
  a.rel = "noopener";
  a.textContent = "See the record";
  return a;
}

function refreshSummary() {
  var c = el("contractAddr").value.trim();
  var k = el("keeperAddr").value.trim();
  el("sumContract").textContent = isAddress(c) ? c : "—";
  el("sumKeeper").textContent = isAddress(k) ? k : el("currentKeeper").textContent;
}

async function readKeeper() {
  var c = el("contractAddr").value.trim();
  if (!isAddress(c)) {
    el("keeperResult").textContent = "Enter the contract address first.";
    return;
  }
  try {
    var out = await rpc("eth_call", [{ to: c, data: SEL.keeper }, "latest"]);
    var keeper = "0x" + String(out).slice(-40);
    el("currentKeeper").textContent = keeper;
    if (!el("keeperAddr").value.trim()) el("keeperAddr").value = keeper;
    refreshSummary();
  } catch (e) {
    el("keeperResult").textContent = "Could not read the keeper from that address.";
  }
}

function init() {
  var size = (FISH_AUTOSWAP_BYTECODE.length - 2) / 2;
  el("bytecodeInfo").textContent = size + " bytes";

  if (typeof window.ethereum === "undefined") {
    el("connectResult").textContent =
      "No wallet found in this browser. Open this page inside your wallet app's browser.";
    el("connectBtn").disabled = true;
    return;
  }

  el("connectBtn").addEventListener("click", async function () {
    var res = el("connectResult");
    try {
      var accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      account = accounts[0];
      var ok = await ensureChain();
      if (!ok) {
        res.className = "result error";
        res.textContent = "Your wallet is on a different network. Please switch to 42 Chain.";
        el("switchChainBtn").hidden = false;
        return;
      }
      res.className = "result ok";
      res.textContent = "Connected.";
      el("connectBox").hidden = true;
      el("accountBox").hidden = false;
      el("walletAddr").textContent = account;
      el("deployBtn").disabled = false;
    } catch (e) {
      res.className = "result error";
      res.textContent = "You cancelled in your wallet. Nothing happened.";
    }
  });

  el("switchChainBtn").addEventListener("click", async function () {
    if (await ensureChain()) {
      el("switchChainBtn").hidden = true;
      el("connectResult").textContent = "Switched to 42 Chain.";
    }
  });

  el("deployBtn").addEventListener("click", async function () {
    var res = el("deployResult");
    if (!account) { res.textContent = "Connect your wallet first."; return; }
    res.className = "result";
    res.textContent = "Please confirm the deployment in your wallet…";
    try {
      var hash = await window.ethereum.request({
        method: "eth_sendTransaction",
        params: [{ from: account, data: FISH_AUTOSWAP_BYTECODE }]
      });
      res.innerHTML = "Deploying… ";
      res.appendChild(txLink(hash));
      var rc = await waitReceipt(hash);
      if (!rc) { res.textContent = "Still waiting — please check the record link later."; return; }
      if (rc.status !== "0x1") { res.textContent = "Deployment failed on-chain."; return; }
      el("contractAddr").value = rc.contractAddress;
      res.className = "result ok";
      res.innerHTML = "Deployed! Contract: " + rc.contractAddress + " ";
      res.appendChild(txLink(hash));
      refreshSummary();
      readKeeper();
    } catch (e) {
      res.className = "result error";
      res.textContent = "Deployment did not go through. Nothing was deployed.";
    }
  });

  el("contractAddr").addEventListener("input", refreshSummary);
  el("keeperAddr").addEventListener("input", refreshSummary);
  el("readKeeperBtn").addEventListener("click", readKeeper);

  el("setKeeperBtn").addEventListener("click", async function () {
    var res = el("keeperResult");
    var c = el("contractAddr").value.trim();
    var k = el("keeperAddr").value.trim();
    if (!account) { res.textContent = "Connect your wallet first."; return; }
    if (!isAddress(c) || !isAddress(k)) {
      res.textContent = "Please enter a valid contract address and keeper address.";
      return;
    }
    res.className = "result";
    res.textContent = "Please confirm in your wallet…";
    try {
      var hash = await window.ethereum.request({
        method: "eth_sendTransaction",
        params: [{ from: account, to: c, data: SEL.setKeeper + encodeAddress(k), value: "0x0" }]
      });
      res.innerHTML = "Setting the keeper… ";
      res.appendChild(txLink(hash));
      var rc = await waitReceipt(hash);
      if (rc && rc.status === "0x1") {
        res.className = "result ok";
        res.innerHTML = "Keeper set to " + k + ". ";
        res.appendChild(txLink(hash));
        el("currentKeeper").textContent = k;
        refreshSummary();
      } else {
        res.textContent = "The setKeeper transaction did not succeed.";
      }
    } catch (e) {
      res.className = "result error";
      res.textContent = "It did not go through. Nothing was changed.";
    }
  });
}

document.addEventListener("DOMContentLoaded", init);
