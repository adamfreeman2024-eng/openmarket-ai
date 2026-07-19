/**
 * Smart contract tests for OpenMarketEscrow.sol
 * Run: npx hardhat test
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("OpenMarketEscrow", function () {
  let contract;
  let owner;
  let buyer;
  let seller;
  let attacker;

  beforeEach(async function () {
    [owner, buyer, seller, attacker] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("OpenMarketEscrow");
    contract = await Factory.deploy(200, 3600); // 2% fee, 1h lock
    await contract.waitForDeployment();
  });

  describe("Deployment", function () {
    it("should set the correct operator", async function () {
      expect(await contract.operator()).to.equal(owner.address);
    });

    it("should set the correct fee", async function () {
      expect(await contract.platformFeeBps()).to.equal(200);
    });

    it("should set the correct lock seconds", async function () {
      expect(await contract.defaultLockSeconds()).to.equal(3600);
    });

    it("should start unpaused", async function () {
      expect(await contract.paused()).to.equal(false);
    });
  });

  describe("deposit", function () {
    it("should accept deposit and create deal", async function () {
      const orderId = ethers.id("order-1");
      await contract.connect(buyer).deposit(orderId, seller.address, {
        value: ethers.parseEther("1.0"),
      });

      const deal = await contract.deals(orderId);
      expect(deal.state).to.equal(1); // locked
      expect(deal.buyer).to.equal(buyer.address);
      expect(deal.seller).to.equal(seller.address);
      expect(deal.amount).to.equal(ethers.parseEther("1.0"));
    });

    it("should reject deposit with no value", async function () {
      const orderId = ethers.id("order-2");
      await expect(
        contract.connect(buyer).deposit(orderId, seller.address, { value: 0 })
      ).to.be.revertedWith("no value");
    });

    it("should reject deposit with zero seller address", async function () {
      const orderId = ethers.id("order-3");
      await expect(
        contract.connect(buyer).deposit(orderId, ethers.ZeroAddress, {
          value: ethers.parseEther("1.0"),
        })
      ).to.be.revertedWith("seller");
    });

    it("should reject duplicate deposit", async function () {
      const orderId = ethers.id("order-4");
      await contract.connect(buyer).deposit(orderId, seller.address, {
        value: ethers.parseEther("1.0"),
      });
      await expect(
        contract.connect(buyer).deposit(orderId, seller.address, {
          value: ethers.parseEther("1.0"),
        })
      ).to.be.revertedWith("exists");
    });

    it("should reject deposit when paused", async function () {
      await contract.pause();
      const orderId = ethers.id("order-5");
      await expect(
        contract.connect(buyer).deposit(orderId, seller.address, {
          value: ethers.parseEther("1.0"),
        })
      ).to.be.revertedWith("contract paused");
    });
  });

  describe("release", function () {
    const orderId = ethers.id("release-1");
    const amount = ethers.parseEther("1.0");

    beforeEach(async function () {
      await contract.connect(buyer).deposit(orderId, seller.address, {
        value: amount,
      });
    });

    it("should release funds to seller minus fee", async function () {
      const sellerBefore = await ethers.provider.getBalance(seller.address);
      await contract.connect(seller).release(orderId);
      const sellerAfter = await ethers.provider.getBalance(seller.address);

      // 2% fee = 0.02 ETH, seller gets 0.98 ETH (minus gas)
      const expectedGain = ethers.parseEther("0.98");
      const actualGain = sellerAfter - sellerBefore;
      expect(actualGain).to.be.closeTo(
        expectedGain,
        ethers.parseEther("0.001")
      );
    });

    it("should reject release from non-authorized party", async function () {
      await expect(
        contract.connect(attacker).release(orderId)
      ).to.be.revertedWith("auth");
    });

    it("should reject double release (reentrancy protection)", async function () {
      await contract.connect(seller).release(orderId);
      await expect(contract.connect(seller).release(orderId)).to.be.revertedWith(
        "not locked"
      );
    });

    it("should reject release when paused", async function () {
      await contract.pause();
      await expect(contract.connect(seller).release(orderId)).to.be.revertedWith(
        "contract paused"
      );
    });
  });

  describe("refund", function () {
    const orderId = ethers.id("refund-1");
    const amount = ethers.parseEther("1.0");

    beforeEach(async function () {
      await contract.connect(buyer).deposit(orderId, seller.address, {
        value: amount,
      });
    });

    it("should allow operator to refund anytime", async function () {
      const buyerBefore = await ethers.provider.getBalance(buyer.address);
      await contract.connect(owner).refund(orderId);
      const buyerAfter = await ethers.provider.getBalance(buyer.address);
      expect(buyerAfter - buyerBefore).to.be.closeTo(
        amount,
        ethers.parseEther("0.001")
      );
    });

    it("should reject buyer refund before timeout", async function () {
      await expect(
        contract.connect(buyer).refund(orderId)
      ).to.be.revertedWith("auth");
    });

    it("should allow buyer refund after timeout", async function () {
      // Fast-forward time (Hardhat network)
      await ethers.provider.send("evm_increaseTime", [3700]);
      await ethers.provider.send("evm_mine", []);

      const buyerBefore = await ethers.provider.getBalance(buyer.address);
      await contract.connect(buyer).refund(orderId);
      const buyerAfter = await ethers.provider.getBalance(buyer.address);
      expect(buyerAfter - buyerBefore).to.be.closeTo(
        amount,
        ethers.parseEther("0.001")
      );
    });

    it("should reject double refund (reentrancy protection)", async function () {
      await contract.connect(owner).refund(orderId);
      await expect(
        contract.connect(owner).refund(orderId)
      ).to.be.revertedWith("not locked");
    });

    it("should reject refund after release", async function () {
      await contract.connect(seller).release(orderId);
      await expect(
        contract.connect(owner).refund(orderId)
      ).to.be.revertedWith("not locked");
    });
  });

  describe("pause / unpause", function () {
    it("should allow operator to pause", async function () {
      await contract.pause();
      expect(await contract.paused()).to.equal(true);
    });

    it("should allow operator to unpause", async function () {
      await contract.pause();
      await contract.unpause();
      expect(await contract.paused()).to.equal(false);
    });

    it("should reject pause from non-operator", async function () {
      await expect(contract.connect(attacker).pause()).to.be.revertedWith(
        "not operator"
      );
    });
  });

  describe("setOperator", function () {
    it("should allow operator to transfer ownership", async function () {
      await contract.setOperator(seller.address);
      expect(await contract.operator()).to.equal(seller.address);
    });

    it("should reject setOperator from non-operator", async function () {
      await expect(
        contract.connect(attacker).setOperator(attacker.address)
      ).to.be.revertedWith("not operator");
    });
  });
});
