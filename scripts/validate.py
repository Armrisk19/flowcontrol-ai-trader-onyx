from pathlib import Path
import json, sys

root = Path(__file__).resolve().parents[1]
errors = []
required = [
    'START_HERE.md', 'SECURITY.md', 'config/onyx-mainnet.json',
    'packages/contracts/contracts/FlowVault.sol',
    'packages/contracts/contracts/FlowExecutionRouter.sol',
    'packages/contracts/contracts/FlowMembership.sol',
    'packages/contracts/contracts/FlowStrategyRegistry.sol',
    'packages/contracts/contracts/adapters/OnyxV2Adapter.sol',
    'apps/keeper-worker/src/index.ts',
    'apps/keeper-worker/src/markets.ts',
    'apps/keeper-worker/src/executor.ts',
    'apps/keeper-worker/migrations/0001_init.sql',
    'apps/web/src/App.tsx', '.github/workflows/ci.yml'
]
for rel in required:
    if not (root / rel).exists():
        errors.append(f'missing {rel}')
for p in root.rglob('*.json'):
    try:
        json.loads(p.read_text())
    except Exception as exc:
        errors.append(f'invalid json {p.relative_to(root)}: {exc}')
parts = []
for p in root.rglob('*'):
    if p.is_file() and p != Path(__file__) and p.stat().st_size < 1_000_000:
        parts.append(p.read_text(errors='ignore'))
text = '\n'.join(parts)
for banned in ['seed phrase here', 'BEGIN PRIVATE KEY', 'LIVE_EXECUTION=true\n']:
    if banned in text:
        errors.append(f'unsafe literal {banned!r}')
for literal in [
    '327',
    '0xa973c5626eEaF7F482439753953e9B28C6aF3674',
    '0x008c99EedA17E193e5F788536234C6b3520B8D15',
    'MIN_OUT_UNSAFE', 'execution_paused', 'allPairsLength', 'setTokenPolicies',
    'CREATOR_TIER_REQUIRED', 'FLOW_TIER_MANAGER', 'metadata_hash', 'issuedAt', 'referrer:${referrer.toLowerCase()}', 'last_assessed_at>=datetime'
]:
    if literal not in text:
        errors.append(f'missing safety literal {literal}')
sol = list((root / 'packages/contracts/contracts').rglob('*.sol'))
ts = list(root.rglob('*.ts')) + list(root.rglob('*.tsx'))
print(f'Solidity files: {len(sol)}')
print(f'TS/TSX files: {len(ts)}')
print('JSON: PASS' if not any('json' in e for e in errors) else 'JSON: FAIL')
print('Static safety scan: PASS' if not errors else 'Static safety scan: FAIL')
if errors:
    for error in errors:
        print('ERROR:', error)
    sys.exit(1)
