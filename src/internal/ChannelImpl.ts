import { BufferedChannel } from "../BufferedChannel.js"
import { Channel } from "../Channel.js"
import { suspendCoroutine } from "../Common.js"
import { Coroutine, ResultCallback } from "../Types.js"
import { ChannelClosed } from "./Errors.js"
import { Queue } from "./Queue.js"

export const channel: <T>() => Channel<T> = () => new ChannelImpl()

export const bufferedChannel: <T>(capacity?: number, bufferOverflow?: BufferOverflow) => BufferedChannel<T> =
    (capacity?: number, bufferOverflow?: BufferOverflow) =>
        new BufferedChannelImpl(capacity, bufferOverflow)

class ChannelImpl<T> implements Channel<T> {
    #isClosed = false
    readonly #senders: Queue<() => T> = new Queue()
    readonly #receivers: Queue<ResultCallback<T>> = new Queue()

    close(): void {
        this.#isClosed = true

        const result = { error: ChannelClosed }
        for (; ;) {
            const resultCallback = this.#receivers.dequeue()
            if (resultCallback === null) break
            resultCallback(result)
        }
    }

    * send(value: T): Coroutine<boolean> {
        if (this.#isClosed) return false
        const callback = this.#receivers.dequeue()

        if (callback) {
            // resume receiver
            callback({ value })
        } else {
            // suspend sender
            yield* suspendCoroutine((resultCallback: ResultCallback<void>) => {
                this.#senders.enqueue(() => {
                    resultCallback({ value: undefined })
                    return value
                })
            })
        }
        return true
    }

    * receive(): Coroutine<T> {
        const callback = this.#senders.dequeue()

        if (callback) {
            return callback()
        } else if (this.#isClosed) {
            throw ChannelClosed
        } else {
            return yield* suspendCoroutine((resultCallback) => {
                this.#receivers.enqueue(resultCallback)
            })
        }
    }
}

export enum BufferOverflow {
    /**
     * Drop **the oldest** value in the buffer on overflow, add the new value to the buffer, do not suspend.
     */
    DROP_OLDEST,

    /**
     * Drop **the latest** value that is being added to the buffer right now on buffer overflow
     * (so that buffer contents stay the same), do not suspend.
     */
    DROP_LATEST,

    UNLIMITED
}

class BufferedChannelImpl<T extends NonNullable<any>> implements BufferedChannel<T> {
    #isClosed = false
    readonly #bufferOverflow: BufferOverflow
    readonly #capacity: number
    readonly #buffer: Queue<T> = new Queue()
    readonly #receivers: Queue<ResultCallback<T>> = new Queue()

    constructor(capacity: number = 1, bufferOverflow: BufferOverflow = BufferOverflow.DROP_OLDEST) {
        this.#capacity = capacity
        this.#bufferOverflow = bufferOverflow
    }

    close(): void {
        this.#isClosed = true
        const result = { error: ChannelClosed }

        for (; ;) {
            const resultCallback = this.#receivers.dequeue()
            if (resultCallback === null) break
            resultCallback(result)
        }
    }

    sendBuffered(value: T): boolean {
        const receiver = this.#receivers.dequeue()

        if (receiver) {
            receiver({ value })
            return true
        }

        switch (this.#bufferOverflow) {
            case BufferOverflow.DROP_OLDEST:
                if (this.#buffer.length() >= this.#capacity) {
                    this.#buffer.dequeue()
                }
                break
            case BufferOverflow.DROP_LATEST:
                if (this.#buffer.length() >= this.#capacity) return false
                break
            case BufferOverflow.UNLIMITED:
                break
        }

        this.#buffer.enqueue(value)
        return true
    }

    * send(value: T): Coroutine<boolean> {
        return this.sendBuffered(value)
    }

    * receive(): Coroutine<T> {
        const value = this.#buffer.dequeue()

        if (value) {
            return value
        } else if (this.#isClosed) {
            throw ChannelClosed
        } else {
            return yield* suspendCoroutine((resultCallback) => {
                this.#receivers.enqueue(resultCallback)
            })
        }
    }
}
