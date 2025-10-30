import type { SeamEvent } from '@seamapi/types/connect'
import { Webhook } from 'svix'

export class SeamWebhook {
  readonly #webhook: Webhook

  constructor(secret: string) {
    this.#webhook = new Webhook(secret)
  }

  verify(payload: string, headers: Record<string, string>): SeamEvent {
    const normalizedHeaders = Object.fromEntries(
      Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
    )

    return this.#webhook.verify(payload, normalizedHeaders) as SeamEvent
  }
}
