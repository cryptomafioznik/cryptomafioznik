// Thin Telegram Bot API client.
export interface TgEnv {
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_API?: string; // default https://api.telegram.org, overridable for local tests
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  pre_checkout_query?: { id: string; from: { id: number }; currency: string; total_amount: number; invoice_payload: string };
  callback_query?: { id: string; from: { id: number; username?: string }; message?: { chat: { id: number } }; data?: string };
}

export interface TgMessage {
  message_id: number;
  chat: { id: number; type: string };
  from?: { id: number; username?: string; first_name?: string };
  text?: string;
  successful_payment?: { currency: string; total_amount: number; invoice_payload: string; telegram_payment_charge_id: string };
}

export async function tg<T = unknown>(env: TgEnv, method: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${env.TELEGRAM_API ?? "https://api.telegram.org"}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
  if (!json.ok) throw new Error(`telegram ${method}: ${json.description ?? res.status}`);
  return json.result as T;
}

export async function send(env: TgEnv, chatId: number, text: string, extra: Record<string, unknown> = {}): Promise<void> {
  try {
    await tg(env, "sendMessage", { chat_id: chatId, text, disable_web_page_preview: true, ...extra });
  } catch (e) {
    // A blocked bot or deleted chat must not break the cron loop.
    console.log(`send to ${chatId} failed: ${(e as Error).message}`);
  }
}

/** Telegram Stars invoice: currency XTR, no provider token. */
export async function sendStarsInvoice(env: TgEnv, chatId: number, title: string, description: string, payload: string, stars: number): Promise<void> {
  await tg(env, "sendInvoice", {
    chat_id: chatId,
    title,
    description,
    payload,
    currency: "XTR",
    prices: [{ label: title, amount: stars }],
  });
}
