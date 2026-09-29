"""Independent IPv4 oracle. Run from any working directory; requires Node 24."""
import ipaddress
import json
import pathlib
import random
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[2]
rng = random.Random(9302026)
cases = []
for prefix in range(33):
    values = [0, 1, 2147483647, 2147483648, 4294967295]
    values += [rng.getrandbits(32) for _ in range(5)]
    for value in values:
        ip = str(ipaddress.IPv4Address(value))
        network = ipaddress.IPv4Network(f"{ip}/{prefix}", strict=False)
        peer = str(ipaddress.IPv4Address(rng.getrandbits(32)))
        first = network.network_address if prefix >= 31 else network.network_address + 1
        last = network.broadcast_address if prefix >= 31 else network.broadcast_address - 1
        expected = {
            "input": f"{ip}/{prefix}", "cidr": str(network),
            "network": str(network.network_address),
            "broadcast": str(network.broadcast_address),
            "netmask": str(network.netmask), "wildcardMask": str(network.hostmask),
            "totalAddresses": network.num_addresses,
            "usableHosts": network.num_addresses if prefix >= 31 else network.num_addresses - 2,
            "firstHost": str(first), "lastHost": str(last),
        }
        cases.append({"input": f"{ip}/{prefix}", "peer": peer, "expected": expected,
                      "contains": ipaddress.IPv4Address(peer) in network, "integer": value})
script = """
import {readFileSync} from 'node:fs';
import {analyzeSubnet,containsIPv4,convertIPv4,fromDecimal} from './scripts/ops/lissy93-network.mjs';
const rows=JSON.parse(readFileSync(0,'utf8'));
console.log(JSON.stringify(rows.map(x=>({subnet:analyzeSubnet(x.input),
contains:containsIPv4(x.peer,x.input),decimal:Number(convertIPv4(x.input.split('/')[0]).decimal),
reverse:fromDecimal(x.integer)}))));
"""
result = subprocess.run(["node", "--input-type=module", "-e", script], cwd=ROOT,
                        input=json.dumps(cases), text=True, capture_output=True,
                        timeout=35, check=True)
actual = json.loads(result.stdout)
if len(actual) != len(cases):
    raise AssertionError("Oracle response count mismatch")
for index, (case, out) in enumerate(zip(cases, actual)):
    expected = {"subnet": case["expected"], "contains": case["contains"],
                "decimal": case["integer"], "reverse": case["input"].split("/")[0]}
    if out != expected:
        raise AssertionError(f"Oracle mismatch in case {index}: {case['input']}")
print(json.dumps({"result": "passed", "cases": len(cases), "prefixes": "0 through 32",
                  "oracle": "Python ipaddress", "checks_per_case": 4, "seed": 9302026}))
