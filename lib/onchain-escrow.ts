/**
 * On-chain escrow integration (Hedera EVM).
 * When ESCROW_CONTRACT_ADDRESS is unset — all methods return not_live.
 */
import { createHash } from "crypto";
import { ESCROW_CONTRACT_ADDRESS, NETWORK } from "./config";

export const ESCROW_ABI = [
  "function deposit(bytes32 orderId, address seller) payable",
  "function release(bytes32 orderId)",
  "function refund(bytes32 orderId)",
  "function deals(bytes32) view returns (address buyer, address seller, uint256 amount, uint256 createdAt, uint256 unlockAt, uint8 state)",
  "function platformFeeBps() view returns (uint256)",
  "function operator() view returns (address)",
  "function paused() view returns (bool)",
  "function pause()",
  "function unpause()",
  "event Deposited(bytes32 indexed orderId, address buyer, address seller, uint256 amount)",
  "event Released(bytes32 indexed orderId, address seller, uint256 sellerAmount, uint256 fee)",
  "event Refunded(bytes32 indexed orderId, address buyer, uint256 amount)",
  "event Paused(address by)",
  "event Unpaused(address by)",
] as const;

export function isEscrowContractLive() {
  return Boolean(ESCROW_CONTRACT_ADDRESS);
}

export function escrowContractInfo() {
  return {
    live: isEscrowContractLive(),
    address: ESCROW_CONTRACT_ADDRESS || null,
    network: NETWORK,
    abi: ESCROW_ABI,
    note: ESCROW_CONTRACT_ADDRESS
      ? "Contract configured — wire ethers/viem for deposit/release"
      : "Not deployed. Off-chain escrow state machine is active.",
  };
}

/** Hash order id string to bytes32 hex for contract orderId */
export function orderIdToBytes32(orderId: string): string {
  return "0x" + createHash("sha256").update(orderId).digest("hex");
}

/**
 * Placeholder for future on-chain deposit after off-chain payment.
 * Returns instruction object agents/ops can use.
 */
export function buildOnChainDepositPlan(opts: {
  orderId: string;
  sellerEvmAddress: string;
  amountWei: string;
}) {
  if (!isEscrowContractLive()) {
    return {
      ok: false as const,
      mode: "off_chain_only",
      message:
        "Set ESCROW_CONTRACT_ADDRESS after deploying OpenMarketEscrow.sol",
    };
  }
  return {
    ok: true as const,
    mode: "on_chain",
    contract: ESCROW_CONTRACT_ADDRESS,
    method: "deposit",
    args: {
      orderId: orderIdToBytes32(opts.orderId),
      seller: opts.sellerEvmAddress,
      valueWei: opts.amountWei,
    },
    abiFragment: ESCROW_ABI[0],
  };
}

export function buildOnChainReleasePlan(orderId: string) {
  if (!isEscrowContractLive()) {
    return { ok: false as const, mode: "off_chain_only" };
  }
  return {
    ok: true as const,
    mode: "on_chain",
    contract: ESCROW_CONTRACT_ADDRESS,
    method: "release",
    args: { orderId: orderIdToBytes32(orderId) },
  };
}

export function buildOnChainRefundPlan(orderId: string) {
  if (!isEscrowContractLive()) {
    return { ok: false as const, mode: "off_chain_only" };
  }
  return {
    ok: true as const,
    mode: "on_chain",
    contract: ESCROW_CONTRACT_ADDRESS,
    method: "refund",
    args: { orderId: orderIdToBytes32(orderId) },
  };
}
