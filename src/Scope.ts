import { Deferred } from "./Deferred.js"
import { Job } from "./Job.js"
import { Coroutine } from "./Types.js"

/**
 * A Scope is where coroutine instances are launched in.
 */
export interface LaunchScope {
    launch(
        coroutine: () => Coroutine<void>,
        coroutineExceptionHandler?: (job: Job, error: unknown) => void
    ): Job
}

/**
 * A LaunchedCoroutineScope has convenience methods for launching a child coroutineScope.
 */
export interface LaunchCoroutineScope extends LaunchScope {
    launchCoroutineScope(
        coroutine: (this: Scope) => Coroutine<void>,
        coroutineExceptionHandler?: (job: Job, error: unknown) => void
    ): Job

    launchSupervisorScope(
        coroutine: (this: Scope) => Coroutine<void>,
        coroutineExceptionHandler?: (job: Job, error: unknown) => void
    ): Job
}

/**
 * A Scope is used to start a coroutine job that produces a result without suspending the parent
 * coroutine. This is used to start multiple concurrently running coroutines that produce result
 * values. The results are produced in the parent coroutine by calling `yield* deferred.await()`.
 */
export interface Scope extends LaunchScope {
    async<T>(coroutine: () => Coroutine<T>): Deferred<T>
}
