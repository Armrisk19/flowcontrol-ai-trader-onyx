from pathlib import Path
import os, sys

root = Path(__file__).resolve().parents[1]
path = root / "apps/keeper-worker/wrangler.toml"
text = path.read_text()
replacements = {
    "REPLACE_FLOW_VAULT_FACTORY": os.getenv("FLOW_VAULT_FACTORY", ""),
    "REPLACE_FLOW_EXECUTION_ROUTER": os.getenv("FLOW_EXECUTION_ROUTER", ""),
    "REPLACE_FLOW_ADAPTER": os.getenv("FLOW_ADAPTER", ""),
    "REPLACE_FLOW_TOKEN_REGISTRY": os.getenv("FLOW_TOKEN_REGISTRY", ""),
    "REPLACE_FLOW_STRATEGY_REGISTRY": os.getenv("FLOW_STRATEGY_REGISTRY", ""),
    "REPLACE_FLOW_TIER_MANAGER": os.getenv("FLOW_TIER_MANAGER", ""),
    "REPLACE_WEB_ORIGIN": os.getenv("ALLOWED_WEB_ORIGIN", ""),
    "REPLACE_D1_DATABASE_ID": os.getenv("D1_DATABASE_ID", ""),
}
missing = [name for name, value in replacements.items() if not value]
if missing:
    print("Missing deployment values:", ", ".join(missing), file=sys.stderr)
    raise SystemExit(1)
for marker, value in replacements.items():
    text = text.replace(marker, value)
path.write_text(text)
print("Rendered", path)
