# Factory Health Dashboard v0.1
Build a dependency-free Node.js CLI that reads Factory evidence JSON files and prints one compact JSON health summary.
Requirements: never mutate source evidence; tolerate missing/malformed evidence; show healthy/held/failed counts; include last verified timestamp; tests must cover malformed and missing input; output must be machine-readable.