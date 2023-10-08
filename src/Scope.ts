import { Job } from "./Job.js"
import { SubScope } from "./SubScope.js"
import { Coroutine } from "./Types.js"

export interface Scope {
    launch(
        coroutine: () => Coroutine<void>,
        coroutineExceptionHandler?: (job: Job, error: unknown) => void
    ): Job

    coroutineScope(
        coroutine: (this: SubScope) => Coroutine<void>,
        coroutineExceptionHandler?: (job: Job, error: unknown) => void
    ): Job

    supervisorScope(
        coroutine: (this: SubScope) => Coroutine<void>,
        coroutineExceptionHandler?: (job: Job, error: unknown) => void
    ): Job
}
