// Fails loud when Node is older than DeepSeek Harness requires (>=24 on this project).
const [major] = process.versions.node.split('.').map(Number);
if (major < 24) {
  console.error(`HimaHarness needs Node 24 or newer for DeepSeek Harness; found ${process.version}. On this machine: export PATH="$HOME/.local/node24/bin:$PATH"`);
  process.exit(1);
}
