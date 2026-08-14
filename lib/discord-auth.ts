const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type DiscordSession = {
  user: {
    id: string;
    username: string;
    globalName: string | null;
    avatar: string | null;
  };
  webhookUrl?: string;
};

function toBase64Url(value: Uint8Array) {
  return Buffer.from(value).toString("base64url");
}

function fromBase64Url(value: string) {
  return new Uint8Array(Buffer.from(value, "base64url"));
}

async function sessionKey() {
  const secret = process.env.DISCORD_CLIENT_SECRET;
  if (!secret) throw new Error("DISCORD_CLIENT_SECRET is not configured");
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function sealDiscordSession(session: DiscordSession) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await sessionKey(),
    encoder.encode(JSON.stringify(session)),
  );
  return `${toBase64Url(iv)}.${toBase64Url(new Uint8Array(encrypted))}`;
}

export async function readDiscordSession(value?: string) {
  if (!value) return null;
  try {
    const [iv, encrypted] = value.split(".");
    if (!iv || !encrypted) return null;
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64Url(iv) },
      await sessionKey(),
      fromBase64Url(encrypted),
    );
    return JSON.parse(decoder.decode(decrypted)) as DiscordSession;
  } catch {
    return null;
  }
}

export function discordAvatarUrl(user: DiscordSession["user"]) {
  if (!user.avatar) return null;
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`;
}
