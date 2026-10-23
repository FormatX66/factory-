import test from "node:test";
import assert from "node:assert/strict";
import {
  decideStepContinuation,
  type DurableRunStepRecord,
} from "../../src/lib/factoryReliability/contracts.ts";

function step(overrides: Partial<DurableRunStepRecord> = {}): DurableRunStepRecord {
  return {
    operationId: "op-1",
    stepId: "step-1",
    stepVersion: "1",
    state: "pending",
    inputHash: "input-a",
    implementationHash: "impl-a",
    attempt: 1,
    sideEffectState: "none",
    verificationRef: null,
    changedBasis: null,
    lkgRef: "release/v3.8.51",
    ...overrides,
  };
}

test("completed durable steps are not replayed", () => {
  assert.equal(
    decideStepContinuation(step({ state: "succeeded", sideEffectState: "confirmed" })),
    "skip_completed"
  );
});

test("uncertain external side effects hold instead of replaying", () => {
  assert.equal(
    decideStepContinuation(step({ state: "running", sideEffectState: "uncertain" })),
    "hold_uncertain_side_effect"
  );
});

test("failed steps require a materially changed retry basis", () => {
  assert.equal(decideStepContinuation(step({ state: "failed" })), "hold_retry_requires_change");
  assert.equal(
    decideStepContinuation(step({ state: "failed", changedBasis: "changed implementation" })),
    "retry_changed_basis"
  );
});

test("explicit HOLD remains held", () => {
  assert.equal(
    decideStepContinuation(step({ state: "hold", changedBasis: "new idea" })),
    "remain_hold"
  );
});

test("new or safely resumable work may run", () => {
  assert.equal(decideStepContinuation(step()), "run");
  assert.equal(
    decideStepContinuation(step({ state: "running", sideEffectState: "confirmed" })),
    "run"
  );
});
