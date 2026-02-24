import { DurableObject } from "cloudflare:workers";
import { handleCallback, handleLogin, handleLogout, verifySession } from "./auth";

interface Env {
	WAITLIST: DurableObjectNamespace<WaitlistDO>;
	GOOGLE_CLIENT_ID: string;
	GOOGLE_CLIENT_SECRET: string;
	SESSION_SECRET: string;
	ALLOWED_EMAILS: string;
}

interface Submission {
	id: number;
	email: string;
	max_agents: number;
	pain: string;
	pay: string;
	target_platforms: string;
	dev_os: string;
	created_at: string;
}

export class WaitlistDO extends DurableObject<Env> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.ctx.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS submissions (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				email TEXT NOT NULL DEFAULT '',
				pain TEXT NOT NULL,
				pay TEXT NOT NULL,
				target_platforms TEXT NOT NULL DEFAULT '',
				dev_os TEXT NOT NULL DEFAULT '',
				created_at TEXT NOT NULL DEFAULT (datetime('now'))
			)
		`);
		// Migrate: add columns that may not exist on already-deployed tables.
		const cols = new Set(
			this.ctx.storage.sql.exec("PRAGMA table_info(submissions)").toArray().map((r: any) => r.name as string)
		);
		if (!cols.has("email")) {
			this.ctx.storage.sql.exec("ALTER TABLE submissions ADD COLUMN email TEXT NOT NULL DEFAULT ''");
		}
		if (!cols.has("target_platforms")) {
			this.ctx.storage.sql.exec("ALTER TABLE submissions ADD COLUMN target_platforms TEXT NOT NULL DEFAULT ''");
		}
		if (!cols.has("dev_os")) {
			this.ctx.storage.sql.exec("ALTER TABLE submissions ADD COLUMN dev_os TEXT NOT NULL DEFAULT ''");
		}
		if (!cols.has("max_agents")) {
			this.ctx.storage.sql.exec("ALTER TABLE submissions ADD COLUMN max_agents INTEGER NOT NULL DEFAULT 0");
		}
	}

	async submit(email: string, maxAgents: number, pain: string, pay: string, targetPlatforms: string[], devOs: string[]): Promise<void> {
		this.ctx.storage.sql.exec(
			"INSERT INTO submissions (email, max_agents, pain, pay, target_platforms, dev_os) VALUES (?, ?, ?, ?, ?, ?)",
			email,
			maxAgents,
			pain,
			pay,
			JSON.stringify(targetPlatforms),
			JSON.stringify(devOs),
		);
	}

	async delete(id: number): Promise<void> {
		this.ctx.storage.sql.exec("DELETE FROM submissions WHERE id = ?", id);
	}

	async list(): Promise<Submission[]> {
		return this.ctx.storage.sql
			.exec("SELECT id, email, max_agents, pain, pay, target_platforms, dev_os, created_at FROM submissions ORDER BY id DESC")
			.toArray() as Submission[];
	}
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === "/api/waitlist" && request.method === "POST") {
			try {
				const body = await request.json<{
					email?: string;
					max_agents?: number;
					pain?: string;
					pay?: string;
					target_platforms?: string[];
					dev_os?: string[];
				}>();
				const email = body.email?.trim();
				const maxAgents = typeof body.max_agents === "number" ? body.max_agents : 0;
				const pain = body.pain?.trim();
				const pay = body.pay?.trim();
				if (!email || !pain || !pay) {
					return Response.json({ error: "email, pain, and pay are required" }, { status: 400 });
				}

				const stub = env.WAITLIST.get(env.WAITLIST.idFromName("waitlist"));
				await stub.submit(email, maxAgents, pain, pay, body.target_platforms ?? [], body.dev_os ?? []);

				return Response.json({ ok: true });
			} catch {
				return Response.json({ error: "invalid request" }, { status: 400 });
			}
		}

		if (url.pathname === "/auth/google" && request.method === "GET") {
			return handleLogin(env, url.origin);
		}

		if (url.pathname === "/auth/callback" && request.method === "GET") {
			return handleCallback(request, env);
		}

		if (url.pathname === "/auth/logout" && request.method === "GET") {
			return handleLogout();
		}

		const deleteMatch = url.pathname.match(/^\/admin\/waitlist\/(\d+)$/);
		if (deleteMatch && request.method === "DELETE") {
			const email = await verifySession(request, env);
			if (!email) {
				return Response.json({ error: "unauthorized" }, { status: 401 });
			}
			const allowed = env.ALLOWED_EMAILS.split(",").map(e => e.trim());
			if (!allowed.includes(email)) {
				return Response.json({ error: "forbidden" }, { status: 403 });
			}
			const id = parseInt(deleteMatch[1], 10);
			const stub = env.WAITLIST.get(env.WAITLIST.idFromName("waitlist"));
			await stub.delete(id);
			return Response.json({ ok: true });
		}

		if (url.pathname === "/admin/waitlist" && request.method === "GET") {
			const email = await verifySession(request, env);
			if (!email) {
				return Response.redirect(`${url.origin}/auth/google`, 302);
			}
			const stub = env.WAITLIST.get(env.WAITLIST.idFromName("waitlist"));
			const rows = await stub.list();
			const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
			const fmtArr = (json: string) => {
				try { return (JSON.parse(json) as string[]).map(esc).join(", "); } catch { return esc(json); }
			};
			const tableRows = rows.map(r =>
				`<tr id="row-${r.id}"><td>${r.id}</td><td>${esc(r.email)}</td><td>${r.max_agents}</td><td>${esc(r.pain)}</td><td>${esc(r.pay)}</td><td>${fmtArr(r.target_platforms)}</td><td>${fmtArr(r.dev_os)}</td><td>${esc(r.created_at)}</td><td><button class="del" onclick="del(${r.id})" title="Delete">&#x1F5D1;</button></td></tr>`
			).join("\n");
			const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>waitlist submissions</title>
