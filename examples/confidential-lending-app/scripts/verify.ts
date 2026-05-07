import { run } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  // Load deployment info
  const network = process.env.HARDHAT_NETWORK || "sepolia";
  const deploymentPath = path.join(__dirname, "..", "deployments", `${network}.json`);

  if (!fs.existsSync(deploymentPath)) {
    console.error(`No deployment file found at ${deploymentPath}`);
    console.error("Run deploy.ts first: npx hardhat run scripts/deploy.ts --network " + network);
    process.exit(1);
  }

  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  console.log(`Verifying contracts on ${network}...`);
  console.log(`MockCUSDT: ${deployment.contracts.MockCUSDT}`);
  console.log(`ConfidentialLending: ${deployment.contracts.ConfidentialLending}`);

  // Verify MockCUSDT (no constructor args)
  try {
    console.log("\nVerifying MockCUSDT...");
    await run("verify:verify", {
      address: deployment.contracts.MockCUSDT,
      constructorArguments: [],
    });
    console.log("MockCUSDT verified!");
  } catch (err: any) {
    if (err.message.includes("Already Verified")) {
      console.log("MockCUSDT already verified.");
    } else {
      console.error("MockCUSDT verification failed:", err.message);
    }
  }

  // Verify ConfidentialLending (constructor takes token address)
  try {
    console.log("\nVerifying ConfidentialLending...");
    await run("verify:verify", {
      address: deployment.contracts.ConfidentialLending,
      constructorArguments: [deployment.contracts.MockCUSDT],
    });
    console.log("ConfidentialLending verified!");
  } catch (err: any) {
    if (err.message.includes("Already Verified")) {
      console.log("ConfidentialLending already verified.");
    } else {
      console.error("ConfidentialLending verification failed:", err.message);
    }
  }

  console.log("\nDone. Check Etherscan:");
  console.log(`  https://sepolia.etherscan.io/address/${deployment.contracts.MockCUSDT}`);
  console.log(`  https://sepolia.etherscan.io/address/${deployment.contracts.ConfidentialLending}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
