import { getAddress, isAddress, keccak256, toBytes, verifyMessage } from "viem";
import { z } from "zod";
import { strategyRegistryAbi, tierManagerAbi, vaultAbi, vaultFactoryAbi } from "./abi";
import { publicFor, signerFor } from "./client";
import { runVaults } from "./executor";
import { assessMarkets, discoverPairs, listMarkets, reviewMarket, seedOfficialMarkets } from "./markets";
import { acquireLease, releaseLease, verifyRuntime } from "./safety";
import { listStrategies } from "./strategies";
import type { Env } from "./types";

const registration = z.object({
  owner: z.string(),
  vault: z.string(),
  strategyId: z.number().int().min(1).max(1_000_000),
  expiresAt: z.number().int(),
  issuedAt: z.number().int(),
  signature: z.string(),
  referrer: z.string().default("0x0000000000000000000000000000000000000000"),
});

const marketReview = z.object({ pairAddress: z.string(), reviewed: z.boolean() });
const strategyMetadata = z.object({
  creator: z.string(),
  metadata: z.object({
    name: z.string().min(3).max(80),
    description: z.string().min(10).max(1_000),
    rules: z.object({
      reserveBps: z.number().int().min(1_000).max(9_000),
      rebalanceThresholdBps: z.number().int().min(100).max(3_000),
      maxTradeUsd: z.number().min(5).max(100_000),
      maxAssets: z.number().int().min(1).max(12),
      momentumOnly: z.boolean(),
      cooldownSeconds: z.number().int().min(60).max(86_400),
      maxTradesPerDay: z.number().int().min(1).max(48),
    }),
  }),
  signature: z.string(),
});

function cors(env: Env) {
  return {
    "access-control-allow-origin": env.ALLOWED_WEB_ORIGIN || "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,x-admin-key",
  };
}

function jsonReplacer(_key: string, value: unknown) {
  return typeof value === "bigint" ? value.toString() : value;
}

function json(env: Env, body: unknown, status = 200) {
  return new Response(JSON.stringify(body, jsonReplacer), {
    status,
    headers: { "content-type": "application/json", ...cors(env) },
  });
}

function requireAdmin(request: Request, env: Env) {
  if (!env.ADMIN_API_KEY || request.headers.get("x-admin-key") !== env.ADMIN_API_KEY) {
    throw new Error("UNAUTHORIZED");
  }
}

async function consumeRateLimit(env: Env, key: string, limit: number, windowSeconds: number) {
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare("SELECT window_started_at,count FROM rate_limits WHERE key=?")
    .bind(key).first<{ window_started_at: number; count: number }>();
  if (!row || now - row.window_started_at >= windowSeconds) {
    await env.DB.prepare(`
      INSERT INTO rate_limits(key,window_started_at,count) VALUES(?,?,1)
      ON CONFLICT(key) DO UPDATE SET window_started_at=excluded.window_started_at,count=1
    `).bind(key, now).run();
    return;
  }
  if (row.count >= limit) throw new Error("RATE_LIMITED");
  await env.DB.prepare("UPDATE rate_limits SET count=count+1 WHERE key=?").bind(key).run();
}

function requestIp(request: Request) {
  return request.headers.get("CF-Connecting-IP") || "unknown";
}

async function cycle(env: Env) {
  const holder = crypto.randomUUID();
  if (!await acquireLease(env, "scheduled-cycle", holder)) return { skipped: "lease" };
  try {
    const runtime = await verifyRuntime(env);
    await seedOfficialMarkets(env);
    const discovery = await discoverPairs(env);
    await assessMarkets(env);
    const execution = await runVaults(env, `${runtime.block}-${holder}`);
    return { runtime, discovery, execution };
  } finally {
    await releaseLease(env, "scheduled-cycle", holder);
  }
}

