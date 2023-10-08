import { Channel } from "./Channel.js"

export interface BufferedChannel<T> extends Channel<T> {
    sendBuffered(value: T): boolean
}
