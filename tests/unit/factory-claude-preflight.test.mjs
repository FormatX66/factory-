import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  classifyAuthStatus,
  classifyExecutable,
  classifyPlatform,
  classifyRoute,
  classifyRuntime,
  classifyWorktree,
  collectPreflight,
} from "../../scripts/ops/factory-claude-preflight.mjs";

const ENGINES = ">=22.22.2 <23 || >=24.0.0 <27";
const SCRIPT = fileURLToPath(
  new URL("../../scripts/ops/factory-claude-preflight.mjs", import.meta.url)
);
const HEAD = "1".repeat(40);
const gitObservation = {
  root: "/repo/.claude/worktrees/worker",
  gitDir: "/repo/.git/worktrees/worker",
  commonDir: "/repo/.git",
  branch: "feat/worker",
  head: HEAD,
  status: "",
  platform: "linux",
};

test("Node engine boundary and unsupported major versions are classified from package range", () => {
  for (const value of ["22.22.2", "22.23.0", "24.0.0", "26.99.99"]) {
    assert.equal(classifyRuntime({ version: value, engines: ENGINES }).status, "supported");
  }
  for (const value of ["22.22.1", "23.0.0", "20.0.0", "27.0.0"]) {
    assert.equal(classifyRuntime({ version: value, engines: ENGINES }).status, "unsupported");
  }
});

test("unknown runtime syntax and malformed values cannot appear supported", () => {
  for (const input of [
    null,
    {},
    { version: "24.0.0", engines: "*" },
    { version: "24.0.0-beta", engines: ENGINES },
    { version: "24.0.0", engines: "credential-secret" },
  ]) {
    const result = classifyRuntime(input);
    assert.equal(result.status, "unknown");
    assert.ok(!JSON.stringify(result).includes("credential-secret"));
  }
});

test("environment route stays unknown without an explicit setting", () => {
  assert.equal(classifyRoute({}).kind, "unknown");
  assert.equal(classifyRoute({ ANTHROPIC_BASE_URL: "https://api.anthropic.com" }).kind, "direct");
  assert.equal(
    classifyRoute({ ANTHROPIC_BASE_URL: "https://api.anthropic.com:443/" }).kind,
    "direct"
  );
});

test("route lookalikes, credentials and custom gateways never become direct or leak", () => {
  for (const url of [
    "https://api.anthropic.com.evil.invalid",
    "http://api.anthropic.com",
    "https://api.anthropic.com/v1",
    "https://secret-user:secret-password@api.anthropic.com",
    "https://api.anthropic.com/?token=secret-value",
    "http://127.0.0.1:20128",
  ]) {
    const result = classifyRoute({ ANTHROPIC_BASE_URL: url });
    assert.equal(result.kind, "custom-gateway");
    assert.ok(!JSON.stringify(result).includes(url));
    assert.ok(!JSON.stringify(result).includes("secret"));
  }
  assert.equal(classifyRoute({ ANTHROPIC_BASE_URL: "not-a-url-secret" }).kind, "unknown");
  assert.equal(classifyRoute({ ANTHROPIC_BASE_URL: "file:///secret" }).kind, "unknown");
});

test("alternate-provider flags override an otherwise direct-looking environment", () => {
  assert.equal(
    classifyRoute({ ANTHROPIC_BASE_URL: "https://api.anthropic.com", CLAUDE_CODE_USE_BEDROCK: "1" })
      .kind,
    "custom-gateway"
  );
  assert.equal(classifyRoute({ ANTHROPIC_BASE_URL: 123 }).kind, "unknown");
});

test("auth classification retains only method and reported login, never account data", () => {
  for (const method of ["claude.ai", "oauth_token", "api_key", "api_key_helper", "third_party"]) {
    const result = classifyAuthStatus({
      exitCode: 0,
      stdout: JSON.stringify({
        loggedIn: true,
        authMethod: method,
        email: "private@example.invalid",
        orgId: "secret-org",
        apiKey: "secret-key",
      }),
    });
    assert.deepEqual(result, { status: "login_observed", method, subscription: "unverified" });
    assert.ok(!JSON.stringify(result).includes("private"));
    assert.ok(!JSON.stringify(result).includes("secret"));
  }
});

