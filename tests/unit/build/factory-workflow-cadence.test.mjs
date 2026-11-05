import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as yaml from "js-yaml";

const workflowsDir = new URL("../../../.github/workflows/", import.meta.url);

function loadWorkflow(file) {
  return yaml.load(fs.readFileSync(new URL(file, workflowsDir), "utf8"));
}

const releaseGreen = loadWorkflow("nightly-release-green.yml");
const compat = loadWorkflow("nightly-compat.yml");

test("Release-Green schedules one daily full sweep at 05:23 UTC", () => {
  assert.deepEqual(releaseGreen.on.schedule, [{ cron: "23 5 * * *" }]);
});

test("Node compatibility schedules one weekly sweep on Sunday at 06:47 UTC", () => {
  assert.deepEqual(compat.on.schedule, [{ cron: "47 6 * * 0" }]);
});

test("Release-Green keeps its optional manual branch override", () => {
  assert.deepEqual(releaseGreen.on.workflow_dispatch.inputs, {
    branch: {
      description: "Release branch to validate (default: highest release/vX.Y.Z)",
      required: false,
      type: "string",
    },
  });
});

test("Node compatibility keeps its optional manual branch override", () => {
  assert.deepEqual(compat.on.workflow_dispatch.inputs, {
    branch: {
      description: "Branch to validate (default: highest release/vX.Y.Z)",
      required: false,
      type: "string",
    },
  });
});

test("Release-Green keeps its code-change push branches and path filters", () => {
  assert.deepEqual(releaseGreen.on.push, {
    branches: ["release/v*", "main"],
    paths: [
      "src/**",
      "open-sse/**",
      "bin/**",
      "electron/**",
      "scripts/**",
      "tests/**",
      "config/**",
      "package.json",
      "package-lock.json",
      "tsconfig*.json",
    ],
  });
});

test("Node compatibility keeps all eight Node 24/26 test shards with fail-fast off", () => {
  assert.deepEqual(compat.jobs["compat-tests"].strategy, {
    "fail-fast": false,
    matrix: { node: [24, 26], shard: [1, 2, 3, 4] },
  });
  assert.ok(
    compat.jobs["compat-tests"].steps.some((step) => step.run === "npm run test:unit:ci:shard")
  );
});

test("Node compatibility keeps the Node 26 production build and webpack fallback", () => {
  const steps = compat.jobs["compat-build-26"].steps;
  const setup = steps.find((step) => step.uses?.startsWith("actions/setup-node@"));
  assert.deepEqual(setup?.with, { "node-version": "26", cache: "npm" });
  const build = steps.find((step) => step.run === "npm run build");
  assert.ok(build);
  assert.equal(build.env.OMNIROUTE_USE_TURBOPACK, "0");
});

test("scheduled workflow names stay stable for existing tracking and references", () => {
  assert.equal(releaseGreen.name, "Release-Green (continuous)");
  assert.equal(compat.name, "Nightly Node Compat");
});
