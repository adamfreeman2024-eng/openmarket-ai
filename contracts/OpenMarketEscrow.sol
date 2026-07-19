// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * OpenMarketEscrow — minimal Hedera-ready escrow (Phase 8, hardened).
 *
 * Security fixes applied:
 * - ReentrancyGuard via status flag check + CEI pattern
 * - Emergency pause (circuit breaker)
 * - Explicit operator validation
 *
 * Flow:
 *  deposit(orderId, seller) payable  — buyer locks HBAR/value
 *  release(orderId)                  — seller or operator after proof
 *  refund(orderId)                   — buyer after timeout or operator
 *  pause() / unpause()               — operator only (emergency)
 */
contract OpenMarketEscrow {
    address public operator;
    uint256 public platformFeeBps; // e.g. 200 = 2%
    uint256 public defaultLockSeconds;
    bool public paused;

    struct Deal {
        address buyer;
        address seller;
        uint256 amount;
        uint256 createdAt;
        uint256 unlockAt;
        uint8 state; // 0=none, 1=locked, 2=released, 3=refunded
    }

    mapping(bytes32 => Deal) public deals;

    event Deposited(bytes32 indexed orderId, address buyer, address seller, uint256 amount);
    event Released(bytes32 indexed orderId, address seller, uint256 sellerAmount, uint256 fee);
    event Refunded(bytes32 indexed orderId, address buyer, uint256 amount);
    event Paused(address by);
    event Unpaused(address by);

    modifier onlyOperator() {
        require(msg.sender == operator, "not operator");
        _;
    }

    modifier notPaused() {
        require(!paused, "contract paused");
        _;
    }

    constructor(uint256 _feeBps, uint256 _lockSeconds) {
        operator = msg.sender;
        platformFeeBps = _feeBps;
        defaultLockSeconds = _lockSeconds;
    }

    /// @dev Buyer deposits HBAR; seller is locked as recipient on release.
    function deposit(bytes32 orderId, address seller) external payable notPaused {
        require(msg.value > 0, "no value");
        require(seller != address(0), "seller");
        require(deals[orderId].state == 0, "exists");
        deals[orderId] = Deal({
            buyer: msg.sender,
            seller: seller,
            amount: msg.value,
            createdAt: block.timestamp,
            unlockAt: block.timestamp + defaultLockSeconds,
            state: 1 // locked
        });
        emit Deposited(orderId, msg.sender, seller, msg.value);
    }

    /// @dev Release funds to seller (minus platform fee). CEI pattern.
    function release(bytes32 orderId) external notPaused {
        Deal storage d = deals[orderId];
        require(d.state == 1, "not locked");
        require(msg.sender == d.seller || msg.sender == operator, "auth");

        // Effects
        d.state = 2; // released
        uint256 fee = (d.amount * platformFeeBps) / 10000;
        uint256 toSeller = d.amount - fee;

        // Interactions
        (bool ok1, ) = d.seller.call{value: toSeller}("");
        require(ok1, "seller pay");
        if (fee > 0) {
            (bool ok2, ) = operator.call{value: fee}("");
            require(ok2, "fee pay");
        }
        emit Released(orderId, d.seller, toSeller, fee);
    }

    /// @dev Refund to buyer. Allowed by operator anytime, by buyer only after timeout.
    function refund(bytes32 orderId) external notPaused {
        Deal storage d = deals[orderId];
        require(d.state == 1, "not locked");
        bool timedOut = block.timestamp >= d.unlockAt;
        require(msg.sender == operator || (msg.sender == d.buyer && timedOut), "auth");

        // Effects
        d.state = 3; // refunded
        // Interactions
        (bool ok, ) = d.buyer.call{value: d.amount}("");
        require(ok, "refund");
        emit Refunded(orderId, d.buyer, d.amount);
    }

    function setOperator(address n) external onlyOperator {
        operator = n;
    }

    function pause() external onlyOperator {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOperator {
        paused = false;
        emit Unpaused(msg.sender);
    }
}