test("false login and inconsistent auth results remain unverified", () => {
  assert.equal(
    classifyAuthStatus({ exitCode: 1, stdout: '{"loggedIn":false,"authMethod":"none"}' }).status,
    "not_logged_in"
  );
  for (const input of [
    { exitCode: 1, stdout: '{"loggedIn":true,"authMethod":"claude.ai"}' },
    { exitCode: 0, stdout: '{"loggedIn":true,"authMethod":"none"}' },
    { exitCode: 0, stdout: '{"loggedIn":false,"authMethod":"api_key"}' },
    { exitCode: 0, stdout: '{"loggedIn":true,"authMethod":"new_unknown_method"}' },
    { exitCode: 0, stdout: '{"loggedIn":"true","authMethod":"claude.ai"}' },
    { exitCode: null, stdout: "" },
    { exitCode: 0, stdout: "secret-invalid-json" },
    { exitCode: 0, stdout: "x".repeat(65537) },
  ])
    assert.equal(classifyAuthStatus(input).status, "unknown");
});

test("platform observations do not claim an active sandbox or verified host", () => {
  assert.deepEqual(
    classifyPlatform({ platform: "win32", release: "10.0", wslEnvironmentPresent: false }),
    { kind: "nativeWindows", sandbox: "unavailable_native_windows" }
  );
  assert.deepEqual(
    classifyPlatform({
      platform: "linux",
      release: "6.1-microsoft-standard-WSL2",
      wslEnvironmentPresent: false,
    }),
    { kind: "wsl", sandbox: "unverified" }
  );
  assert.deepEqual(
    classifyPlatform({ platform: "linux", release: "6.1", wslEnvironmentPresent: true }),
    { kind: "wsl", sandbox: "unverified" }
  );
  assert.equal(classifyPlatform({}).kind, "unknown");
});

test("Windows command wrappers are held instead of launched through a shell", () => {
  for (const filename of [
    "C:\\tools\\claude.cmd",
    "C:\\tools\\claude.BAT",
    "C:\\tools\\claude.ps1",
  ]) {
    assert.equal(
      classifyExecutable({ platform: "win32", filename, isFile: true, executable: true }),
      "unsupported_windows_wrapper"
    );
  }
  assert.equal(
    classifyExecutable({
      platform: "win32",
      filename: "C:\\tools\\claude.exe",
      isFile: true,
      executable: true,
    }),
    "available"
  );
  assert.equal(
    classifyExecutable({
      platform: "linux",
      filename: "/bin/claude",
      isFile: true,
      executable: false,
    }),
    "unavailable"
  );
});

test("only linked canonical worktrees with valid HEAD and a dedicated branch qualify", () => {
  assert.equal(classifyWorktree(gitObservation).status, "isolated");
  for (const change of [
    { root: "/repo" },
    { root: "/repo/.worktrees/worker" },
    { root: "/repo/.claude/worktrees/worker/nested" },
    { gitDir: "/repo/.git" },
    { gitDir: "/elsewhere/.git/worktrees/worker" },
    { branch: "main" },
    { branch: "HEAD" },
    { branch: "" },
    { head: "not-a-commit" },
  ])
    assert.notEqual(classifyWorktree({ ...gitObservation, ...change }).status, "isolated");
  assert.equal(classifyWorktree(null).status, "unknown");
});

test("dirty worktree observations retain no file names", () => {
  const result = classifyWorktree({ ...gitObservation, status: "?? secret-account-file\0" });
  assert.equal(result.clean, false);
  assert.ok(!JSON.stringify(result).includes("secret-account-file"));
});

test("Windows canonical worktree paths are classified with Windows path semantics", () => {
  assert.equal(
    classifyWorktree({
      ...gitObservation,
      root: "C:\\repo\\.claude\\worktrees\\worker",
      gitDir: "C:\\repo\\.git\\worktrees\\worker",
      commonDir: "C:\\repo\\.git",
      platform: "win32",
    }).status,
    "isolated"
  );
});

