import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import {
  analyzeSubnet,
  containsIPv4,
  convertIPv4,
  fromDecimal,
  runCommand,
} from "../../scripts/ops/lissy93-network.mjs";
const root = new URL("../../", import.meta.url);
const base = new URL("factory/components/lissy93/", root);
const json = (file) => JSON.parse(readFileSync(new URL(file, base), "utf8"));

test("normal /24 subnet", () => {
  const s = analyzeSubnet("192.168.1.42/24");
  assert.equal(s.network, "192.168.1.0");
  assert.equal(s.broadcast, "192.168.1.255");
  assert.equal(s.netmask, "255.255.255.0");
  assert.equal(s.usableHosts, 254);
});
test("regression: /0 is the whole IPv4 space for any input", () => {
  const s = analyzeSubnet("192.168.1.42/0");
  assert.equal(s.network, "0.0.0.0");
  assert.equal(s.broadcast, "255.255.255.255");
  assert.equal(s.totalAddresses, 4294967296);
  assert.equal(s.usableHosts, 4294967294);
  assert.equal(s.firstHost, "0.0.0.1");
  assert.equal(s.lastHost, "255.255.255.254");
  assert.equal(containsIPv4("192.168.1.42", "10.0.0.1/0"), true);
});
test("/31 and /32 boundaries", () => {
  const s = analyzeSubnet("192.0.2.5/31");
  assert.equal(s.usableHosts, 2);
  assert.equal(s.firstHost, "192.0.2.4");
  assert.equal(s.lastHost, "192.0.2.5");
  const h = analyzeSubnet("255.255.255.255/32");
  assert.equal(h.usableHosts, 1);
  assert.equal(h.firstHost, h.lastHost);
});
test("membership and high-bit IPv4 addresses", () => {
  assert.equal(containsIPv4("192.168.2.1", "192.168.1.42/24"), false);
  assert.equal(containsIPv4("255.255.255.255", "128.0.0.1/1"), true);
  assert.equal(containsIPv4("127.255.255.255", "128.0.0.1/1"), false);
});
test("reject malformed and coercible CIDR input", () => {
  for (const value of [
    null,
    32,
    "",
    "1.2.3/24",
    "256.1.1.1/24",
    "01.2.3.4/24",
    "1.2.3.4/24junk",
    "1.2.3.4/24.5",
    "1.2.3.4/+24",
    "1.2.3.4/024",
    "1.2.3.4/33",
    "1.2.3.4/-1",
    " 1.2.3.4/24",
    "1.2.3.4/24\n",
    "::1/128",
    "1".repeat(10000),
  ]) {
    assert.throws(() => analyzeSubnet(value));
  }
});
test("conversion roundtrips and decimal bounds", () => {
  for (const ip of ["0.0.0.0", "127.0.0.1", "192.168.1.42", "255.255.255.255"]) {
    assert.equal(fromDecimal(Number(convertIPv4(ip).decimal)), ip);
  }
  for (const value of [-1, 4294967296, 1.5, NaN, Infinity, "1"])
    assert.throws(() => fromDecimal(value));
  for (const ip of ["01.2.3.4", "1.2.3.256", "::1", null]) assert.throws(() => convertIPv4(ip));
});
test("command arity and non-decimal coercion rejected", () => {
  assert.equal(runCommand(["from-decimal", "0"]).ip, "0.0.0.0");
  assert.equal(runCommand(["contains", "1.2.3.4", "0.0.0.0/0"]).contains, true);
  for (const args of [
    ["subnet", "1.2.3.4/24", "extra"],
    ["contains", "1.2.3.4"],
    ["from-decimal", "0x10"],
    ["from-decimal", "1e3"],
    ["from-decimal", ""],
    ["scan", "1.2.3.4"],
  ])
    assert.throws(() => runCommand(args));
});
test("CLI returns machine-readable success and clean failure", () => {
  const path = fileURLToPath(new URL("scripts/ops/lissy93-network.mjs", root));
  const good = spawnSync(process.execPath, [path, "subnet", "192.0.2.5/31"], { encoding: "utf8" });
  assert.equal(good.status, 0);
  assert.equal(JSON.parse(good.stdout).result.usableHosts, 2);
  const bad = spawnSync(process.execPath, [path, "subnet", "invalid"], { encoding: "utf8" });
  assert.equal(bad.status, 2);
  assert.equal(JSON.parse(bad.stderr).ok, false);
  assert.equal(bad.stderr.includes("at "), false);
});
test("pinned third-party bytes and licenses remain intact", () => {
  for (const component of json("provenance.json").components) {
    assert.match(component.commit, /^[a-f0-9]{40}$/);
    assert.ok(component.files.some((f) => f.upstream_path === "LICENSE"));
    for (const file of component.files) {
      const data = readFileSync(new URL(file.local_path, root));
      assert.equal(createHash("sha256").update(data).digest("hex"), file.sha256);
      assert.equal(
        createHash("sha1").update(`blob ${data.length}\0`).update(data).digest("hex"),
        file.git_blob
      );
      assert.equal(file.modified, false);
    }
  }
});
test("Dashy configuration validates against the pinned upstream schema", () => {
  const ajv = new Ajv({ strict: false, validateFormats: false });
  const validate = ajv.compile(json("vendor/dashy/src/utils/config/ConfigSchema.json"));
  assert.ok(validate(json("dashy/conf.yml")), JSON.stringify(validate.errors));
});
test("Dashy cannot silently enable polling or edit controls", () => {
  const config = json("dashy/conf.yml");
  for (const name of [
    "preventWriteToDisk",
    "preventLocalSave",
    "disableConfiguration",
    "disableUpdateChecks",
  ])
    assert.equal(config.appConfig[name], true);
  for (const name of [
    "statusCheck",
    "pingCheckEnabled",
    "enableErrorReporting",
    "enableServiceWorker",
    "allowConfigEdit",
  ])
    assert.equal(config.appConfig[name], false);
  for (const section of config.sections)
    for (const item of section.items) {
      const url = new URL(item.url);
      assert.equal(url.hostname, "127.0.0.1");
      assert.equal(url.username + url.password + url.search, "");
    }
});
