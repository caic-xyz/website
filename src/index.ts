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

		return new Response("not found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;