function run(executable, args, cwd, env = process.env) {
  const result = spawnSync(executable, args, {
    cwd,
    env,
    shell: false,
    encoding: "utf8",
    timeout: 10000,
    maxBuffer: 256 * 1024,
  });
  assert.equal(result.error, undefined, "subprocess execution must actually be permitted");
  assert.equal(result.status, 0, "fixture command must complete successfully");
  return result.stdout;
}

function fixtureHooks(root) {
  const directory = path.join(root, ".husky");
  fs.mkdirSync(path.join(directory, "_"), { recursive: true });
  fs.writeFileSync(
    path.join(directory, "_", "h"),
    '#!/bin/sh\nn=$(basename "$0")\ns=$(dirname "$(dirname "$0")")/$n\n[ ! -f "$s" ] && exit 0\nsh -e "$s" "$@"\n'
  );
  for (const name of ["pre-commit", "commit-msg", "pre-push"]) {
    fs.writeFileSync(path.join(directory, name), "#!/bin/sh\nexit 0\n");
    fs.writeFileSync(path.join(directory, "_", name), '#!/bin/sh\n. "$(dirname "$0")/h"\n', {
      mode: 0o755,
    });
  }
}

function fixture(
  t,
  {
    auth = { loggedIn: true, authMethod: "claude.ai", email: "secret-private@example.invalid" },
    cli = true,
  } = {}
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-preflight-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const main = path.join(dir, "repository");
  const bin = path.join(dir, "bin");
  fs.mkdirSync(main);
  fs.mkdirSync(bin);
  run("git", ["init", "-b", "fixture-base"], main);
  run("git", ["config", "user.name", "Preflight Fixture"], main);
  run("git", ["config", "user.email", "fixture@example.invalid"], main);
  run("git", ["config", "core.hooksPath", ".husky/_"], main);
  fs.writeFileSync(path.join(main, "package.json"), JSON.stringify({ engines: { node: ENGINES } }));
  fs.writeFileSync(path.join(main, ".gitignore"), "node_modules/\n.claude/worktrees/\n.husky/_/\n");
  fixtureHooks(main);
  run(
    "git",
    [
      "add",
      "package.json",
      ".gitignore",
      ".husky/pre-commit",
      ".husky/commit-msg",
      ".husky/pre-push",
    ],
    main
  );
  run("git", ["commit", "-m", "test: initialize preflight fixture"], main);
  const cwd = path.join(main, ".claude", "worktrees", "worker");
  run("git", ["worktree", "add", cwd, "-b", "feat/fixture"], main);
  fs.mkdirSync(path.join(cwd, "node_modules"));
  fixtureHooks(cwd);
  if (cli) {
    fs.writeFileSync(
      path.join(bin, "claude"),
      `#!${process.execPath}\nconst args = process.argv.slice(2);\nif (args.join(" ") === "--version") console.log("2.1.283 (Claude Code)");\nelse if (args.join(" ") === "auth status") console.log(${JSON.stringify(JSON.stringify(auth))});\nelse process.exit(97);\n`,
      { mode: 0o755 }
    );
  }
  const env = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    ANTHROPIC_BASE_URL: "https://api.anthropic.com",
  };
  delete env.HUSKY;
  return { dir, main, cwd, bin, env };
}

test("CLI integration emits real sanitized JSON from a temporary Git worktree", (t) => {
  const item = fixture(t);
  assert.deepEqual(collectPreflight({ cwd: item.cwd, env: item.env }).holds, []);
  const before = run("git", ["status", "--porcelain=v1", "-z"], item.cwd);
  const child = spawnSync(process.execPath, [SCRIPT], {
    cwd: item.cwd,
    env: item.env,
    shell: false,
    encoding: "utf8",
    timeout: 10000,
    maxBuffer: 256 * 1024,
  });
  assert.equal(child.error, undefined);
  const output = child.stdout;
  assert.ok(output.length > 0, "empty captured output is not verification");
  const report = JSON.parse(output);
  assert.deepEqual(report.holds, []);
  assert.equal(child.status, 0);
  assert.equal(report.schema, "factory.claude-preflight.v1");
  assert.equal(report.decision, "local_prerequisites_observed");
  assert.equal(report.repository.canonicalWorktree, true);
  assert.equal(report.localFiles.hooks.observed, true);
  assert.equal(report.claude.version, "2.1.283");
  assert.equal(report.claude.auth.method, "claude.ai");
  assert.equal(report.remoteControl, "unverified");
  assert.equal(report.managedSettings, "unknown_not_inspected");
  assert.equal(report.hostIdentityVerified, false);
  assert.equal(report.providerProbePerformed, false);
  assert.ok(!output.includes("secret-private"));
  assert.ok(!output.includes("api.anthropic.com"));
  assert.equal(run("git", ["status", "--porcelain=v1", "-z"], item.cwd), before);
});

