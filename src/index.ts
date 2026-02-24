import { DurableObject } from "cloudflare:workers";

interface Env {
	WAITLIST: DurableObjectNamespace<WaitlistDO>;
}

interface Submission {
	id: number;
	email: string;
	pain: string;
	pay: string;
	platform: string;
	dev_os: string;
	created_at: string;
}

export class WaitlistDO extends DurableObject<Env> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.ctx.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS submissions (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				email TEXT NOT NULL,
				pain TEXT NOT NULL,
				pay TEXT NOT NULL,
				platform TEXT NOT NULL DEFAULT '',
				dev_os TEXT NOT NULL DEFAULT '',
				created_at TEXT NOT NULL DEFAULT (datetime('now'))
			)
		`);
	}

	async submit(email: string, pain: string, pay: string, platform: string[], devOs: string[]): Promise<void> {
		this.ctx.storage.sql.exec(
			"INSERT INTO submissions (email, pain, pay, platform, dev_os) VALUES (?, ?, ?, ?, ?)",
			email,
			pain,
			pay,
			JSON.stringify(platform),
			JSON.stringify(devOs),
		);
	}

	async list(): Promise<Submission[]> {
		return this.ctx.storage.sql
			.exec("SELECT id, email, pain, pay, platform, dev_os, created_at FROM submissions ORDER BY id DESC")
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
					pain?: string;
					pay?: string;
					platform?: string[];
					dev_os?: string[];
				}>();
				const email = body.email?.trim();
				const pain = body.pain?.trim();
				const pay = body.pay?.trim();
				if (!email || !pain || !pay) {
					return Response.json({ error: "email, pain, and pay are required" }, { status: 400 });
				}

				const stub = env.WAITLIST.get(env.WAITLIST.idFromName("waitlist"));
				await stub.submit(email, pain, pay, body.platform ?? [], body.dev_os ?? []);

				return Response.json({ ok: true });
			} catch {
				return Response.json({ error: "invalid request" }, { status: 400 });
			}
		}

		if (url.pathname === "/admin/waitlist" && request.method === "GET") {
			const stub = env.WAITLIST.get(env.WAITLIST.idFromName("waitlist"));
			const rows = await stub.list();
			const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
			const fmtArr = (json: string) => {
				try { return (JSON.parse(json) as string[]).map(esc).join(", "); } catch { return esc(json); }
			};
			const tableRows = rows.map(r =>
				`<tr><td>${r.id}</td><td>${esc(r.email)}</td><td>${esc(r.pain)}</td><td>${esc(r.pay)}</td><td>${fmtArr(r.platform)}</td><td>${fmtArr(r.dev_os)}</td><td>${esc(r.created_at)}</td></tr>`
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
</style>
</head>
<body>
<h1>waitlist submissions</h1>
<p class="count">${rows.length} total</p>
${rows.length === 0
	? '<p class="empty"># no submissions yet</p>'
	: `<table><thead><tr><th>#</th><th>email</th><th>pain</th><th>pay</th><th>platform</th><th>dev os</th><th>time</th></tr></thead><tbody>${tableRows}</tbody></table>`}
</body>
</html>`;
			return new Response(html, { headers: { "Content-Type": "text/html;charset=UTF-8" } });
		}

		return new Response("not found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;
