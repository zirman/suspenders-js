import { Failure } from "./Failure.js"
import { YieldJob } from "./internal/YieldJob.js"

/**
 * Instance of a coroutine.
 */
export type Coroutine<T> = Generator<Yield, T>

/**
 * Data object contains value or error of resolved asynchronous operation.
 */
export type Result<T> = Failure | T

/**
 * Callback function called with result of an asynchronous operation.
 */
export type ResultCallback<T> = (result: Result<T>) => void

/**
 * Function that cancels an asynchronous operation.
 */
export type CancelFunction = () => void

/**
 * Use yield on this in a coroutine to suspend the coroutine on an async task that resolves to T.
 * If in TypeScript use yield* suspend(Suspender<T>) to help the type checker get the resolved type.
 */
export type Yield = YieldAsync | YieldAsyncNonCancellable | typeof YieldJob

type YieldAsync = (s: ResultCallback<unknown>) => CancelFunction
type YieldAsyncNonCancellable = (s: ResultCallback<unknown>) => void
