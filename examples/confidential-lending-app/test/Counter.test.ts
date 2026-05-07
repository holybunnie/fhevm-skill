import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";

describe("Counter", function () {
  async function deployFixture() {
    const factory = await ethers.getContractFactory("Counter");
    const counter = await factory.deploy();
    const counterAddress = await counter.getAddress();
    return { counter, counterAddress };
  }

  it("should encrypt, increment, decrypt, and assert correctness", async function () {
    const { counter, counterAddress } = await deployFixture();
    const [, alice] = await ethers.getSigners();

    // Encrypt the value 42
    const encrypted = await fhevm
      .createEncryptedInput(counterAddress, alice.address)
      .add32(42)
      .encrypt();

    // Call increment with encrypted input
    const tx = await counter
      .connect(alice)
      .increment(encrypted.handles[0], encrypted.inputProof);
    await tx.wait();

    // Read encrypted handle from contract
    const encryptedCount = await counter.getCount();

    // Decrypt and assert
    const clearCount = await fhevm.userDecryptEuint(
      FhevmType.euint32,
      encryptedCount,
      counterAddress,
      alice,
    );
    expect(clearCount).to.eq(42);
  });

  it("should accumulate multiple increments", async function () {
    const { counter, counterAddress } = await deployFixture();
    const [, alice] = await ethers.getSigners();

    // First increment: 10
    const enc1 = await fhevm
      .createEncryptedInput(counterAddress, alice.address)
      .add32(10)
      .encrypt();
    await (await counter.connect(alice).increment(enc1.handles[0], enc1.inputProof)).wait();

    // Second increment: 25
    const enc2 = await fhevm
      .createEncryptedInput(counterAddress, alice.address)
      .add32(25)
      .encrypt();
    await (await counter.connect(alice).increment(enc2.handles[0], enc2.inputProof)).wait();

    // Decrypt and assert 10 + 25 = 35
    const encryptedCount = await counter.getCount();
    const clearCount = await fhevm.userDecryptEuint(
      FhevmType.euint32,
      encryptedCount,
      counterAddress,
      alice,
    );
    expect(clearCount).to.eq(35);
  });
});
