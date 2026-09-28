import assert from "node:assert/strict";
import test from "node:test";
import { providerAllowsOptionalApiKey } from "../../src/shared/constants/providers.ts";
import { createProviderSchema } from "../../src/shared/validation/schemas/provider.ts";

test("OVHcloud anonymous connection is accepted when registry auth is optional", () => {
  assert.equal(providerAllowsOptionalApiKey("ovhcloud"), true);
  const parsed = createProviderSchema.safeParse({ provider: "ovhcloud", name: "ovh-anonymous" });
  assert.equal(parsed.success, true);
});
