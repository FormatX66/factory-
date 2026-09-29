# Factory compute expansions

Factory keeps the existing Codex and local Qwen workers and can discover an installed official OpenCode client at `~/FactoryTools/opencode/node_modules/opencode-ai/bin/opencode.exe`.

## Official OpenCode worker

The installed client is pinned to 1.18.33. The worker uses `opencode run`, not a forged browser/client identity or an unauthorized proxy. An actual OmniRoute canary received an explicit OpenCode-client-only restriction; that route remains rejected.

`observePool()` now includes a Space Bunny free-model probe when the client is present. Extra OpenCode models can be requested via `openCodeModels`. Model choices share provider/quota identity `opencode-free`; two models are not two independent providers.

All tools are denied. This worker returns text/proposals for Factory to review; it cannot edit source, execute commands, or authorize promotion. Its profile/data are isolated, inherited provider credentials are excluded, automatic sharing and updates are disabled, and only the explicit free-model allowlist is enabled. Prompt size, process time and output size are bounded.

Use only public or synthetic input. Some free/trial models may retain prompts, and offers can change. A missing client, error, nonzero/unknown reported cost, unexpected tool event or timeout is not a success.

```powershell
node scripts/cli/factory-free-worker.mjs --public opencode/space-bunny-free "Explain a JavaScript closure in two sentences."
```

Programmatic callers must pass `classification: "public"` or `"synthetic"` to `runOpenCodePrompt`/`runOpenCodeTask`. `chooseWorker` excludes these workers for private or unclassified tasks. Call `observePool({includeOpenCode: false})` to retain only the previous pool.

## Gateway inventory and local routing

Query the running server's `/api/providers` and read `connections`. The older CLI `providers list` reads its own local database and can report an unrelated empty list. Catalog IDs already containing `oc/` or `ollama/` must not receive another provider prefix.

The global OmniRoute `--base-url` targets the gateway, not the model server. Register Ollama with gateway `http://127.0.0.1:20130` and `providerSpecificData.baseUrl: "http://127.0.0.1:11434/v1"`. This operation added a new local connection without replacing the direct Ollama fallback.

The adapter now requires fresh successful canary evidence and an explicit cost tier; catalog metadata alone does not prove inference or tool execution. These expansions do not establish forced-outage recovery or unattended code promotion. No schedules or billing were enabled.

Provider requirements: https://opencode.ai/docs/zen/ — CLI: https://opencode.ai/docs/cli/ — permissions: https://opencode.ai/docs/permissions/
