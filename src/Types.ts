import { Scope } from "./Scope"

/**
 * Use yield on this in a coroutine to suspend the coroutine on an async task that resolves to T.
 * If in TypeScript use yield* suspend(Suspender<T>) to help the type checker get the resolved type.
 */
export type Suspender<T> = (s: ResultCallback<T>) => (CancelFunction | void)

/**
 * Data object contains value or error of resolved async task.
 */
export type Result<T> = Readonly<{ tag: `error`, error: unknown } | { tag?: `value`, value: T }>

/**
 * Callback when async task resolves.
 */
export type ResultCallback<T> = (result: Result<T>) => void

/**
 * Cancels an async task.
 */
export type CancelFunction = () => void

/**
 * Instantiated coroutine.
 */
export type Coroutine<T> = Generator<Suspender<unknown>, T, unknown>

/**
 * Call Scope.launch(CoroutineFactory<T>) to instantiate a Coroutine.
 */
export type CoroutineFactory<T> = (this: Scope) => Coroutine<T>

/**
 * Use yield* on this in a coroutine, to start an async task that resolves a T.
 */
export type CoroutineSuspender<T> = Generator<Suspender<T>, T, unknown>

/**
 * Observer interface is implemented by objects that observe values emitted from an upstream Flow.
 */
export interface Observer<T> {
  emit(value: T): void
}