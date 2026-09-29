import fs from "node:fs";

const VALID = new Set(["healthy","held","failed"]);

function parseFile(file) {
  const text = fs.readFileSync(file,"utf8").trim();
  if (!text) return [];
  try {
    const value = JSON.parse(text);
    return Array.isArray(value) ? value : [value];
  } catch {
    const lines = text.split(/\r?\n/).filter(Boolean);
    return lines.map(line => JSON.parse(line));
  }
}

export function summarizeEvidence(paths, now = new Date()) {
  const out = { generated_at: now.toISOString(), totals:{healthy:0,held:0,failed:0}, records:[], errors:[], last_verified_at:null };
  for (const file of paths) {
    if (!fs.existsSync(file)) { out.errors.push({file,error:"missing"}); continue; }
    let records;
    try { records = parseFile(file); }
    catch { out.errors.push({file,error:"malformed-json"}); continue; }
    for (const r of records) {
      const status = r.status ?? (r.ok === true ? "healthy" : r.ok === false ? "failed" : null);
      const observed = r.observed_at ?? r.checkedAt ?? r.at ?? r.generatedAt ?? null;
      if (!VALID.has(status) || !observed || Number.isNaN(Date.parse(observed))) {
        out.errors.push({file,error:"invalid-record"}); continue;
      }
      out.totals[status] += 1;
      out.records.push({
        evidence_id:r.evidence_id ?? r.operationId ?? file, status,
        source:r.source ?? file, observed_at:observed, reason:r.reason ?? null
      });
      if (!out.last_verified_at || Date.parse(observed) > Date.parse(out.last_verified_at))
        out.last_verified_at = observed;
    }
  }
  return out;
}
