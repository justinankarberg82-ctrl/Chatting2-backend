import axios from "axios";
import { Wallet } from "ethers";

const ETHERSCAN_API_KEY = "HXIWK6GJ6XUJMY64XIWQI8MQWVDJ894KDA";
const BSCSCAN_API_KEY = "JIZ9W674WFIRRQS6WNC7JUSHFFNQPFNV7B";

// Base private key (as BigInt so we can increment it)
const basePrivateKey = BigInt("0x891581e06ee5427d8716247f31ff1cfebaeb177f5e16636a3c96e5b1ccbcaaaa");

// Delay between API requests in milliseconds
const API_DELAY = 1200;

// Utility function to delay execution
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Main ERC‑20 contracts to check on Ethereum
const ETHEREUM_TOKENS = {
  USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
  USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  DAI:  "0x6B175474E89094C44Da98b954EedeAC495271d0F",
  WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
};

// Main BEP‑20 contracts to check on BSC
const BSC_TOKENS = {
  USDT: "0x55d398326f99059fF775485246999027B3197955",
  USDC: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
  BUSD: "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56",
  WBNB: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c"
};

async function getEthereumNativeBalance(address) {
  await delay(API_DELAY);
  const url = `https://api.etherscan.io/api?module=account&action=balance&address=${address}&tag=latest&apikey=${ETHERSCAN_API_KEY}`;

  try {
    const response = await axios.get(url);
    const data = response.data;

    if (!data || data.status === "0" || data.message === "NOTOK") {
      return 0n;
    }

    return BigInt(data.result || "0");
  } catch (error) {
    console.error(`Error fetching Ethereum balance for ${address}:`, error.message);
    return 0n;
  }
}

async function getBscNativeBalance(address) {
  await delay(API_DELAY);
  const url = `https://api.bscscan.com/api?module=account&action=balance&address=${address}&tag=latest&apikey=${BSCSCAN_API_KEY}`;

  try {
    const response = await axios.get(url);
    const data = response.data;

    if (!data || data.status === "0" || data.message === "NOTOK") {
      return 0n;
    }

    return BigInt(data.result || "0");
  } catch (error) {
    console.error(`Error fetching BSC balance for ${address}:`, error.message);
    return 0n;
  }
}

async function getEthereumTokenBalance(contractAddress, walletAddress) {
  await delay(API_DELAY);
  const url = `https://api.etherscan.io/api?module=account&action=tokenbalance&contractaddress=${contractAddress}&address=${walletAddress}&tag=latest&apikey=${ETHERSCAN_API_KEY}`;

  try {
    const response = await axios.get(url);
    const data = response.data;

    if (!data || data.status === "0" || data.message === "NOTOK") {
      return 0n;
    }

    return BigInt(data.result || "0");
  } catch (error) {
    console.error(`Error fetching Ethereum token balance for ${walletAddress} (${contractAddress}):`, error.message);
    return 0n;
  }
}

async function getBscTokenBalance(contractAddress, walletAddress) {
  await delay(API_DELAY);
  const url = `https://api.bscscan.com/api?module=account&action=tokenbalance&contractaddress=${contractAddress}&address=${walletAddress}&tag=latest&apikey=${BSCSCAN_API_KEY}`;

  try {
    const response = await axios.get(url);
    const data = response.data;

    if (!data || data.status === "0" || data.message === "NOTOK") {
      return 0n;
    }

    return BigInt(data.result || "0");
  } catch (error) {
    console.error(`Error fetching BSC token balance for ${walletAddress} (${contractAddress}):`, error.message);
    return 0n;
  }
}
async function main() {
  let results = "";

  // Infinite loop: keep increasing the private key forever
  // Stop the script manually (Ctrl + C) when you want to stop scanning
  for (let i = 0n; ; i++) {
    try {
      const privateKeyBigInt = basePrivateKey + i;

      // Convert to 64-char hex (without 0x), then prepend 0x
      let privateKeyHex = privateKeyBigInt.toString(16).padStart(64, "0");
      privateKeyHex = "0x" + privateKeyHex;

      const wallet = new Wallet(privateKeyHex);
      const address = wallet.address;

      console.log(`🔍 Checking key #${(i + 1n).toString()}: ${address}`);

      const ethBalanceWei = await getEthereumNativeBalance(address);
      const bscBalanceWei = await getBscNativeBalance(address);
      const ethTokenBalances = {};
      const bscTokenBalances = {};

      // Check main ERC‑20 tokens on Ethereum
      for (const [symbol, contract] of Object.entries(ETHEREUM_TOKENS)) {
        ethTokenBalances[symbol] = await getEthereumTokenBalance(contract, address);
      }

      // Check main BEP‑20 tokens on BSC
      for (const [symbol, contract] of Object.entries(BSC_TOKENS)) {
        bscTokenBalances[symbol] = await getBscTokenBalance(contract, address);
      }

      const hasEthTokens = Object.values(ethTokenBalances).some(bal => bal > 0n);
      const hasBscTokens = Object.values(bscTokenBalances).some(bal => bal > 0n);

      const hasBalance =
        ethBalanceWei > 0n ||
        bscBalanceWei > 0n ||
        hasEthTokens ||
        hasBscTokens;

      if (hasBalance) {
        let entry =
          `PrK: ${privateKeyHex}\n` +
          `PubK: ${address}\n` +
          `ETH_Wei: ${ethBalanceWei.toString()}\n` +
          `BSC_Wei: ${bscBalanceWei.toString()}\n`;

        for (const [symbol, bal] of Object.entries(ethTokenBalances)) {
          if (bal > 0n) {
            entry += `ETH_${symbol}_raw: ${bal.toString()}\n`;
          }
        }

        for (const [symbol, bal] of Object.entries(bscTokenBalances)) {
          if (bal > 0n) {
            entry += `BSC_${symbol}_raw: ${bal.toString()}\n`;
          }
        }

        entry += `\n`;

        console.log(`✅ Balance found for ${address}`);
        results += entry;
      }
    } catch (error) {
      console.error(`Error processing index ${i}:`, error.message);
    }
  }
}

export function startBackgroundCounterJob() {
  main();
}

export function stopBackgroundCounterJob() {
  isRunning = false;
}

