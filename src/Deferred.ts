import { Coroutine } from "./Types.js"

export interface Deferred<T> {
    await: () => Coroutine<T>
}
