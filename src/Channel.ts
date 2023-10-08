import { Coroutine } from "./Types.js"

/**
 * Channels are used to send and receive messages between coroutines. Channels can be buffered so
 * that senders do not suspend if there isn't a receiver waiting to receive the next message.
 * If there are multiple coroutines receiving on the same channel, they receive new values in first
 * come, first served order.
 */
export interface Channel<T> {
    send(value: T): Coroutine<boolean>
    receive(): Coroutine<T>
    close(): void
}
