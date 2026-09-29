import { FREE_MODELS, runOpenCodePrompt } from "../../factory/opencode-worker.mjs";
const args = process.argv.slice(2);
if (args[0] !== "--public" || !args[1] || !args[2]) {
  console.error(
    "Usage: node scripts/cli/factory-free-worker.mjs --public <model> <non-sensitive prompt>"
  );
  console.error("Models: " + FREE_MODELS.join(", "));
  process.exit(2);
}
const model = args[1];
const prompt = args.slice(2).join(" ");
try {
  const result = await runOpenCodePrompt(prompt, { model, classification: "public" });
  console.log(result.output);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