test("missing CLI, dirty files, absent hooks and linked dependencies each produce a hold", (t) => {
  const item = fixture(t, { cli: false });
  // Keep only the actual Git executable accessible, preventing an installed Claude from masking absence.
  const gitPath = run("git", ["--exec-path"], item.cwd).trim();
  assert.ok(gitPath.length > 0);
  const candidate = ["/usr/bin/git", "/usr/local/bin/git"].find((file) => fs.existsSync(file));
  assert.ok(candidate, "fixture needs an absolute Git executable");
  fs.symlinkSync(candidate, path.join(item.bin, "git"));
  const env = { ...item.env, PATH: item.bin };
  let report = collectPreflight({ cwd: item.cwd, env });
  assert.equal(report.claude.executable, "missing");
  assert.ok(report.holds.includes("claude_cli_unverified"));
  fs.writeFileSync(path.join(item.cwd, "dirty.txt"), "fixture");
  fs.unlinkSync(path.join(item.cwd, ".husky", "_", "pre-commit"));
  fs.rmdirSync(path.join(item.cwd, "node_modules"));
  fs.symlinkSync(item.bin, path.join(item.cwd, "node_modules"));
  report = collectPreflight({ cwd: item.cwd, env });
  assert.ok(report.holds.includes("worktree_dirty_or_unknown"));
  assert.ok(report.holds.includes("hooks_unverified_or_disabled"));
  assert.ok(report.holds.includes("dependencies_missing_or_linked"));
});

test("noncanonical checkout and HUSKY=0 never pass local prerequisites", (t) => {
  const item = fixture(t);
  assert.ok(
    collectPreflight({ cwd: item.main, env: item.env }).holds.includes(
      "canonical_worktree_unverified"
    )
  );
  assert.ok(
    collectPreflight({ cwd: item.cwd, env: { ...item.env, HUSKY: "0" } }).holds.includes(
      "hooks_unverified_or_disabled"
    )
  );
});

test("failed or malformed Claude auth output cannot be treated as logged in", (t) => {
  const item = fixture(t);
  fs.writeFileSync(
    path.join(item.bin, "claude"),
    `#!${process.execPath}\nif (process.argv[2] === "--version") console.log("2.1.283 (Claude Code)"); else { console.error("secret-stderr"); console.log("secret-bad-json"); process.exitCode = 1; }\n`,
    { mode: 0o755 }
  );
  const report = collectPreflight({ cwd: item.cwd, env: item.env });
  assert.equal(report.claude.auth.status, "unknown");
  assert.ok(report.holds.includes("claude_auth_unverified"));
  assert.ok(!JSON.stringify(report).includes("secret"));
});

test("malformed package runtime and invalid API inputs fail closed", (t) => {
  const item = fixture(t);
  fs.writeFileSync(path.join(item.cwd, "package.json"), '{"engines":{"node":"*"}}');
  assert.ok(
    collectPreflight({ cwd: item.cwd, env: item.env }).holds.includes("unsupported_or_unknown_node")
  );
  assert.equal(collectPreflight({ cwd: 42 }).decision, "hold");
  assert.equal(collectPreflight({ unexpected: "ignored-no-longer" }).decision, "hold");
});

test("subprocess output budget and timeout hold without returning child output", (t) => {
  const item = fixture(t);
  fs.writeFileSync(
    path.join(item.bin, "claude"),
    `#!${process.execPath}\nprocess.stdout.write("secret-output".repeat(65536));\n`,
    { mode: 0o755 }
  );
  let report = collectPreflight({ cwd: item.cwd, env: item.env });
  assert.equal(report.claude.version, null);
  assert.ok(!JSON.stringify(report).includes("secret-output"));
  fs.writeFileSync(
    path.join(item.bin, "claude"),
    `#!${process.execPath}\nsetInterval(() => {}, 10000);\n`,
    { mode: 0o755 }
  );
  const start = Date.now();
  report = collectPreflight({ cwd: item.cwd, env: item.env });
  assert.equal(report.claude.version, null);
  assert.ok(Date.now() - start < 10000, "preflight must terminate an unresponsive CLI");
});

