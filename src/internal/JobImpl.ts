import { Deferred } from "../Deferred.js"
import { Job } from "../Job.js"
import { LaunchCoroutineScope, Scope } from "../Scope.js"
import { CancelFunction, Coroutine, Result, ResultCallback, Yield } from "../Types.js"
import { debug } from "./Config.js"
import { YieldJob } from "./YieldJob.js"
import { Failure } from "../Failure.js"

enum JOB_STATE {
    RUNNING, // Initial state. Job will continue to run normally until an error or has completed it's work.
    COMPLETING, // Transitional state when job has finished it's work and is waiting for children to complete.
    COMPLETED, // Final state. Job and it's children are finished. Adding additional jobs will not start them.
}

abstract class JobImpl implements Job {
    readonly #id: string = Math.random().toString(36).substring(7)
    #state: JOB_STATE = JOB_STATE.RUNNING
    readonly #parent: JobImpl | null
    #children: Set<JobImpl> | null = null
    readonly #coroutineExceptionHandler: ((job: Job, error: unknown) => void) | null
    protected children: ReadonlySet<JobImpl> | null = this.#children

    constructor(
        parent: JobImpl | null = null,
        coroutineExceptionHandler: ((job: Job, error: unknown) => void) | null = null,
    ) {
        this.#parent = parent
        this.#coroutineExceptionHandler = coroutineExceptionHandler
        parent?.addChild(this)
    }

