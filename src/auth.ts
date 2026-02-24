interface Env {
	GOOGLE_CLIENT_ID: string;
	GOOGLE_CLIENT_SECRET: string;
	SESSION_SECRET: string;
	ALLOWED_EMAILS: string;
}

const COOKIE_NAME = "session";
const STATE_COOKIE = "oauth_state";
const SESSION_MAX_AGE = 86400; // 24h

// --- Session cookie (HMAC-SHA256 signed) ---

async function hmacSign(payload: string, secret: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
	return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function hmacVerify(payload: string, signature: string, secret: string): Promise<boolean> {
	const expected = await hmacSign(payload, secret);
	return expected === signature;
}

export async function signSession(email: string, secret: string): Promise<string> {
	const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE;
	const payload = JSON.stringify({ email, exp });
	const sig = await hmacSign(payload, secret);
	const encoded = btoa(payload) + "." + sig;
	return encoded;
}

async function parseSession(cookie: string, secret: string): Promise<string | null> {
	const dot = cookie.indexOf(".");
	if (dot === -1) return null;
	const payloadB64 = cookie.slice(0, dot);
	const sig = cookie.slice(dot + 1);

	let payload: string;
	try {
		payload = atob(payloadB64);
	} catch {
		return null;
	}
	if (!await hmacVerify(payload, sig, secret)) return null;

	try {
		const { email, exp } = JSON.parse(payload) as { email: string; exp: number };
		if (exp < Math.floor(Date.now() / 1000)) return null;
		return email;
	} catch {
		return null;
	}
}

function getCookie(request: Request, name: string): string | null {
	const header = request.headers.get("Cookie") ?? "";
	for (const part of header.split(";")) {
		const [k, ...rest] = part.split("=");
		if (k.trim() === name) return rest.join("=").trim();
	}
	return null;
}

// --- Public API ---

export function buildGoogleAuthUrl(env: Env, origin: string, state: string): string {
	const params = new URLSearchParams({
		client_id: env.GOOGLE_CLIENT_ID,
		redirect_uri: `${origin}/auth/callback`,
		response_type: "code",
		scope: "openid email",
		state,
		prompt: "select_account",
	});
	return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

/** Returns redirect response to Google consent screen. Sets state cookie for CSRF. */
export function handleLogin(env: Env, origin: string): Response {
	const state = crypto.randomUUID();
	const url = buildGoogleAuthUrl(env, origin, state);
	return new Response(null, {
		status: 302,
		headers: [
			["Location", url],
			["Set-Cookie", `${STATE_COOKIE}=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`],
		],
	});
}

/** Exchanges authorization code, validates email, sets session cookie. */
export async function handleCallback(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	const origin = url.origin;
	const code = url.searchParams.get("code");
	const state = url.searchParams.get("state");
	const savedState = getCookie(request, STATE_COOKIE);

	if (!code || !state || state !== savedState) {
		return new Response("invalid oauth state", { status: 403 });
	}

	// Exchange code for tokens.
	const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			code,
			client_id: env.GOOGLE_CLIENT_ID,
			client_secret: env.GOOGLE_CLIENT_SECRET,
			redirect_uri: `${origin}/auth/callback`,
			grant_type: "authorization_code",
		}),
	});
	if (!tokenRes.ok) {
		return new Response("token exchange failed", { status: 502 });
	}
	const tokens = await tokenRes.json<{ id_token?: string }>();
	if (!tokens.id_token) {
		return new Response("missing id_token", { status: 502 });
	}

	// Decode JWT payload (no signature verification — token came direct from Google over HTTPS).
	const payloadB64 = tokens.id_token.split(".")[1];
	const claims = JSON.parse(atob(payloadB64)) as { email?: string; email_verified?: boolean };
	if (!claims.email || !claims.email_verified) {
		return new Response("email not verified", { status: 403 });
	}

	const allowed = env.ALLOWED_EMAILS.split(",").map(e => e.trim());
	if (!allowed.includes(claims.email)) {
		return new Response("forbidden: email not in allowlist", { status: 403 });
	}

	const sessionValue = await signSession(claims.email, env.SESSION_SECRET);
	return new Response(null, {
		status: 302,
		headers: [
			["Location", `${origin}/admin/waitlist`],
			["Set-Cookie", `${COOKIE_NAME}=${sessionValue}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE}`],
			// Clear state cookie.
			["Set-Cookie", `${STATE_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`],
		],
	});
}

/** Returns the authenticated email, or null if not authenticated. */
export async function verifySession(request: Request, env: Env): Promise<string | null> {
	const cookie = getCookie(request, COOKIE_NAME);
	if (!cookie) return null;
	return parseSession(cookie, env.SESSION_SECRET);
}

/** Clears the session cookie. */
export function handleLogout(): Response {
	return new Response(null, {
		status: 302,
		headers: [
			["Location", "/"],
			["Set-Cookie", `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`],
		],
	});
}
