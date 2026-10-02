/**
 * Factory Capability & Reliability Layer — Phase 0 contracts.
 *
 * Pure contracts only: importing this module must not start workers, access the
 * network, mutate persistence, or change routing behavior.
 */

export type RunStepState = "pending" | "running" | "succeeded" | "failed" | "hold";
export type SideEffectState = "none" | "confirmed" | "uncertain";

export interface DurableRunStepRecord {
  operationId: string;
  stepId: string;
  stepVersion: string;
  state: RunStepState;
  inputHash: string;
  implementationHash: string;
  attempt: number;
  sideEffectState: SideEffectState;
  verificationRef?: string | null;
  changedBasis?: string | null;
  lkgRef: string;
}

export type StepContinuationDecision =
  | "run"
  | "skip_completed"
  | "hold_uncertain_side_effect"
  | "hold_retry_requires_change"
  | "retry_changed_basis"
  | "remain_hold";

/**
 * Decide whether a durable step may execute again.
 *
 * The important safety properties are:
 * - completed steps are not replayed;
 * - uncertain external side effects are held for reconciliation;
 * - a failed step cannot be blindly retried without a changed basis.
 */
export function decideStepContinuation(step: DurableRunStepRecord): StepContinuationDecision {
  if (step.state === "succeeded") return "skip_completed";
  if (step.state === "hold") return "remain_hold";
  if (step.sideEffectState === "uncertain") return "hold_uncertain_side_effect";

  if (step.state === "failed") {
    if (!step.changedBasis?.trim()) return "hold_retry_requires_change";
    return "retry_changed_basis";
  }

  return "run";
}

export interface SandboxExecutionPolicy {
  workspaceRoots: string[];
  allowedNetworkTargets: string[];
  maxWallClockMs: number;
  modelCanReadInjectedSecrets: false;
  allowHostMutation: false;
}

export interface ExecutionReceipt {
  operationId: string;
  stepId: string;
  inputHash: string;
  implementationHash: string;
  resultHash: string | null;
  verificationRef: string | null;
  lkgRef: string;
  recoveryState: "not_needed" | "ready" | "used" | "hold";
}

export interface CapabilityCandidate {
  candidateId: string;
  source: string;
  version: string;
  provenanceRefs: string[];
  requestedPermissions: string[];
  termsEvidenceRef: string | null;
}

export interface AdmissionReceipt {
  candidateId: string;
  decision: "approved" | "quarantined" | "rejected";
  provenanceChecked: boolean;
  securityScanned: boolean;
  sandboxTested: boolean;
  permissionDiffReviewed: boolean;
  regressionChecked: boolean;
  evidenceRefs: string[];
}

export interface RecoveryManifest {
  schema: "factory.recovery-manifest.v1";
  factoryRevision: string;
  lkgRef: string;
  approvedCapabilityDigest: string;
  outstandingOperationIds: string[];
  receiptRefs: string[];
  providerHealthSnapshotRef: string | null;
  containsSecrets: false;
}
