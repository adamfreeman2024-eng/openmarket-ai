// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * OpenMarketEscrow — minimal Hedera-ready escrow skeleton (Phase 8).
 * Not deployed yet. Deploy via Hardhat/Foundry on Hedera testnet later.
 *
 * Flow:
 *  deposit(orderId, seller) payable  — buyer locks HBAR/value
 *  release(orderId)                  — seller or operator after proof
 *  refund(orderId)                   — buyer after timeout or operator
 */
contract OpenMarketEscrow {
    address public operator;
    uint256 public platformFeeBps; // e.g. 200 = 2%
    uint256 public defaultLockSeconds;

    struct Deal {
        address buyer;
        address seller;
        uint256 amount;
        uint256 createdAt;
        uint256 unlockAt;
        bool released;
        bool refunded;
        bool exists;
    }

    mapping(bytes32 => Deal) public deals;

    event Deposited(bytes32 indexed orderId, address buyer, address seller, uint256 amount);
    event Released(bytes32 indexed orderId, address seller, uint256 sellerAmount, uint256 fee);
    event Refunded(bytes32 indexed orderId, address buyer, uint256 amount);

    modifier onlyOperator() {
        require(msg.sender == operator, "not operator");
        _;
    }

    constructor(uint256 _feeBps, uint256 _lockSeconds) {
        operator = msg.sender;
        platformFeeBps = _feeBps;
        defaultLockSeconds = _lockSeconds;
    }

    function deposit(bytes32 orderId, address seller) external payable {
        require(msg.value > 0, "no value");
        require(seller != address(0), "seller");
        require(!deals[orderId].exists, "exists");
        deals[orderId] = Deal({
            buyer: msg.sender,
            seller: seller,
            amount: msg.value,
            createdAt: block.timestamp,
            unlockAt: block.timestamp + defaultLockSeconds,
            released: false,
            refunded: false,
            exists: true
        });
        emit Deposited(orderId, msg.sender, seller, msg.value);
    }

    function release(bytes32 orderId) external {
        Deal storage d = deals[orderId];
        require(d.exists && !d.released && !d.refunded, "state");
        require(msg.sender == d.seller || msg.sender == operator, "auth");
        d.released = true;
        uint256 fee = (d.amount * platformFeeBps) / 10000;
        uint256 toSeller = d.amount - fee;
        (bool ok1, ) = d.seller.call{value: toSeller}("");
        require(ok1, "seller pay");
        if (fee > 0) {
            (bool ok2, ) = operator.call{value: fee}("");
            require(ok2, "fee pay");
        }
        emit Released(orderId, d.seller, toSeller, fee);
    }

    function refund(bytes32 orderId) external {
        Deal storage d = deals[orderId];
        require(d.exists && !d.released && !d.refunded, "state");
        bool timedOut = block.timestamp >= d.unlockAt;
        require(msg.sender == operator || (msg.sender == d.buyer && timedOut), "auth");
        d.refunded = true;
        (bool ok, ) = d.buyer.call{value: d.amount}("");
        require(ok, "refund");
        emit Refunded(orderId, d.buyer, d.amount);
    }

    function setOperator(address n) external onlyOperator {
        operator = n;
    }
}
