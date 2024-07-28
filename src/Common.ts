import { CancelFunction, Coroutine, ResultCallback } from "./Types.js"
import { job } from "./internal/JobImpl.js"
import { Failure } from "./Failure.js"

/**
 * Converts a callback API to a coroutine.
 * @param {<T>(resultCallback: ResultCallback<T>) => void} continuation
 * @return {<T>T}
 */
export function* suspendCoroutine<T>(continuation: (resultCallback: ResultCallback<T>) => void): Coroutine<T> {
    return (yield continuation) as T
}

/**
 * Converts a callback that can be canceled API to a coroutine.
 * @param {<T>(resultCallback: ResultCallback<T>) => CancelFunction} continuation
 * @return {<T>T}
 */
export function* suspendCancellableCoroutine<T>(
    continuation: (resultCallback: ResultCallback<T>) => CancelFunction
): Coroutine<T> {
    return (yield continuation) as T
}

/**
 * Suspends the coroutine for a given number of milliseconds.
 * @param {number} [millis]
 * @return {void}
 */
export function* delay(millis?: number): Coroutine<void> {
    yield (resultCallback: ResultCallback<void>) => {
        const timeout = setTimeout(() => resultCallback(undefined), millis)
        return () => clearTimeout(timeout)
    }
}

/**
 * Checks if the coroutine is still active.
 * @return {void}
 */
export function* ensureActive(): Coroutine<void> {
    yield* job()
}

/**
 * Waits until the coroutine is canceled. Used to keep finally blocks from running until cancellation.
 * @return {never}
 */
export function* awaitCancellation(): Coroutine<never> {
    return yield* suspendCoroutine(() => {
    })
}

/**
 * Converts a Promise<T> to a Coroutine<T>. Promise result that is an error is thrown.
 * @param {<T>Promise<T>} promise
 * @return {<T>T} promiseResult
 */
export function* awaitPromise<T>(promise: Promise<T>): Coroutine<T> {
    return yield* suspendCoroutine((resultCallback) => {
        promise.then(
            (value) => resultCallback(value),
            (error) => resultCallback(new Failure(error)),
        )
    })
}

/**
 * Performs a http get on url and returns the body
 * @param {string} url
 * @return {string} body
 */
export function* httpGet(url: string): Coroutine<string> {
    return yield* suspendCancellableCoroutine((resultCallback) => {
        const xhttp = new XMLHttpRequest()

        xhttp.onloadend = function () {
            if (this.status === 200) {
                resultCallback(this.responseText)
            } else {
                resultCallback(new Failure(
                    new Error(`code: ${this.status} text: ${this.statusText}`),
                ))
            }
        }

        xhttp.open("GET", url, true)
        xhttp.send()

        return () => {
            xhttp.abort()
        }
    })
}

/**
 * Measures how long a coroutine executes for in milliseconds.
 * @param {() => Coroutine<void>} block
 * @return {number} execution time
 */
export function* measureTimeMillis(block: () => Coroutine<void>): Coroutine<number> {
    const start = Date.now()
    yield* block()
    const end = Date.now()
    return end - start
}
