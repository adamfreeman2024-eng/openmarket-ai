/**
 * Real on-chain escrow integration — calls deployed OpenMarketEscrow.sol
 * via ethers.js on Hedera JSON-RPC relay.
 *
 * When ESCROW_CONTRACT_ADDRESS is set, these functions make real
 * contract calls: deposit, release, refund, getDeal.
 *
 * Keys loaded from env: HEDERA_OPERATOR_KEY (ECDSA, DER-encoded).
 */
import { ethers } from "ethers";
import { ESCROW_CONTRACT_ADDRESS, NETWORK } from "./config";
import { orderIdToBytes32, ESCROW_ABI } from "./onchain-escrow";

/** Get Hedera JSON-RPC provider */
function getProvider(): ethers.JsonRpcProvider {
  const rpcUrl =
    NETWORK === "mainnet"
      ? "https://mainnet.hashio.io/api/v1"
      : "https://testnet.hashio.io/api/v1";
  return new ethers.JsonRpcProvider(rpcUrl);
}

/** Get operator wallet from env */
function getOperatorWallet(): ethers.Wallet | null {
  const derKey = process.env.HEDERA_OPERATOR_KEY;
  if (!derKey) return null;

  // Convert DER-encoded ECDSA private key to raw 32-byte hex
  // DER format: 3030020100300706052b8104000a04220420<32 bytes>
  const rawKey = derKey.startsWith("0x")
    ? derKey.slice(-64) // already hex, take last 32 bytes
    : derKey.slice(-64); // DER hex, take last 32 bytes

  const provider = getProvider();
  return new ethers.Wallet("0x" + rawKey, provider);
}

/** Get contract instance connected to operator wallet */
function getContract(): ethers.Contract | null {
  if (!ESCROW_CONTRACT_ADDRESS) return null;
  const wallet = getOperatorWallet();
  if (!wallet) return null;
  return new ethers.Contract(ESCROW_CONTRACT_ADDRESS, ESCROW_ABI, wallet);
}

/** Read-only contract (for view functions) */
function getReadContract(): ethers.Contract | null {
  if (!ESCROW_CONTRACT_ADDRESS) return null;
  const provider = getProvider();
  return new ethers.Contract(ESCROW_CONTRACT_ADDRESS, ESCROW_ABI, provider);
}

export type OnChainDeal = {
  buyer: string;
  seller: string;
  amount: bigint;
  createdAt: bigint;
  unlockAt: bigint;
  state: number; // 0=none, 1=locked, 2=released, 3=refunded
};

/** Get deal state from contract */
export async function getOnChainDeal(orderId: string): Promise<OnChainDeal | null> {
  const contract = getReadContract();
  if (!contract) return null;

  try {
    const id = orderIdToBytes32(orderId);
    const result = await contract.deals(id);
    const deal = result as [string, string, bigint, bigint, bigint, number];
    return {
      buyer: deal[0],
      seller: deal[1],
      amount: deal[2],
      createdAt: deal[3],
      unlockAt: deal[4],
      state: deal[5],
    };
  } catch {
    return null;
  }
}

/** Deposit HBAR to escrow contract for an order */
export async function onChainDeposit(opts: {
  orderId: string;
  sellerEvmAddress: string;
  amountHbar: number;
}): Promise<{ ok: boolean; txHash?: string; error?: string }> {
  const contract = getContract();
  if (!contract) return { ok: false, error: "Contract not configured" };

  try {
    const id = orderIdToBytes32(opts.orderId);
    const amountWei = ethers.parseEther(opts.amountHbar.toString());
    const tx = await contract.deposit(id, opts.sellerEvmAddress, {
      value: amountWei,
      gasLimit: 800000,
    });
    await tx.wait();
    return { ok: true, txHash: tx.hash };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "deposit failed",
    };
  }
}

/** Release escrow funds to seller (operator or seller) */
export async function onChainRelease(orderId: string): Promise<{
  ok: boolean;
  txHash?: string;
  error?: string;
}> {
  const contract = getContract();
  if (!contract) return { ok: false, error: "Contract not configured" };

  try {
    const id = orderIdToBytes32(orderId);
    const tx = await contract.release(id, { gasLimit: 800000 });
    await tx.wait();
    return { ok: true, txHash: tx.hash };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "release failed",
    };
  }
}

/** Refund escrow to buyer (operator or buyer after timeout) */
export async function onChainRefund(orderId: string): Promise<{
  ok: boolean;
  txHash?: string;
  error?: string;
}> {
  const contract = getContract();
  if (!contract) return { ok: false, error: "Contract not configured" };

  try {
    const id = orderIdToBytes32(orderId);
    const tx = await contract.refund(id, { gasLimit: 800000 });
    await tx.wait();
    return { ok: true, txHash: tx.hash };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "refund failed",
    };
  }
}

/** Check if contract is paused */
export async function isContractPaused(): Promise<boolean> {
  const contract = getReadContract();
  if (!contract) return false;
  try {
    return await contract.paused();
  } catch {
    return false;
  }
}

/** Get contract info (live read) */
export async function getContractInfo(): Promise<{
  address: string;
  operator: string;
  feeBps: number;
  lockSeconds: number;
  paused: boolean;
} | null> {
  const contract = getReadContract();
  if (!contract) return null;

  try {
    const [operator, feeBps, lockSeconds, paused] = await Promise.all([
      contract.operator(),
      contract.platformFeeBps(),
      contract.defaultLockSeconds(),
      contract.paused(),
    ]);
    return {
      address: ESCROW_CONTRACT_ADDRESS,
      operator: operator as string,
      feeBps: Number(feeBps),
      lockSeconds: Number(lockSeconds),
      paused: paused as boolean,
    };
  } catch {
    return null;
  }
}

/** Generate HashScan URL for a transaction */
export function hashScanUrl(txHash: string): string {
  return `https://hashscan.io/${NETWORK}/transaction/${txHash}`;
}
