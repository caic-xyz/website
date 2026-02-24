import { DurableObject } from "cloudflare:workers";

interface Env {
	WAITLIST: DurableObjectNamespace<WaitlistDO>;
}

export class WaitlistDO extends DurableObject<Env> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.ctx.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS submissions (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				pain TEXT NOT NULL,
				pay TEXT NOT NULL,
				created_at TEXT NOT NULL DEFAULT (datetime('now'))
			)
		`);
	}

	async submit(pain: string, pay: string): Promise<void> {
		this.ctx.storage.sql.exec(
			"INSERT INTO submissions (pain, pay) VALUES (?, ?)",
			pain,
			pay,
		);
	}

	async list(): Promise<{ id: number; pain: string; pay: string; created_at: string }[]> {
		return this.ctx.storage.sql
			.exec("SELECT id, pain, pay, created_at FROM submissions ORDER BY id DESC")
			.toArray() as { id: number; pain: string; pay: string; created_at: string }[];
	}
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === "/api/waitlist" && request.method === "POST") {
			try {
				const body = await request.json<{ pain?: string; pay?: string }>();
				const pain = body.pain?.trim();
				const pay = body.pay?.trim();
				if (!pain || !pay) {
					return Response.json({ error: "both fields required" }, { status: 400 });
				}

				const stub = env.WAITLIST.get(env.WAITLIST.idFromName("waitlist"));
				await stub.submit(pain, pay);

				return Response.json({ ok: true });
			} catch {
				return Response.json({ error: "invalid request" }, { status: 400 });
			}
		}

		if (url.pathname === "/admin/waitlist" && request.method === "GET") {
			const stub = env.WAITLIST.get(env.WAITLIST.idFromName("waitlist"));
			const rows = await stub.list();
			const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
			const tableRows = rows.map(r =>
				`<tr><td>${r.id}</td><td>${esc(r.pain)}</td><td>${esc(r.pay)}</td><td>${esc(r.created_at)}</td></tr>`
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
td{white-space:pre-wrap;max-width:400px}
.empty{color:var(--dim);margin-top:1rem}
.count{color:var(--dim);font-size:0.85rem}
</style>
</head>
<body>
<h1>waitlist submissions</h1>
<p class="count">${rows.length} total</p>
${rows.length === 0
	? '<p class="empty"># no submissions yet</p>'
	: `<table><thead><tr><th>#</th><th>pain</th><th>pay</th><th>time</th></tr></thead><tbody>${tableRows}</tbody></table>`}
</body>
</html>`;
			return new Response(html, { headers: { "Content-Type": "text/html;charset=UTF-8" } });
		}

		return new Response("not found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;
