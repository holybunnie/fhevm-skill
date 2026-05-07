import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");

  // Deploy MockCUSDT
  console.log("\nDeploying MockCUSDT...");
  const tokenFactory = await ethers.getContractFactory("MockCUSDT");
  const token = await tokenFactory.deploy();
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();
  console.log("MockCUSDT deployed to:", tokenAddress);

  // Deploy ConfidentialLending
  console.log("\nDeploying ConfidentialLending...");
  const lendingFactory = await ethers.getContractFactory("ConfidentialLending");
  const lending = await lendingFactory.deploy(tokenAddress);
  await lending.waitForDeployment();
  const lendingAddress = await lending.getAddress();
  console.log("ConfidentialLending deployed to:", lendingAddress);

  // Write deployment addresses to file
  const deployment = {
    network: (await ethers.provider.getNetwork()).name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      MockCUSDT: tokenAddress,
      ConfidentialLending: lendingAddress,
    },
  };

  const outputDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${deployment.network}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(deployment, null, 2));
  console.log(`\nDeployment saved to: ${outputPath}`);

  console.log("\n--- Summary ---");
  console.log(`MockCUSDT:           ${tokenAddress}`);
  console.log(`ConfidentialLending:  ${lendingAddress}`);
  console.log(`Network:             ${deployment.network} (chainId: ${deployment.chainId})`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
