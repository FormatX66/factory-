import { isIPv4 } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  calculateSubnet,
  isIPInSubnet,
} from "../../factory/components/lissy93/vendor/networking-toolbox/src/lib/utils/ip-calculations.ts";
import {
  convertIPFormats,
  decimalToIP,
} from "../../factory/components/lissy93/vendor/networking-toolbox/src/lib/utils/ip-conversions.ts";

const ipv4 = z.string().min(7).max(15).refine(isIPv4, "Expected canonical IPv4");
const cidr = z
  .string()
  .max(18)
  .regex(/^[0-9.]{7,15}\/(?:[0-9]|[12][0-9]|3[0-2])$/)
  .refine((value) => isIPv4(value.split("/")[0]), "Expected IPv4/prefix");
const uint32 = z.number().int().min(0).max(4294967295);
const dotted = (value) => value.octets.join(".");

/** Pure local calculation; never contacts the supplied address. */
export function analyzeSubnet(value) {
  const [ip, bits] = cidr.parse(value).split("/");
  const prefix = Number(bits);
  // Upstream shifts a 32-bit mask by 32 at /0. Preserve its source and normalize
  // this boundary here; the independent Python oracle covers every prefix.
  const result = calculateSubnet(prefix === 0 ? "0.0.0.0" : ip, prefix);
  return {
    input: value,
    cidr: `${dotted(result.network)}/${prefix}`,
    network: dotted(result.network),
    broadcast: dotted(result.broadcast),
    netmask: dotted(result.subnet),
    wildcardMask: dotted(result.wildcardMask),
    totalAddresses: result.hostCount,
    usableHosts: result.usableHosts,
    firstHost: dotted(result.firstHost),
    lastHost: dotted(result.lastHost),
  };
}

export function containsIPv4(address, network) {
  const ip = ipv4.parse(address);
  const [base, bits] = cidr.parse(network).split("/");
  return Number(bits) === 0 || isIPInSubnet(ip, base, Number(bits));
}

export function convertIPv4(address) {
  return convertIPFormats(ipv4.parse(address));
}

export function fromDecimal(value) {
  return decimalToIP(uint32.parse(value));
}

export function runCommand(input) {
  const args = z.array(z.string().max(100)).min(2).max(3).parse(input);
  const [command, value, other] = args;
  if (command === "subnet" && args.length === 2) return analyzeSubnet(value);
  if (command === "formats" && args.length === 2) return convertIPv4(value);
  if (command === "contains" && args.length === 3) return { contains: containsIPv4(value, other) };
  if (command === "from-decimal" && args.length === 2 && /^(?:0|[1-9][0-9]{0,9})$/.test(value)) {
    return { ip: fromDecimal(Number(value)) };
  }
  throw new Error("Invalid command");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    console.log(JSON.stringify({ ok: true, result: runCommand(process.argv.slice(2)) }, null, 2));
  } catch {
    console.error(
      JSON.stringify({
        ok: false,
        error:
          "Expected: subnet IPv4/prefix | formats IPv4 | contains IPv4 IPv4/prefix | from-decimal uint32",
      })
    );
    process.exitCode = 2;
  }
}
