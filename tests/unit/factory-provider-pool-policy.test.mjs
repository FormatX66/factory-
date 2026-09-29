import assert from "node:assert/strict";
import test from "node:test";
import { FAILURE, classifyProviderFailure, eligiblePool, quotaIdentity, rankPool } from "../../factory/provider-pool-policy.mjs";
test("Cloudflare daily exhaustion differs from temporary capacity", () => {
 assert.equal(classifyProviderFailure({status:429,code:3036}).type, FAILURE.DAILY_EXHAUSTED);
 assert.equal(classifyProviderFailure({status:429,code:3040}).type, FAILURE.CAPACITY_BUSY);
});
test("generic 429 cools a connection, not the whole provider", () => {
 assert.deepEqual(classifyProviderFailure({status:429,retryAfter:60}), {type:FAILURE.RATE_LIMITED,scope:"connection",retryAfter:60});
});
test("provider failures use provider scope", () => {
 assert.equal(classifyProviderFailure({status:503}).scope, "provider");
});
test("auth and model failures stay narrow", () => {
 assert.equal(classifyProviderFailure({status:401}).scope, "connection");
 assert.equal(classifyProviderFailure({status:404}).scope, "model");
});
test("shared quota identity is not multiplied by model aliases", () => {
 assert.equal(quotaIdentity({provider:"opencode",quotaGroup:"opencode-free"}), "opencode-free");
 assert.equal(quotaIdentity({provider:"groq"}), "groq");
});
test("eligibility filters health, classification, capability and tier before ranking", () => {
 const workers=[
  {id:"private",provider:"p",healthy:true,tier:0,reasoning:true,dataClasses:["private"],headroom:1},
  {id:"free-a",provider:"a",healthy:true,tier:1,reasoning:true,dataClasses:["public"],headroom:.8,latencyMs:300},
  {id:"free-b",provider:"b",healthy:true,tier:1,reasoning:true,dataClasses:["public"],headroom:.9,latencyMs:500},
  {id:"held",provider:"c",healthy:true,held:true,tier:0,reasoning:true,dataClasses:["public"],headroom:1},
 ];
 const needs={classification:"public",capabilities:["reasoning"],maxTier:1};
 assert.deepEqual(eligiblePool(workers,needs).map(x=>x.id),["free-a","free-b"]);
 assert.deepEqual(rankPool(workers,needs).map(x=>x.id),["free-b","free-a"]);
});
test("retired providers never become eligible", () => {
 assert.equal(eligiblePool([{id:"github-models",provider:"github-models",state:"retired",healthy:true,tier:0}],{}).length,0);
});
