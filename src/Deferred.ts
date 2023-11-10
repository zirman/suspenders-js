import { Coroutine } from "./Types.js"

/**
 * Deferred
 */
export interface Deferred<T> {
    await: () => Coroutine<T>
}
