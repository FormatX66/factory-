import { summarizeEvidence } from "./src/health.mjs";
console.log(JSON.stringify(summarizeEvidence(process.argv.slice(2))));
