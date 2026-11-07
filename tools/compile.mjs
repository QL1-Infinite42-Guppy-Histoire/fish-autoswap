// Compile FishAutoSwap.sol with solc and write contracts/build/FishAutoSwap.json
// (ABI + bytecode + metadata). Run from tools/:  node compile.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import solc from "solc";

const here = dirname(fileURLToPath(import.meta.url));
const srcPath = join(here, "..", "contracts", "FishAutoSwap.sol");
const source = readFileSync(srcPath, "utf8");

const input = {
  language: "Solidity",
  sources: { "FishAutoSwap.sol": { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { "*": { "*": ["abi", "evm.bytecode", "evm.deployedBytecode"] } },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (output.errors || []).filter((e) => e.severity === "error");
if (errors.length) {
  for (const e of errors) console.error(e.formattedMessage);
  process.exit(1);
}
for (const w of output.errors || []) {
  if (w.severity === "warning") console.warn("warning:", w.formattedMessage.split("\n")[0]);
}

const c = output.contracts["FishAutoSwap.sol"]["FishAutoSwap"];
const artifact = {
  contractName: "FishAutoSwap",
  compiler: solc.version(),
  abi: c.abi,
  bytecode: "0x" + c.evm.bytecode.object,
  deployedBytecode: "0x" + c.evm.deployedBytecode.object,
  sourceFile: "contracts/FishAutoSwap.sol",
};
const buildDir = join(here, "..", "contracts", "build");
mkdirSync(buildDir, { recursive: true });
writeFileSync(join(buildDir, "FishAutoSwap.json"), JSON.stringify(artifact, null, 2) + "\n");
const size = (artifact.bytecode.length - 2) / 2;
console.log(`compiled OK with solc ${solc.version()}`);
console.log(`bytecode size: ${size} bytes`);
if (size > 24576) console.error("WARNING: bytecode exceeds the 24,576 byte contract size limit");
