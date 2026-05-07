import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";

describe("ConfidentialLending — happy path", function () {
  async function deployFixture() {
    const [deployer, alice] = await ethers.getSigners();

    const tokenFactory = await ethers.getContractFactory("MockCUSDT");
    const token = await tokenFactory.deploy();
    const tokenAddress = await token.getAddress();

    const lendingFactory = await ethers.getContractFactory("ConfidentialLending");
    const lending = await lendingFactory.deploy(tokenAddress);
    const lendingAddress = await lending.getAddress();

    return { token, tokenAddress, lending, lendingAddress, deployer, alice };
  }

  it("should deposit collateral", async function () {
    const { token, tokenAddress, lending, lendingAddress, alice } = await deployFixture();

    // Mint 1000 to Alice
    const mintEnc = await fhevm
      .createEncryptedInput(tokenAddress, alice.address)
      .add64(1000)
      .encrypt();
    await (
      await token.connect(alice).mint(alice.address, mintEnc.handles[0], mintEnc.inputProof)
    ).wait();

    // Alice deposits 500 as collateral
    const depEnc = await fhevm
      .createEncryptedInput(lendingAddress, alice.address)
      .add64(500)
      .encrypt();
    await (
      await lending.connect(alice).deposit(depEnc.handles[0], depEnc.inputProof)
    ).wait();

    // Check collateral
    const encCol = await lending.getCollateral(alice.address);
    const col = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      encCol,
      lendingAddress,
      alice,
    );
    expect(col).to.eq(500);
  });

  it("should borrow up to 50% LTV", async function () {
    const { token, tokenAddress, lending, lendingAddress, alice } = await deployFixture();

    // Mint and deposit 1000
    const mintEnc = await fhevm
      .createEncryptedInput(tokenAddress, alice.address)
      .add64(1000)
      .encrypt();
    await (
      await token.connect(alice).mint(alice.address, mintEnc.handles[0], mintEnc.inputProof)
    ).wait();

    const depEnc = await fhevm
      .createEncryptedInput(lendingAddress, alice.address)
      .add64(1000)
      .encrypt();
    await (
      await lending.connect(alice).deposit(depEnc.handles[0], depEnc.inputProof)
    ).wait();

    // Borrow 400 (within 50% LTV = 500 max)
    const borEnc = await fhevm
      .createEncryptedInput(lendingAddress, alice.address)
      .add64(400)
      .encrypt();
    await (
      await lending.connect(alice).borrow(borEnc.handles[0], borEnc.inputProof)
    ).wait();

    const encDebt = await lending.getDebt(alice.address);
    const debt = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      encDebt,
      lendingAddress,
      alice,
    );
    expect(debt).to.eq(400);
  });

  it("should repay debt", async function () {
    const { token, tokenAddress, lending, lendingAddress, alice } = await deployFixture();

    // Mint, deposit, borrow
    const mintEnc = await fhevm
      .createEncryptedInput(tokenAddress, alice.address)
      .add64(1000)
      .encrypt();
    await (
      await token.connect(alice).mint(alice.address, mintEnc.handles[0], mintEnc.inputProof)
    ).wait();

    const depEnc = await fhevm
      .createEncryptedInput(lendingAddress, alice.address)
      .add64(1000)
      .encrypt();
    await (
      await lending.connect(alice).deposit(depEnc.handles[0], depEnc.inputProof)
    ).wait();

    const borEnc = await fhevm
      .createEncryptedInput(lendingAddress, alice.address)
      .add64(300)
      .encrypt();
    await (
      await lending.connect(alice).borrow(borEnc.handles[0], borEnc.inputProof)
    ).wait();

    // Repay 200
    const repEnc = await fhevm
      .createEncryptedInput(lendingAddress, alice.address)
      .add64(200)
      .encrypt();
    await (
      await lending.connect(alice).repay(repEnc.handles[0], repEnc.inputProof)
    ).wait();

    const encDebt = await lending.getDebt(alice.address);
    const debt = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      encDebt,
      lendingAddress,
      alice,
    );
    expect(debt).to.eq(100);
  });
});
