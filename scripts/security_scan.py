from __future__ import annotations

from pathlib import Path
import json
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
errors: list[str] = []

text_files: list[Path] = []
for path in ROOT.rglob("*"):
    if not path.is_file() or "node_modules" in path.parts or path.stat().st_size > 2_000_000:
        continue
    text_files.append(path)

scan_text_files = [
    path for path in text_files
    if path.resolve() not in {Path(__file__).resolve(), (ROOT / "scripts/validate.py").resolve()}
]
all_text = "\n".join(path.read_text(errors="ignore") for path in scan_text_files)

# Secret material and unsafe defaults.
secret_patterns = {
    "probable private key": r"(?<![A-Za-z0-9])0x[0-9a-fA-F]{64}(?![A-Za-z0-9])",
    "PEM private key": r"BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY",
    "filled private-key variable": r"(?:DEPLOYER_PRIVATE_KEY|EXECUTOR_PRIVATE_KEY)\s*=\s*0x[0-9a-fA-F]+",
}
for label, pattern in secret_patterns.items():
    if re.search(pattern, all_text):
        errors.append(label)

# Solidity primitives intentionally excluded from this vault architecture.
solidity_banned = ["tx.origin", "delegatecall", "selfdestruct", "suicide(", "callcode", "assembly {"]
for path in (ROOT / "packages/contracts/contracts").rglob("*.sol"):
    source = path.read_text()
    for token in solidity_banned:
        if token in source:
            errors.append(f"{path.relative_to(ROOT)} contains banned Solidity primitive {token!r}")
    if source.count("{") != source.count("}"):
        errors.append(f"{path.relative_to(ROOT)} has unbalanced braces")
    for imported in re.findall(r'import\s+[^;]*?from\s+"(\./[^\"]+|\.\./[^\"]+)";', source):
        if not (path.parent / imported).resolve().exists():
            errors.append(f"{path.relative_to(ROOT)} missing local import {imported}")

# Signed registration must bind every fee- and execution-relevant field in both clients.
worker = (ROOT / "apps/keeper-worker/src/index.ts").read_text()
web = (ROOT / "apps/web/src/App.tsx").read_text()
for field in ["owner:", "vault:", "strategyId:", "referrer:", "expiresAt:", "issuedAt:"]:
    if field not in worker:
        errors.append(f"worker registration signature missing {field}")
    if field not in web:
        errors.append(f"web registration signature missing {field}")
for required in ["STALE_REGISTRATION", "EXECUTOR_MISMATCH", "STRATEGY_NOT_READY", "REGISTRATION_EXCEEDS_EXECUTOR_EXPIRY"]:
    if required not in worker:
        errors.append(f"registration safety check missing {required}")

# Live execution must ship with two closed gates.
wrangler = (ROOT / "apps/keeper-worker/wrangler.toml").read_text()
migration = (ROOT / "apps/keeper-worker/migrations/0001_init.sql").read_text()
if 'LIVE_EXECUTION = "false"' not in wrangler:
    errors.append("Worker live gate does not default to false")
if "VALUES('execution_paused','true'" not in migration.replace(" ", ""):
    errors.append("Database execution gate does not default to true")

# Dependency versions are pinned until a reviewed package lock is committed.
for package_path in ROOT.rglob("package.json"):
    package = json.loads(package_path.read_text())
    for section in ("dependencies", "devDependencies"):
        for name, version in package.get(section, {}).items():
            if version.startswith(("^", "~", ">", "<", "*")):
                errors.append(f"{package_path.relative_to(ROOT)} has mutable {name} version {version}")

# Avoid the Node 20 action warning that affected prior deployments.
for workflow in (ROOT / ".github/workflows").glob("*.yml"):
    source = workflow.read_text()
    if "actions/checkout@v4" in source or "actions/setup-node@v4" in source or "actions/upload-artifact@v4" in source:
        errors.append(f"{workflow.relative_to(ROOT)} still uses a Node-20-era action")
    if '-d "{"' in source:
        errors.append(f"{workflow.relative_to(ROOT)} contains broken shell JSON quoting")

# High-value execution invariants.
for literal in [
    "MIN_OUT_UNSAFE", "NOT_VAULT", "ADAPTER_NOT_APPROVED", "REGISTRY_SIZE_LIMIT",
    "VAULT_SIZE_LIMIT", "DAILY_SPEND_CAP", "RESERVE_REQUIRED", "TRADER_UNAUTHORIZED",
    "allPairsLength", "last_assessed_at>=datetime", "simulateContract", "execution_paused",
]:
    if literal not in all_text:
        errors.append(f"missing invariant marker {literal}")

if errors:
    print("Security scan: FAIL")
    for error in errors:
        print("ERROR:", error)
    sys.exit(1)

print("Security scan: PASS")
print(f"Scanned files: {len(text_files)}")
print("Checked secrets, Solidity primitives/imports, signatures, live gates, dependency pins, workflows, and execution invariants.")