<style>
:root{--bg:#0a0a0a;--fg:#e0e0e0;--accent:#00ff41;--dim:#666;--font:'JetBrains Mono','Fira Code','Courier New',monospace}
body{background:var(--bg);color:var(--fg);font-family:var(--font);margin:0;padding:2rem;line-height:1.6}
h1{color:var(--accent);font-size:1.2rem;font-weight:normal}
h1::before{content:'> '}
table{border-collapse:collapse;width:100%;margin-top:1rem;font-size:0.85rem}
th,td{border:1px solid #333;padding:0.5rem;text-align:left}
th{color:var(--accent);border-color:var(--accent)}
td{white-space:pre-wrap;max-width:300px}
.empty{color:var(--dim);margin-top:1rem}
.count{color:var(--dim);font-size:0.85rem}
.del{background:none;border:none;cursor:pointer;font-size:1rem;padding:0.2rem 0.4rem;opacity:0.5;transition:opacity 0.15s}
.del:hover{opacity:1}
</style>
</head>
<body>
<h1>waitlist submissions</h1>
<p class="count">${rows.length} total</p>
${rows.length === 0
	? '<p class="empty"># no submissions yet</p>'
	: `<table><thead><tr><th>#</th><th>email</th><th>max agents</th><th>pain</th><th>pay</th><th>target platforms</th><th>dev os</th><th>time</th><th></th></tr></thead><tbody>${tableRows}</tbody></table>`}
<script>
async function del(id){if(!confirm('Delete submission '+id+'?'))return;const r=await fetch('/admin/waitlist/'+id,{method:'DELETE'});if(r.ok){document.getElementById('row-'+id)?.remove()}else{alert('Failed: '+(await r.text()))}}
</script>
</body>
</html>`;
			return new Response(html, { headers: { "Content-Type": "text/html;charset=UTF-8" } });
		}

		return new Response("not found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;