test("Git environment overrides cannot substitute a different clean repository", (t) => {
  const actual = fixture(t);
  const alternate = fixture(t);
  fs.writeFileSync(path.join(actual.cwd, "dirty.txt"), "actual worktree is dirty");
  const alternateGitDir = run("git", ["rev-parse", "--absolute-git-dir"], alternate.cwd).trim();
  const env = {
    ...actual.env,
    GIT_DIR: alternateGitDir,
    GIT_WORK_TREE: alternate.cwd,
    GIT_INDEX_FILE: path.join(alternateGitDir, "index"),
  };
  const report = collectPreflight({ cwd: actual.cwd, env });
  assert.equal(report.repository.canonicalWorktree, true);
  assert.equal(report.repository.clean, false);
  assert.ok(report.holds.includes("worktree_dirty_or_unknown"));
  // An unrelated directory cannot borrow another repository through the same overrides.
  assert.notEqual(collectPreflight({ cwd: actual.bin, env }).repository.status, "isolated");
});

test("Git config environment overrides cannot alter observed hook configuration", (t) => {
  const item = fixture(t);
  const env = {
    ...item.env,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "core.hooksPath",
    GIT_CONFIG_VALUE_0: "/fixture-disabled-hooks",
    GIT_CONFIG_PARAMETERS: "'core.hooksPath=/fixture-disabled-hooks'",
    GIT_CONFIG_GLOBAL: "/missing-fixture-config",
    GIT_CONFIG_SYSTEM: "/missing-fixture-config",
  };
  const report = collectPreflight({ cwd: item.cwd, env });
  assert.equal(report.localFiles.hooks.observed, true);
  assert.equal(report.localFiles.hooks.canonicalPath, true);
  assert.equal(report.decision, "local_prerequisites_observed");
});

test("Husky dispatcher, real hook scripts and canonical directories are all required", (t) => {
  const item = fixture(t);
  const dispatcher = path.join(item.cwd, ".husky", "_", "h");
  const dispatcherBytes = fs.readFileSync(dispatcher);
  fs.unlinkSync(dispatcher);
  assert.equal(collectPreflight({ cwd: item.cwd, env: item.env }).localFiles.hooks.observed, false);
  fs.writeFileSync(dispatcher, dispatcherBytes);
  for (const name of ["pre-commit", "commit-msg", "pre-push"]) {
    const script = path.join(item.cwd, ".husky", name);
    fs.unlinkSync(script);
    let report = collectPreflight({ cwd: item.cwd, env: item.env });
    assert.equal(report.localFiles.hooks.readableScripts[name], false);
    assert.ok(report.holds.includes("hooks_unverified_or_disabled"));
    fs.writeFileSync(script, "");
    report = collectPreflight({ cwd: item.cwd, env: item.env });
    assert.equal(report.localFiles.hooks.observed, false);
    fs.writeFileSync(script, "#!/bin/sh\nexit 0\n");
  }
  const externalDispatcher = path.join(item.dir, "dispatcher");
  fs.writeFileSync(externalDispatcher, dispatcherBytes);
  fs.unlinkSync(dispatcher);
  fs.symlinkSync(externalDispatcher, dispatcher);
  assert.equal(
    collectPreflight({ cwd: item.cwd, env: item.env }).localFiles.hooks.dispatcherPresent,
    false
  );
  fs.unlinkSync(dispatcher);
  fs.writeFileSync(dispatcher, dispatcherBytes);
  const hooks = path.join(item.cwd, ".husky", "_");
  const savedHooks = path.join(item.dir, "hooks");
  fs.renameSync(hooks, savedHooks);
  fs.symlinkSync(savedHooks, hooks);
  assert.equal(
    collectPreflight({ cwd: item.cwd, env: item.env }).localFiles.hooks.canonicalDirectories,
    false
  );
});