export default {
  async scheduled(_controller: ScheduledController, env: Env, context: ExecutionContext) {
    context.waitUntil(cycle(env).catch((error) => console.error("cycle", error)));
  },

  async fetch(request: Request, env: Env, _context: ExecutionContext) {
    if (request.method === "OPTIONS") return new Response(null, { headers: cors(env) });
    const url = new URL(request.url);

    try {
      if (url.pathname === "/api/v1/health") {
        const runtime = await verifyRuntime(env);
        const paused = await env.DB.prepare("SELECT value FROM system_state WHERE key='execution_paused'")
          .first<{ value: string }>();
        const counts = await env.DB.prepare(`
          SELECT COUNT(*) AS total,
            SUM(CASE WHEN status='ACTIVE' THEN 1 ELSE 0 END) AS active,
            SUM(CASE WHEN status='LIMITED' THEN 1 ELSE 0 END) AS limited
          FROM markets
        `).first<{ total: number; active: number; limited: number }>();
        return json(env, {
          ok: true,
          version: "0.2.16",
          runtime,
          markets: counts || { total: 0, active: 0, limited: 0 },
          configuredLive: env.LIVE_EXECUTION === "true",
          databasePaused: paused?.value !== "false",
          executorConfigured: Boolean(env.EXECUTOR_PRIVATE_KEY),
        });
      }

      if (url.pathname === "/api/v1/markets") {
        return json(env, { markets: await listMarkets(env) });
      }

      if (url.pathname === "/api/v1/strategies") {
        return json(env, { strategies: await listStrategies(env) });
      }

      if (url.pathname.startsWith("/api/v1/strategy-metadata/") && request.method === "GET") {
        const id = url.pathname.split("/").pop() || "";
        const row = await env.DB.prepare("SELECT * FROM strategy_metadata WHERE id=?").bind(id).first<any>();
        if (!row) return json(env, { error: "NOT_FOUND" }, 404);
        return json(env, {
          id: row.id, creator: row.creator, name: row.name, description: row.description,
          rules: JSON.parse(row.rules_json), createdAt: row.created_at,
        });
      }

      if (url.pathname === "/api/v1/strategy-metadata" && request.method === "POST") {
        const body = strategyMetadata.parse(await request.json());
        if (!isAddress(body.creator)) throw new Error("INVALID_CREATOR");
        const creator = getAddress(body.creator);
        await consumeRateLimit(env, `metadata:${creator.toLowerCase()}:${requestIp(request)}`, 10, 3600);
        const canonical = JSON.stringify(body.metadata);
        const hash = keccak256(toBytes(canonical));
        const signedMessage = `FLOWCONTROL STRATEGY METADATA\nchainId:327\ncreator:${creator.toLowerCase()}\nhash:${hash}`;
        const valid = await verifyMessage({
          address: creator, message: signedMessage, signature: body.signature as `0x${string}`,
        });
        if (!valid) throw new Error("BAD_SIGNATURE");
        const creatorTier = await publicFor(env).readContract({
          address: env.FLOW_TIER_MANAGER,
          abi: tierManagerAbi,
          functionName: "tierOf",
          args: [creator],
        });
        if (Number(creatorTier) < 3) throw new Error("CREATOR_TIER_REQUIRED");
        const existing = await env.DB.prepare("SELECT id FROM strategy_metadata WHERE metadata_hash=? AND creator=?")
          .bind(hash, creator.toLowerCase()).first<{ id: string }>();
        const id = existing?.id || crypto.randomUUID();
        if (!existing) {
          await env.DB.prepare(`
            INSERT INTO strategy_metadata(id,creator,name,description,rules_json,metadata_hash,created_at)
            VALUES(?,?,?,?,?,?,datetime('now'))
          `).bind(
            id, creator.toLowerCase(), body.metadata.name, body.metadata.description,
            JSON.stringify(body.metadata.rules), hash,
          ).run();
        }
        return json(env, { ok: true, metadataURI: `${url.origin}/api/v1/strategy-metadata/${id}`, hash });
      }

      if (url.pathname.startsWith("/api/v1/vaults/") && url.pathname.endsWith("/decisions") && request.method === "POST") {
        const parts = url.pathname.split("/");
        const vault = parts[4] || "";
        const body = await request.json() as { owner?: string; expiresAt?: number; signature?: string };
        const ownerParam = body.owner || "";
        const expiresAt = Number(body.expiresAt || 0);
        const signature = body.signature || "";
        if (!isAddress(vault) || !isAddress(ownerParam)) throw new Error("INVALID_ADDRESS");
        if (expiresAt <= Date.now() / 1000 || expiresAt > Date.now() / 1000 + 600) throw new Error("INVALID_EXPIRY");
        const owner = getAddress(ownerParam);
        const checkedVault = getAddress(vault);
        await consumeRateLimit(env, `decisions:${owner.toLowerCase()}:${requestIp(request)}`, 60, 3600);
        const message = `FLOWCONTROL DECISIONS\nchainId:327\nowner:${owner.toLowerCase()}\nvault:${checkedVault.toLowerCase()}\nexpiresAt:${expiresAt}`;
        if (!await verifyMessage({ address: owner, message, signature: signature as `0x${string}` })) throw new Error("BAD_SIGNATURE");
        const onchainOwner = await publicFor(env).readContract({
          address: env.FLOW_VAULT_FACTORY, abi: vaultFactoryAbi, functionName: "ownerOfVault", args: [checkedVault],
        });
        if (getAddress(onchainOwner) !== owner) throw new Error("VAULT_OWNERSHIP_MISMATCH");
        const decisions = (await env.DB.prepare(`
          SELECT mode,action,token_in,token_out,amount_in,minimum_out,score,reason,tx_hash,created_at
          FROM decisions WHERE vault=? ORDER BY id DESC LIMIT 100
        `).bind(checkedVault.toLowerCase()).all<any>()).results;
        return json(env, { vault: checkedVault, decisions });
      }

      if (url.pathname === "/api/v1/vaults/register" && request.method === "POST") {
        const body = registration.parse(await request.json());
        if (!isAddress(body.owner) || !isAddress(body.vault) || !isAddress(body.referrer)) {
          throw new Error("INVALID_ADDRESS");
        }
        const now = Math.floor(Date.now() / 1000);
        if (body.expiresAt <= now || body.expiresAt > now + 90 * 86400) throw new Error("INVALID_EXPIRY");
        if (body.issuedAt < now - 300 || body.issuedAt > now + 120) throw new Error("INVALID_ISSUED_AT");

        const owner = getAddress(body.owner);
        const vault = getAddress(body.vault);
        const referrer = getAddress(body.referrer);
        await consumeRateLimit(env, `register:${owner.toLowerCase()}:${requestIp(request)}`, 30, 3600);
        const message = `FLOWCONTROL REGISTER\nchainId:327\nowner:${owner.toLowerCase()}\nvault:${vault.toLowerCase()}\nstrategyId:${body.strategyId}\nreferrer:${referrer.toLowerCase()}\nexpiresAt:${body.expiresAt}\nissuedAt:${body.issuedAt}`;
        const signatureValid = await verifyMessage({
          address: owner, message, signature: body.signature as `0x${string}`,
        });
        if (!signatureValid) throw new Error("BAD_SIGNATURE");

        const client = publicFor(env);
        const [validVault, onchainOwner, strategyAllowed, vaultExecutor, vaultExecutorExpiry, strategyActive, minimumTier, ownerTier] = await Promise.all([
          client.readContract({ address: env.FLOW_VAULT_FACTORY, abi: vaultFactoryAbi, functionName: "isVault", args: [vault] }),
          client.readContract({ address: env.FLOW_VAULT_FACTORY, abi: vaultFactoryAbi, functionName: "ownerOfVault", args: [vault] }),
          client.readContract({ address: vault, abi: vaultAbi, functionName: "strategyAllowed", args: [BigInt(body.strategyId)] }),
          client.readContract({ address: vault, abi: vaultAbi, functionName: "executor" }),
          client.readContract({ address: vault, abi: vaultAbi, functionName: "executorExpiry" }),
          client.readContract({ address: env.FLOW_STRATEGY_REGISTRY, abi: strategyRegistryAbi, functionName: "isActive", args: [BigInt(body.strategyId)] }),
          client.readContract({ address: env.FLOW_STRATEGY_REGISTRY, abi: strategyRegistryAbi, functionName: "minimumTier", args: [BigInt(body.strategyId)] }),
          client.readContract({ address: env.FLOW_TIER_MANAGER, abi: tierManagerAbi, functionName: "tierOf", args: [owner] }),
        ]);
        if (!validVault || getAddress(onchainOwner) !== owner) throw new Error("VAULT_OWNERSHIP_MISMATCH");
        if (!strategyActive || !strategyAllowed) throw new Error("STRATEGY_NOT_READY");
        if (Number(ownerTier) < Number(minimumTier)) throw new Error("TIER_TOO_LOW");
        if (Number(vaultExecutorExpiry) < body.expiresAt) throw new Error("REGISTRATION_EXCEEDS_EXECUTOR_EXPIRY");
        if (env.EXECUTOR_PRIVATE_KEY) {
          const { account } = signerFor(env);
          if (getAddress(vaultExecutor) !== getAddress(account.address)) throw new Error("EXECUTOR_MISMATCH");
        }
        const previous = await env.DB.prepare("SELECT issued_at FROM vaults WHERE vault=?")
          .bind(vault.toLowerCase()).first<{ issued_at: number }>();
        if (previous && body.issuedAt <= previous.issued_at) throw new Error("STALE_REGISTRATION");

        await env.DB.prepare(`
          INSERT INTO vaults(vault,owner,strategy_id,referrer,expires_at,issued_at,enabled,created_at,updated_at)
          VALUES(?,?,?,?,?,?,1,datetime('now'),datetime('now'))
          ON CONFLICT(vault) DO UPDATE SET owner=excluded.owner,strategy_id=excluded.strategy_id,
            referrer=excluded.referrer,expires_at=excluded.expires_at,issued_at=excluded.issued_at,enabled=1,updated_at=datetime('now')
        `).bind(
          vault.toLowerCase(), owner.toLowerCase(), body.strategyId,
          referrer.toLowerCase(), body.expiresAt, body.issuedAt,
        ).run();
        return json(env, { ok: true, vault });
      }

      if (url.pathname === "/api/v1/admin/market-review" && request.method === "POST") {
        requireAdmin(request, env);
        const body = marketReview.parse(await request.json());
        if (!isAddress(body.pairAddress)) throw new Error("INVALID_PAIR_ADDRESS");
        return json(env, { ok: true, market: await reviewMarket(env, body.pairAddress, body.reviewed) });
      }

      if (url.pathname === "/api/v1/admin/pause" && request.method === "POST") {
        requireAdmin(request, env);
        const body = await request.json() as { paused?: boolean };
        const paused = body.paused !== false;
        await env.DB.prepare("UPDATE system_state SET value=?,updated_at=datetime('now') WHERE key='execution_paused'")
          .bind(paused ? "true" : "false").run();
        return json(env, { ok: true, paused });
      }

      if (url.pathname === "/api/v1/admin/run" && request.method === "POST") {
        requireAdmin(request, env);
        return json(env, await cycle(env));
      }

      return json(env, { error: "NOT_FOUND" }, 404);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json(env, { error: message }, message === "UNAUTHORIZED" ? 401 : 400);
    }
  },
};