    isActive(): boolean {
        return !(this.#state === JOB_STATE.COMPLETED)
    }

    cancel(): boolean {
        if (debug) console.log(`${this} ${this.constructor.name}.cancel()`)
        if (this.#state === JOB_STATE.COMPLETED) return false
        if (this.#state !== JOB_STATE.COMPLETING) this.completing()

        if (this.children !== null) {
            for (const job of this.children) {
                job.cancel()
            }
        }

        // @ts-ignore
        if (this.#state !== JOB_STATE.COMPLETED) {
            this.#parent?.completeChild(this)
            this.#state = JOB_STATE.COMPLETED
        }

        return true
    }

    protected isRunning(): boolean {
        return this.#state === JOB_STATE.RUNNING
    }

    protected isCompleting(): boolean {
        return this.#state === JOB_STATE.COMPLETING
    }

    protected completing() {
        if (debug) console.log(`${this} ${this.constructor.name}.completing()`)
        if (this.#state !== JOB_STATE.RUNNING) throw new Error()
        this.#state = JOB_STATE.COMPLETING
    }

    protected complete() {
        if (debug) console.log(`${this} ${this.constructor.name}.complete()`)
        if (this.#state !== JOB_STATE.COMPLETING) throw new Error()
        this.#parent?.completeChild(this)
        this.#state = JOB_STATE.COMPLETED
    }

    protected throwError(error: unknown) {
        if (debug) console.log(`${this} ${this.constructor.name}.throwError(${JSON.stringify(error)})`)
        if (this.#state === JOB_STATE.COMPLETED) throw new Error()
        if (this.#state !== JOB_STATE.COMPLETING) this.completing()

        if (this.children !== null) {
            for (const job of this.children) {
                job.cancel()
            }
        }

        if (this.#coroutineExceptionHandler !== null) {
            this.#coroutineExceptionHandler(this, error)
            // @ts-ignore
        } else if (this.#state !== JOB_STATE.COMPLETED) {
            this.#parent?.throwErrorChild(this, error)
            this.#state = JOB_STATE.COMPLETED
        }
    }

    protected completeChild(child: JobImpl) {
        if (debug) console.log(`${this} ${this.constructor.name}.completeChild(${child})`)
        if (this.#state === JOB_STATE.COMPLETED) throw new Error()
        if (!this.removeChild(child)) throw new Error()
        if (this.#state === JOB_STATE.COMPLETING && (this.children?.size ?? 0) === 0) this.complete()
    }

    protected throwErrorChild(child: JobImpl, error: unknown) {
        if (debug) console.log(`${this} ${this.constructor.name}.throwErrorChild(${child}, ${JSON.stringify(error)})`)
        if (this.#state === JOB_STATE.COMPLETED) throw new Error()
        if (!this.removeChild(child)) throw new Error()
        this.throwError(error)
    }

    protected addChild(child: JobImpl) {
        if (this.#children !== null) {
            this.#children.add(child)
        } else {
            this.#children = new Set()
            this.#children.add(child)
            this.children = this.#children
        }
    }

    protected removeChild(child: JobImpl): boolean {
        return this.#children?.delete(child) ?? false
    }

    toString(): string {
        let joined = ""
        for (const job of this.children ?? new Set()) {
            joined += `${job.toString()}`
        }
        return `${this.constructor.name}@${this.#id}{${this.#state}}{${joined}}`
    }
}

abstract class BaseCoroutineJob<T> extends JobImpl implements Job {
    protected abstract readonly coroutine: Coroutine<T>
    #cancelCallback: CancelFunction | null = null
    #stackDepth = 0

    protected abstract setResult(result: Result<T>): void

    protected resumeWith(result: Result<unknown>) {
        try {
            this.#stackDepth++
            if (debug) console.log(`${this} ${this.constructor.name}.resumeWith() ${JSON.stringify(result)}`)
            if (!this.isRunning()) return

            // Reached limit on resuming this coroutine on this stack. Resume with a clear stack.
            if (this.#stackDepth >= 1000) {
                setTimeout(() => this.resumeWith(result))
                return
            }

            let iteratorResult

            try {
                if (result instanceof Failure) {
                    iteratorResult = this.coroutine.throw(result.value)
                } else {
                    iteratorResult = this.coroutine.next(result)
                }
            } catch (error) {
                // New child that throws an error could have stopped this coroutine.
                if (this.isRunning()) {
                    this.throwError(error)
                }
                return
            }

            // New child that throws an error could have stopped this coroutine.
            if (!this.isRunning()) return

            // completed with result
            if (iteratorResult.done) {
                this.completing()
                this.setResult(iteratorResult.value)
                if ((this.children?.size ?? 0) === 0) this.complete()
                return
            }

            // suspension point
            if (iteratorResult.value === YieldJob) {
                this.resumeWith(this)
            } else {
                let isCalledOnce = false
                this.#cancelCallback = iteratorResult.value((result) => {
                    // guard against suspension point calling back more than once
                    if (isCalledOnce) return
                    isCalledOnce = true
                    // don't trust that a canceled operation doesn't call back
                    if (this.isRunning()) this.resumeWith(result)
                }) ?? null
            }
        } finally {
            this.#stackDepth--
        }
    }

    protected override completing() {
        super.completing()

        // cancel pending async operation
        if (this.#cancelCallback !== null) {
            this.#cancelCallback()
            this.#cancelCallback = null
        }

        // TODO: Make this only run when coroutine has not yet completed.
        const runFinallyBlocks = () => {
            let iteratorResult: IteratorResult<Yield, T>
            try {
                iteratorResult = this.coroutine.return(null as any) // we return null instead of T since it is not used
            } catch (error) {
                // In the unlikely scenario that a child coroutine throws an error before yielding, error is thrown.
                // To run finally blocks in this coroutine, the current coroutine instance needs to finish running.
                // Finally blocks for this coroutine will be run in setTimeout().
                if (error instanceof TypeError && error.message === "Generator is already running") {
                    setTimeout(runFinallyBlocks)
                    return
                }
                console.log(`Error thrown while running finally blocks ${error}`)
                return
            }

            // Move coroutine to GlobalScope when completing this job if it is not done. This allows completing() to be
            // called on child coroutines and not cause a generator to be resumed more than once in the current stack.
            if (!iteratorResult.done) {
                let _iteratorResult: IteratorResult<Yield, T> = iteratorResult
                const coroutine = this.coroutine

                GlobalScope.launch(function* (): Coroutine<void> {
                    do {
                        _iteratorResult = coroutine.next(yield _iteratorResult.value as Yield)
                    } while (!_iteratorResult.done)
                })
            }
        }

        runFinallyBlocks()
    }
}

class CoroutineJob<T> extends BaseCoroutineJob<T> {
    protected override readonly coroutine: Coroutine<T>

    constructor(
        parent: JobImpl, coroutine: () => Coroutine<T>,
        coroutineExceptionHandler?: (job: Job, error: unknown) => void,
    ) {
        super(parent, coroutineExceptionHandler)
        this.coroutine = coroutine()
        this.resumeWith(undefined)
    }

    override setResult(_: Result<T>) {
    }
}

abstract class BaseDeferred<T> extends BaseCoroutineJob<T> implements Job {
    protected result: Result<T> | null = null
    protected resultCallback: Set<ResultCallback<T>> | null = null

    protected override setResult(result: Result<T>) {
        this.result = result
    }

    protected* _await(): Coroutine<T> {
        if (this.result !== null) {
            if (this.result instanceof Failure) {
                throw this.result.value
            } else {
                return this.result
            }
        } else {
            return (yield (resultCallback: ResultCallback<T>) => {
                if (this.resultCallback === null) {
                    this.resultCallback = new Set()
                }

                this.resultCallback.add(resultCallback)
            }) as T
        }
    }

    protected resumeAwait() {
        // Should only be called if setResult() was already called.
        if (this.result === null) throw new Error()
        if (this.resultCallback !== null) {
            for (const resultCallback of this.resultCallback) {
                resultCallback(this.result)
            }
            this.resultCallback = null
        }
    }

    override throwError(error: unknown) {
        super.throwError(error)
        this.setResult(new Failure(error))
    }
}

/**
 * Coroutine Job that will with result value in yield* job.await()
 */
class DeferredImpl<T> extends BaseDeferred<T> implements Deferred<T>, Job {
    protected readonly coroutine: Coroutine<T>

    constructor(parent: JobImpl, coroutine: () => Coroutine<T>) {
        super(parent)
        this.coroutine = coroutine()
        this.resumeWith(undefined)
    }

    protected override setResult(result: Result<T>) {
        if (debug) console.log(`${this} ${this.constructor.name}.setResult(${JSON.stringify(result)})`)
        super.setResult(result)
        this.resumeAwait()
    }

    * await(): Coroutine<T> {
        return yield* this._await()
    }
}

class NullJob implements Job {
    private constructor() {
    }

    cancel(): boolean {
        return false;
    }

    isActive(): boolean {
        return false;
    }

    static instance = new NullJob()
}

class CoroutineScopeImpl extends JobImpl implements Job, LaunchCoroutineScope {

    constructor(coroutineExceptionHandler?: (job: Job, error: unknown) => void) {
        super(null, coroutineExceptionHandler)
    }

    launch(coroutine: () => Coroutine<void>, coroutineExceptionHandler?: (job: Job, error: unknown) => void): Job {
        if (!this.isActive()) return NullJob.instance
        return new CoroutineJob(this, coroutine, coroutineExceptionHandler)
    }

    launchCoroutineScope(
        coroutine: (this: Scope) => Coroutine<void>,
        coroutineExceptionHandler?: (job: Job, error: unknown) => void
    ): Job {
        return this.launch(function* () {
            yield* coroutineScope(coroutine, coroutineExceptionHandler)
        })
    }

    launchSupervisorScope(
        coroutine: (this: Scope) => Coroutine<void>,
        coroutineExceptionHandler?: (job: Job, error: unknown) => void
    ): Job {
        return this.launch(function* () {
            yield* supervisorScope(coroutine, coroutineExceptionHandler)
        })
    }
}

/**
 * Constructor for a CoroutineScope. It is used to run a group of coroutines that can are canceled
 * together. If a child job throws an uncaught error, it will cancel this scope immediately.
 * However if a coroutineExceptionHandler is provided, it is invoked with the job and error that
 * was thrown instead.
 * @param {(job: Job, error: unknown) => void} [coroutineExceptionHandler]
 * @return {LaunchCoroutineScope & Job}
 */
export const CoroutineScope: (coroutineExceptionHandler?: (job: Job, error: unknown) => void) => LaunchCoroutineScope & Job =
    (coroutineExceptionHandler) => {
        return new CoroutineScopeImpl(coroutineExceptionHandler)
    }

class SupervisorScopeImpl extends CoroutineScopeImpl implements LaunchCoroutineScope, Job {
    protected override throwErrorChild(child: JobImpl, error: unknown) {
        if (debug) console.log(`${this} ${this.constructor.name}.throwErrorChild(${child}, ${JSON.stringify(error)})`)
        if (!this.removeChild(child)) throw new Error()
    }
}

/**
 * Constructor for a SupervisorScope. Used to run coroutines that can be canceled as a group. Child Jobs that throw an
 * uncaught error will cancel this scope immediately.
 * @param {(job: Job, error: unknown) => void} [coroutineExceptionHandler]
 * @return {LaunchCoroutineScope & Job}
 */
export const SupervisorScope: (coroutineExceptionHandler?: (job: Job, error: unknown) => void) => LaunchCoroutineScope & Job =
    (coroutineExceptionHandler) => {
        return new SupervisorScopeImpl(coroutineExceptionHandler)
    }

class GlobalScopeImpl extends SupervisorScopeImpl {
    static instance = new GlobalScopeImpl()

    override cancel(): boolean {
        return false
    }

    private constructor() {
        super()
    }
}

export const GlobalScope = GlobalScopeImpl.instance

/**
 * Coroutine Job who results can be yield* job.await() and does wait for all it's children to complete
 */
class ScopeImpl<T> extends BaseDeferred<T> implements Scope {
    protected readonly coroutine: Coroutine<T>

    constructor(
        parent: JobImpl,
        coroutine: (this: Scope) => Coroutine<T>,
        coroutineExceptionHandler?: (job: Job, error: unknown) => void,
    ) {
        super(parent, coroutineExceptionHandler)
        this.coroutine = coroutine.call(this)
        this.resumeWith(undefined)
    }

    launch(coroutine: () => Coroutine<void>, coroutineExceptionHandler?: ((job: Job, error: unknown) => void)): Job {
        if (!this.isActive()) return NullJob.instance
        return new CoroutineJob(this, coroutine, coroutineExceptionHandler)
    }

    async<T>(coroutine: () => Coroutine<T>): Deferred<T> {
        return new DeferredImpl(this, coroutine)
    }

    launchCoroutineScope(coroutine: (this: Scope) => Coroutine<void>): Job {
        return this.launch(function* () {
            yield* coroutineScope(coroutine)
        })
    }

    launchSupervisorScope(coroutine: (this: Scope) => Coroutine<void>): Job {
        return this.launch(function* () {
            yield* supervisorScope(coroutine)
        })
    }

    protected override complete() {
        if (debug) console.log(`${this} ${this.constructor.name}.complete()`)
        super.complete()
        this.resumeAwait()
    }

    protected override* _await(): Coroutine<T> {
        if (!this.isActive() && this.result !== null) {
            if (this.result instanceof Failure) {
                throw this.result.value
            } else {
                return this.result
            }
        } else {
            return (yield (resultCallback: ResultCallback<T>) => {
                if (this.resultCallback === null) {
                    this.resultCallback = new Set()
                }

                this.resultCallback.add(resultCallback)
            }) as T
        }
    }

    override throwError(error: unknown) {
        if (debug) console.log(`${this} ${this.constructor.name}.throwError(${JSON.stringify(error)})`)
        if (!this.isActive()) throw new Error()
        if (!this.isCompleting()) this.completing()

        if (this.children !== null) {
            for (const job of this.children) {
                job.cancel()
            }
        }

        this.setResult(new Failure(error))
        this.complete()
    }

    static* coroutineScope<T>(
        coroutine: (this: Scope) => Coroutine<T>,
        coroutineExceptionHandler?: (job: Job, error: unknown) => void,
    ): Coroutine<T> {
        return yield* new ScopeImpl(yield* job(), coroutine, coroutineExceptionHandler)._await()
    }
}

/**
 * Calls a coroutine with a coroutine scope bound to `this`.
 * @param {<T>(this: Scope) => Coroutine<T>} coroutine
 * @return {<T>T}
 */
export const coroutineScope = ScopeImpl.coroutineScope

/**
 * Constructor for a SupervisorScope. Used to run coroutines that can be canceled as a group. SupervisorScopes do not
 * complete when their children jobs throw errors.
 * @return {SupervisorScopeImpl}
 */
class SubScopeImpl<T> extends ScopeImpl<T> implements CoroutineScopeImpl, Job {
    protected override throwErrorChild(child: JobImpl, error: unknown) {
        if (debug) console.log(`${this} ${this.constructor.name}.throwErrorChild(${child}, ${error})`)
        if (!this.removeChild(child)) throw new Error()
        if (this.isCompleting() && (this.children?.size ?? 0) === 0) this.complete()
    }

    static* supervisorScope<T>(
        coroutine: (this: Scope) => Coroutine<T>,
        coroutineExceptionHandler?: (job: Job, error: unknown) => void,
    ): Coroutine<T> {
        return yield* new SubScopeImpl(yield* job(), coroutine, coroutineExceptionHandler)._await()
    }
}

/**
 * Calls a coroutine with a supervisor scope bound to `this`.
 * @param {<T>(this: Scope) => Coroutine<T>} coroutine
 * @return {<T>T}
 */
export const supervisorScope = SubScopeImpl.supervisorScope

export function* job(): Coroutine<JobImpl> {
    return (yield YieldJob) as JobImpl
}
