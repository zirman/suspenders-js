import { Channel } from "./Channel.js"

/**
 * BufferedChannel
 */
export interface BufferedChannel<T> extends Channel<T> {
    trySend(value: T): boolean
}
