#!/usr/bin/env node
// Read-only local observations. This does not grant execution or verify Remote Control access.
import { z } from "zod";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MAX_OUTPUT = 64 * 1024;
const TIMEOUT_MS = 3000;
const text = z.string().max(MAX_OUTPUT);
const version = z.string().regex(/^v?\d{1,4}\.\d{1,4}\.\d{1,4}$/);
const envSchema = z.record(
  z.string().max(256),
  z
    .string()
    .max(128 * 1024)
    .optional()
);
const platformSchema = z.enum(["win32", "linux", "darwin", "other"]);
const authMethod = z.enum([
  "none",
  "claude.ai",
  "oauth_token",
  "api_key",
  "api_key_helper",
  "third_party",
]);

function triplet(value) {
  return value.replace(/^v/, "").split(".").map(Number);
}

function compare(a, b) {
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

export function classifyRuntime(input) {
  const parsed = z.object({ version, engines: z.string().max(256) }).safeParse(input);
  if (!parsed.success) return { status: "unknown", reason: "invalid_runtime_input" };
  const ranges = parsed.data.engines.split(" || ");
  const bounds = ranges.map((range) => /^>=(\d{1,4}\.\d{1,4}\.\d{1,4}) <(\d{1,4})$/.exec(range));
  // Fail closed for a newly changed engine expression instead of guessing semver semantics.
  if (!bounds.length || bounds.length > 8 || bounds.some((bound) => !bound)) {
    return { status: "unknown", reason: "unsupported_engine_expression" };
  }
  const current = triplet(parsed.data.version);
  const supported = bounds.some(
    (bound) => compare(current, triplet(bound[1])) >= 0 && current[0] < Number(bound[2])
  );
  return {
    status: supported ? "supported" : "unsupported",
    version: parsed.data.version,
    engines: parsed.data.engines,
  };
}

export function classifyRoute(input) {
  const parsed = envSchema.safeParse(input);
  if (!parsed.success) return { kind: "unknown", reason: "invalid_environment" };
  const env = parsed.data;
  const alternateProvider = [
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
    "CLAUDE_CODE_USE_FOUNDRY",
  ].some((name) => env[name] === "1" || env[name] === "true");
  if (alternateProvider) return { kind: "custom-gateway", reason: "alternate_provider_flag" };
  if (!env.ANTHROPIC_BASE_URL) {
    return { kind: "unknown", reason: "no_environment_override_settings_uninspected" };
  }
  try {
    const url = new URL(env.ANTHROPIC_BASE_URL);
    const direct =
      url.protocol === "https:" &&
      url.hostname === "api.anthropic.com" &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === "/";
    if (!["http:", "https:"].includes(url.protocol)) {
      return { kind: "unknown", reason: "invalid_route_scheme" };
    }
    return { kind: direct ? "direct" : "custom-gateway", reason: "environment_only" };
  } catch {
    return { kind: "unknown", reason: "invalid_route_url" };
  }
}

export function classifyAuthStatus(input) {
  const parsed = z.object({ stdout: text, exitCode: z.number().int().nullable() }).safeParse(input);
  const unknown = { status: "unknown", method: "unknown", subscription: "unverified" };
  if (!parsed.success || ![0, 1].includes(parsed.data.exitCode)) return unknown;
  try {
    // Only these fields are retained; emails, organization IDs and credentials are discarded.
    const result = z
      .object({ loggedIn: z.boolean(), authMethod })
      .safeParse(JSON.parse(parsed.data.stdout));
    if (!result.success) return unknown;
    const { loggedIn, authMethod: method } = result.data;
    if (loggedIn && (parsed.data.exitCode !== 0 || method === "none")) return unknown;
    if (!loggedIn && method !== "none") return unknown;
    return {
      status: loggedIn ? "login_observed" : "not_logged_in",
      method,
      subscription: "unverified",
    };
  } catch {
    return unknown;
  }
}

export function classifyPlatform(input) {
  const parsed = z
    .object({
      platform: platformSchema,
      release: z.string().max(1024),
      wslEnvironmentPresent: z.boolean(),
    })
    .safeParse(input);
  if (!parsed.success) return { kind: "unknown", sandbox: "unverified" };
  const { platform, release, wslEnvironmentPresent } = parsed.data;
  const wsl = platform === "linux" && (/microsoft|wsl/i.test(release) || wslEnvironmentPresent);
  return {
    kind: platform === "win32" ? "nativeWindows" : wsl ? "wsl" : platform,
    sandbox: platform === "win32" ? "unavailable_native_windows" : "unverified",
  };
}

export function classifyExecutable(input) {
  const parsed = z
    .object({
      platform: platformSchema,
      filename: text,
      isFile: z.boolean(),
      executable: z.boolean(),
    })
    .safeParse(input);
  if (!parsed.success || !parsed.data.isFile) return "unavailable";
  if (
    parsed.data.platform === "win32" &&
    path.win32.extname(parsed.data.filename).toLowerCase() !== ".exe"
  ) {
    return "unsupported_windows_wrapper";
  }
  return parsed.data.executable ? "available" : "unavailable";
}

export function classifyWorktree(input) {
  const parsed = z
    .object({
      root: text,
      gitDir: text,
      commonDir: text,
      branch: z.string().max(255),
      head: z.string().max(64),
      status: text,
      platform: platformSchema,
    })
    .safeParse(input);
  if (!parsed.success) return { status: "unknown", reason: "invalid_git_observation" };
  const p = parsed.data.platform === "win32" ? path.win32 : path.posix;
  const { root, gitDir, commonDir, branch, head } = parsed.data;
  const absolute = [root, gitDir, commonDir].every((value) => p.isAbsolute(value));
  const canonical = p.join(p.dirname(commonDir), ".claude", "worktrees");
  const isolated =
    absolute &&
    p.basename(commonDir) === ".git" &&
    gitDir !== commonDir &&
    p.dirname(root) === canonical &&
    p.dirname(gitDir) === p.join(commonDir, "worktrees");
  const headValid = /^[a-f0-9]{40}$|^[a-f0-9]{64}$/.test(head);
  const branchValid = /^[A-Za-z0-9._/-]{1,255}$/.test(branch);
  const dedicatedBranch = branchValid && !["main", "master", "HEAD"].includes(branch);
  return {
    status: isolated && headValid && dedicatedBranch ? "isolated" : "hold",
    canonicalWorktree: isolated,
    head: headValid ? head : null,
    branch: branchValid ? branch : null,
    dedicatedBranch,
    clean: parsed.data.status === "",
  };
}

function command(executable, args, cwd, env) {
  try {
    const result = spawnSync(executable, args, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      encoding: "utf8",
      timeout: TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT,
      killSignal: "SIGKILL",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.error || result.signal) {
      const reason =
        result.error?.code === "ETIMEDOUT"
          ? "timeout"
          : result.error?.code === "ENOBUFS"
            ? "output_limit"
            : "process_unavailable";
      return { ok: false, reason, exitCode: null, stdout: "" };
    }
    const output = text.safeParse(result.stdout);
    if (!output.success) return { ok: false, reason: "invalid_output", exitCode: null, stdout: "" };
    return { ok: result.status === 0, exitCode: result.status, stdout: output.data };
  } catch {
    return { ok: false, reason: "process_unavailable", exitCode: null, stdout: "" };
  }
}

function findExecutable(name, env, platform) {
  const pathValue = Object.entries(env).find(([key]) => key.toLowerCase() === "path")?.[1] ?? "";
  const p = platform === "win32" ? path.win32 : path.posix;
  const entries = pathValue.split(platform === "win32" ? ";" : ":");
  if (entries.length > 256) return { status: "unknown" };
  let wrapperFound = false;
  for (const entry of entries) {
    if (!p.isAbsolute(entry) || entry.length > 8192) continue;
    for (const suffix of platform === "win32" ? [".exe", ".cmd", ".bat"] : [""]) {
      const candidate = p.join(entry, name + suffix);
      try {
        const isFile = fs.statSync(candidate).isFile();
        if (!isFile) continue;
        if (
          classifyExecutable({ platform, filename: candidate, isFile, executable: true }) ===
          "unsupported_windows_wrapper"
        ) {
          wrapperFound = true;
          continue;
        }
        fs.accessSync(candidate, fs.constants.X_OK);
        return { status: "available", executable: fs.realpathSync(candidate) };
      } catch {
        // A missing/non-executable PATH entry is not an executable observation.
      }
    }
  }
  return { status: wrapperFound ? "unsupported_windows_wrapper" : "missing" };
}

function readPackageRuntime(root) {
  try {
    const filename = path.join(root, "package.json");
    const stat = fs.lstatSync(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) return {};
    const result = z
      .object({ engines: z.object({ node: z.string().max(256) }) })
      .safeParse(JSON.parse(fs.readFileSync(filename, "utf8")));
    return result.success ? { version: process.version, engines: result.data.engines.node } : {};
  } catch {
    return {};
  }
}

function inspectLocalFiles(root, hooksPath, env) {
  let dependencies = "missing";
  try {
    const stat = fs.lstatSync(path.join(root, "node_modules"));
    dependencies = stat.isSymbolicLink() ? "symlink" : stat.isDirectory() ? "directory" : "invalid";
  } catch {
    dependencies = "missing";
  }
  const canonicalHooks = path.join(root, ".husky", "_");
  const configured = hooksPath && path.resolve(root, hooksPath) === canonicalHooks;
  const canonicalDirectories = [path.join(root, ".husky"), canonicalHooks].every((directory) => {
    try {
      const stat = fs.lstatSync(directory);
      return stat.isDirectory() && !stat.isSymbolicLink();
    } catch {
      return false;
    }
  });
  const readableFile = (filename, mode = fs.constants.R_OK) => {
    try {
      const stat = fs.lstatSync(filename);
      fs.accessSync(filename, mode);
      return stat.isFile() && !stat.isSymbolicLink() && stat.size > 0;
    } catch {
      return false;
    }
  };
  const dispatcherPresent = readableFile(path.join(canonicalHooks, "h"));
  const executable = {};
  const readableScripts = {};
  for (const name of ["pre-commit", "commit-msg", "pre-push"]) {
    executable[name] = readableFile(
      path.join(canonicalHooks, name),
      fs.constants.R_OK | fs.constants.X_OK
    );
    readableScripts[name] = readableFile(path.join(root, ".husky", name));
  }
  return {
    dependencies,
    hooks: {
      canonicalPath: Boolean(configured),
      canonicalDirectories,
      dispatcherPresent,
      executable,
      readableScripts,
      disabledByEnvironment: env.HUSKY === "0",
      observed:
        Boolean(configured) &&
        canonicalDirectories &&
        dispatcherPresent &&
        env.HUSKY !== "0" &&
        Object.values(executable).every(Boolean) &&
        Object.values(readableScripts).every(Boolean),
    },
  };
}

export function collectPreflight(input = {}) {
  const options = z
    .object({ cwd: z.string().min(1).max(8192), env: envSchema })
    .strict()
    .safeParse({ cwd: process.cwd(), env: { ...process.env }, ...input });
  if (!options.success)
    return { schema: "factory.claude-preflight.v1", decision: "hold", holds: ["invalid_input"] };
  const { cwd, env } = options.data;
  const platform = platformSchema.safeParse(process.platform).success ? process.platform : "other";
  const childEnv = {
    ...env,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    DISABLE_AUTOUPDATER: "1",
  };
  // Git environment overrides can redirect even read-only commands to another index/worktree
  // or inject config. Observe the repository containing cwd, never those alternate targets.
  const gitEnv = Object.fromEntries(
    Object.entries(env).filter(([key]) => !key.toUpperCase().startsWith("GIT_"))
  );
  gitEnv.GIT_OPTIONAL_LOCKS = "0";
  const gitExecutable = findExecutable("git", env, platform);
  const git = (args) =>
    gitExecutable.status === "available"
      ? command(
          gitExecutable.executable,
          ["--no-optional-locks", "-c", "core.fsmonitor=false", ...args],
          cwd,
          gitEnv
        )
      : { ok: false, stdout: "", exitCode: null };
  const rootResult = git(["rev-parse", "--show-toplevel"]);
  let repository = { status: "unknown", reason: "git_repository_unavailable" };
  let runtime = classifyRuntime({});
  let localFiles = { dependencies: "unknown", hooks: { observed: false } };
  if (rootResult.ok && rootResult.stdout.trim()) {
    const observations = [
      git(["rev-parse", "--absolute-git-dir"]),
      git(["rev-parse", "--path-format=absolute", "--git-common-dir"]),
      git(["symbolic-ref", "--short", "HEAD"]),
      git(["rev-parse", "--verify", "HEAD"]),
      git(["status", "--porcelain=v1", "-z", "--untracked-files=normal"]),
    ];
    try {
      const root = fs.realpathSync(rootResult.stdout.trim());
      const relativeCwd = path.relative(root, fs.realpathSync(cwd));
      if (
        relativeCwd === ".." ||
        relativeCwd.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativeCwd)
      ) {
        throw new Error("cwd_outside_observed_repository");
      }
      runtime = classifyRuntime(readPackageRuntime(root));
      const hooksPath = git(["config", "--get", "core.hooksPath"]);
      localFiles = inspectLocalFiles(root, hooksPath.ok ? hooksPath.stdout.trim() : "", env);
      if (observations.every((result) => result.ok)) {
        repository = classifyWorktree({
          root,
          gitDir: fs.realpathSync(observations[0].stdout.trim()),
          commonDir: fs.realpathSync(observations[1].stdout.trim()),
          branch: observations[2].stdout.trim(),
          head: observations[3].stdout.trim(),
          status: observations[4].stdout,
          platform,
        });
      }
    } catch {
      repository = { status: "unknown", reason: "git_paths_unverified" };
    }
  }
  const cli = findExecutable("claude", env, platform);
  let claude = { executable: cli.status, version: null, auth: classifyAuthStatus({}) };
  if (cli.status === "available") {
    const result = command(cli.executable, ["--version"], cwd, childEnv);
    const match =
      result.ok && /^(\d{1,4}\.\d{1,4}\.\d{1,4})(?: \(Claude Code\))?\s*$/.exec(result.stdout);
    claude.version = match ? match[1] : null;
    if (claude.version) {
      // auth status emits JSON by default. Never request model output or log raw auth data.
      const auth = command(cli.executable, ["auth", "status"], cwd, childEnv);
      claude.auth = classifyAuthStatus(auth);
    }
  }
  const holds = [];
  if (runtime.status !== "supported") holds.push("unsupported_or_unknown_node");
  if (repository.status !== "isolated") holds.push("canonical_worktree_unverified");
  if (repository.clean !== true) holds.push("worktree_dirty_or_unknown");
  if (localFiles.dependencies !== "directory") holds.push("dependencies_missing_or_linked");
  if (!localFiles.hooks.observed) holds.push("hooks_unverified_or_disabled");
  if (!claude.version) holds.push("claude_cli_unverified");
  if (claude.auth.status !== "login_observed") holds.push("claude_auth_unverified");
  return {
    schema: "factory.claude-preflight.v1",
    decision: holds.length ? "hold" : "local_prerequisites_observed",
    holds,
    runtime,
    repository,
    localFiles,
    claude,
    environmentRoute: classifyRoute(env),
    platform: classifyPlatform({
      platform,
      release: os.release(),
      wslEnvironmentPresent: Boolean(env.WSL_DISTRO_NAME || env.WSL_INTEROP),
    }),
    managedSettings: "unknown_not_inspected",
    remoteControl: "unverified",
    hostIdentityVerified: false,
    providerProbePerformed: false,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report =
    process.argv.length === 2
      ? collectPreflight()
      : {
          schema: "factory.claude-preflight.v1",
          decision: "hold",
          holds: ["unsupported_arguments"],
        };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.decision === "hold" ? 2 : 0;
}
