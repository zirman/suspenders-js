import { ensureActive, suspendCancellableCoroutine } from "../Common.js"
import { Flow } from "../Flow.js"
import { Job } from "../Job.js"
import { MutableSharedFlow } from "../MutableSharedFlow.js"
import { MutableStateFlow } from "../MutableStateFlow.js"
import { Scope } from "../Scope.js"
import { Coroutine } from "../Types.js"
import { channel } from "./ChannelImpl.js"
import { ChannelClosed, ConcurrentWrite, NoSuchElementException } from "./Errors.js"
import { coroutineScope, job } from "./JobImpl.js"
import { Queue } from "./Queue.js"

abstract class BaseFlowImpl<T> implements Flow<T> {
    * first(predicate?: (value: T) => boolean): Coroutine<T> {
        try {
            return yield* this.collector(predicate
                ? function* (collect) {
                    try {
                        for (; ;) {
                            const value = yield* collect()
                            if (predicate(value)) {
                                return value
                            }
                        }
                    } catch (error) {
                        if (error !== ChannelClosed) throw error
                        throw NoSuchElementException
                    }
                }
                : function* (collect) {
                    try {
                        return yield* collect()
                    } catch (error) {
                        if (error !== ChannelClosed) throw error
                        throw NoSuchElementException
                    }
                }
            )
        } catch (error) {
            throw error
        }
    }

    * last(): Coroutine<T> {
        return yield* this.collector(function* (collect) {
            try {
                let value = yield* collect()

                try {
                    for (; ;) {
                        value = yield* collect()
                    }
                } catch (error) {
                    if (error !== ChannelClosed) throw error
                }

                return value
            } catch (error) {
                if (error !== ChannelClosed) throw error
                throw NoSuchElementException
            }
        })
    }

    * lastOrNull(): Coroutine<T | null> {
        return yield* this.collector(function* (collect) {
            try {
                let value = yield* collect()

                try {
                    for (; ;) {
                        value = yield* collect()
                    }
                } catch (error) {
                    if (error !== ChannelClosed) throw error
                }

                return value
            } catch (error) {
                if (error !== ChannelClosed) throw error
                return null
            }
        })
    }

    transform<R>(transformer: (inValue: T, emit: (outValue: R) => Coroutine<void>) => Coroutine<void>): Flow<R> {
        return new TransformFlow(this, transformer)
    }

    transformLatest<R>(transformer: (inValue: T, emit: (outValue: R) => Coroutine<void>) => Coroutine<void>): Flow<R> {
        return new TransformLatestFlow(this, transformer)
    }

    transformWhile<R>(transformer: (inValue: T, emit: (outValue: R) => Coroutine<void>) => Coroutine<boolean>): Flow<R> {
        return new TransformWhileFlow(this, transformer)
    }

    map<R>(collector: (value: T) => (void | Coroutine<R>)): Flow<R> {
        return new MapFlow(this, collector)
    }

    mapLatest<R>(collector: (value: T) => Coroutine<R>): Flow<R> {
        return new MapLatestFlow<T, R>(this, collector)
    }

    mapNotNull<R>(mapper: (value: T) => ((R | null) | Coroutine<R | null>)): Flow<R> {
        return new MapNotNullFlow(this, mapper)
    }

    flatMapConcat<R>(collector: (value: T) => (Flow<R> | Coroutine<Flow<R>>)): Flow<R> {
        return new FlatMapFlow(this, collector)
    }

    flatMapLatest<R>(collector: (value: T) => (Flow<R> | Coroutine<Flow<R>>)): Flow<R> {
        return new FlatMapLatestFlow(this, collector)
    }

    flatMapMerge<R>(collector: (value: T) => (Flow<R> | Coroutine<Flow<R>>)): Flow<R> {
        return new FlatMapMergeFlow(this, collector)
    }

    onEach(run: (value: T) => (void | Coroutine<void>)): Flow<T> {
        return new OnEachFlow(this, run)
    }

    onCompletion(emitter: (emit: (value: T) => (void | Coroutine<void>), error?: unknown) => Coroutine<void>): Flow<T> {
        return new OnCompleteFlow(this, emitter)
    }

    onEmpty(emitter: (emit: (value: T) => (void | Coroutine<void>)) => Coroutine<void>): Flow<T> {
        return new OnEmptyFlow(this, emitter)
    }

    onStart(emitter: (emit: (value: T) => (void | Coroutine<void>)) => Coroutine<void>): Flow<T> {
        return new OnStartFlow(this, emitter)
    }

    catch(coroutineErrorHandler: (error: unknown) => (void | Coroutine<void>)): Flow<T> {
        return new CatchFlow(this, coroutineErrorHandler)
    }

    * collectIndexed(collector: (index: number, value: T) => (void | Coroutine<void>)): Coroutine<void> {
        let index = 0

        let c: (index: number, value: T) => (void | Coroutine<void>)

        if (collector.constructor.name !== "GeneratorFunction") {
            c = function* (index, value) {
                collector(index, value)
            }
        } else {
            c = collector as (index: number, value: T) => Coroutine<void>
        }

        yield* this.collect(function* (value) {
            yield* c(index, value)
            index++
        })
    }

    launchIn(scope: Scope): void {
        const that = this
        scope.launch(function* () {
            yield* that.collect()
        })
    }

    abstract collect(collector?: (value: T) => (void | Coroutine<void>)): Coroutine<void>

    abstract collectLatest(collector: (value: T) => Coroutine<void>): Coroutine<void>

    * collector<R>(collector: (collect: () => Coroutine<T>) => Coroutine<R>): Coroutine<R> {
        const that = this
        const chan = channel<T>()

        return yield* coroutineScope(function* () {
            const job = this.launch(function* () {
                try {
                    yield* that.collect(function* (value: T) {
                        yield* chan.send(value)
                    })
                } finally {
                    chan.close()
                }
            })

            const ret = yield* collector(function* () {
                return yield* chan.receive()
            })
            job.cancel()
            return ret
        })
    }
}

class TransformWhileFlow<T, R> extends BaseFlowImpl<R> {
    readonly #previousFlow: Flow<T>
    readonly #transformer: (inValue: T, emit: (outValue: R) => Coroutine<void>) => Coroutine<boolean>

    constructor(previousFlow: Flow<T>, transformer: (inValue: T, emit: (outValue: R) => Coroutine<void>) => Coroutine<boolean>) {
        super()
        this.#previousFlow = previousFlow
        this.#transformer = transformer
    }

    override* collect(collector?: (value: R) => (void | Coroutine<void>)): Coroutine<void> {
        const previousFlow = this.#previousFlow
        const transformer = this.#transformer
        const c = unifyCollector(collector)
        yield* coroutineScope(function* () {
            this.launch(function* () {
                yield* previousFlow.collect(function* (value) {
                    if (!(yield* transformer(value, c))) {
                        // cancel() within a coroutine that does not produce a result will complete the outer scope
                        (yield* job()).cancel()
                        yield* ensureActive()
                    }
                })
            })
        })
    }

    override* collectLatest(collector: (value: R) => Coroutine<void>): Coroutine<void> {
        const transformer = this.#transformer

        yield* this.#previousFlow.collector(function* (collect) {
            yield* flow<R>(function* (emit) {
                try {
                    for (; ;) {
                        if (!(yield* transformer(yield* collect(), emit))) {
                            break
                        }
                    }
                } catch (error) {
                    if (error !== ChannelClosed) throw error
                }
            }).collectLatest(collector)
        })
    }
}

class TransformFlow<T, R> extends BaseFlowImpl<R> {
    readonly #previousFlow: Flow<T>
    readonly #transformer: (inValue: T, emit: (outValue: R) => Coroutine<void>) => Coroutine<void>

    constructor(previousFlow: Flow<T>, transformer: (inValue: T, emit: (outValue: R) => Coroutine<void>) => Coroutine<void>) {
        super()
        this.#previousFlow = previousFlow
        this.#transformer = transformer
    }

    override* collect(collector?: (value: R) => (void | Coroutine<void>)): Coroutine<void> {
        const transformer = this.#transformer
        const c = unifyCollector(collector)
        yield* this.#previousFlow.collect(function* (value) {
            yield* transformer(value, c)
        })
    }

    override* collectLatest(collector: (value: R) => Coroutine<void>): Coroutine<void> {
        const transformer = this.#transformer

        yield* this.#previousFlow.collectLatest(collector
            ? function* (value) {
                yield* transformer(value, collector)
            }
            : function* (value) {
                yield* transformer(value, function* () {
                })
            }
        )
    }
}

class TransformLatestFlow<T, R> extends BaseFlowImpl<R> {
    readonly #previousFlow: Flow<T>
    readonly #transformer: (inValue: T, emit: (outValue: R) => Coroutine<void>) => Coroutine<void>

    constructor(previousFlow: Flow<T>, transformer: (inValue: T, emit: (outValue: R) => Coroutine<void>) => Coroutine<void>) {
        super()
        this.#previousFlow = previousFlow
        this.#transformer = transformer
    }

    override* collect(collector?: (value: R) => (void | Coroutine<void>)): Coroutine<void> {
        const transformer = this.#transformer
        const c = unifyCollector(collector)
        yield* this.#previousFlow.collectLatest(function* (value) {
            yield* transformer(value, c)
        })
    }

    override* collectLatest(collector: (value: R) => Coroutine<void>): Coroutine<void> {
        const transformer = this.#transformer

        yield* this.#previousFlow.collectLatest(collector
            ? function* (value) {
                yield* transformer(value, collector)
            }
            : function* (value) {
                yield* transformer(value, function* () {
                })
            }
        )
    }
}

class MapNotNullFlow<T, R extends NonNullable<any>> extends BaseFlowImpl<R> {
    readonly #previousFlow: Flow<T>
    readonly #mapper: (value: T) => Coroutine<R | null>

    constructor(previousFlow: Flow<T>, mapper: (value: T) => ((R | null) | Coroutine<R | null>)) {
        super()
        this.#previousFlow = previousFlow

        if (mapper.constructor.name === "GeneratorFunction") {
            this.#mapper = mapper as (value: T) => Coroutine<R | null>
        } else {
            this.#mapper = function* (value) {
                return mapper(value) as R | null
            }
        }
    }

    override* collect(collector?: (value: R) => (void | Coroutine<void>)): Coroutine<void> {
        const mapper = this.#mapper
        const c = unifyCollector(collector)
        yield* this.#previousFlow.collect(
            function* (inValue) {
                const outValue = yield* mapper(inValue)
                if (outValue !== null) {
                    yield* c(outValue)
                }
            }
        )
    }

    override* collectLatest(collector: (value: R) => Coroutine<void>): Coroutine<void> {
        const mapper = this.#mapper

        yield* this.#previousFlow.collectLatest(function* (inValue) {
            const outValue = yield* mapper(inValue)
            if (outValue !== null) {
                yield* collector(outValue)
            }
        })
    }
}

class OnEmptyFlow<T> extends BaseFlowImpl<T> {
    readonly #previousFlow: Flow<T>
    readonly #emitter: (emit: (value: T) => Coroutine<void>) => Coroutine<void>

    constructor(previousFlow: Flow<T>, emitter: (emit: (value: T) => (void | Coroutine<void>)) => Coroutine<void>) {
        super()
        this.#previousFlow = previousFlow
        if (emitter.constructor.name === "GeneratorFunction") {
            this.#emitter = emitter
        } else {
            this.#emitter = function* (value) {
                emitter(value)
            }
        }
    }

    override* collect(collector?: (value: T) => (void | Coroutine<void>)): Coroutine<void> {
        let isEmpty = true
        const c = unifyCollector(collector)

        yield* this.#previousFlow.collect(function* (value) {
            isEmpty = false
            yield* c(value)
        })

        if (isEmpty) {
            yield* this.#emitter(c)
        }
    }

    override* collectLatest(collector: (value: T) => Coroutine<void>): Coroutine<void> {
        this.#emitter(collector)
        yield* this.#previousFlow.collectLatest(collector)
    }
}

class OnStartFlow<T> extends BaseFlowImpl<T> {
    readonly #previousFlow: Flow<T>
    readonly #emitter: (emit: (value: T) => Coroutine<void>) => Coroutine<void>

    constructor(previousFlow: Flow<T>, emitter: (emit: (value: T) => (void | Coroutine<void>)) => Coroutine<void>) {
        super()
        this.#previousFlow = previousFlow
        if (emitter.constructor.name === "GeneratorFunction") {
            this.#emitter = emitter
        } else {
            this.#emitter = function* (value) {
                emitter(value)
            }
        }
    }

    override* collect(collector?: (value: T) => (void | Coroutine<void>)): Coroutine<void> {
        const c = unifyCollector(collector)
        yield* this.#emitter(c)
        yield* this.#previousFlow.collect(c)
    }

    override* collectLatest(collector: (value: T) => Coroutine<void>): Coroutine<void> {
        this.#emitter(collector)
        yield* this.#previousFlow.collectLatest(collector)
    }
}

class OnCompleteFlow<T> extends BaseFlowImpl<T> {
    readonly #previousFlow: Flow<T>
    readonly #emitter: (emit: (value: T) => Coroutine<void>, error?: unknown) => Coroutine<void>

    constructor(previousFlow: Flow<T>, emitter: (emit: (value: T) => (void | Coroutine<void>), error?: unknown) => Coroutine<void>) {
        super()
        this.#previousFlow = previousFlow
        if (emitter.constructor.name === "GeneratorFunction") {
            this.#emitter = emitter as (emit: (value: T) => Coroutine<void>, error?: unknown) => Coroutine<void>
        } else {
            this.#emitter = function* (value) {
                emitter(value)
            }
        }
    }

    override* collect(collector?: (value: T) => (void | Coroutine<void>)): Coroutine<void> {
        let error: unknown
        const c = unifyCollector(collector)

        try {
            yield* this.#previousFlow.collect(c)
        } catch (err) {
            error = err
        }

        yield* this.#emitter(c, error)
    }

    override* collectLatest(collector: (value: T) => Coroutine<void>): Coroutine<void> {
        let error: unknown

        try {
            yield* this.#previousFlow.collectLatest(collector)
        } catch (err) {
            error = err
        }

        this.#emitter(collector, error)
    }
}

class CatchFlow<T> extends BaseFlowImpl<T> {
    readonly #previousFlow: Flow<T>
    readonly #coroutineExceptionHandler: (value: unknown) => Coroutine<void>

    constructor(previousFlow: Flow<T>, coroutineExceptionHandler: (error: unknown) => (void | Coroutine<void>)) {
        super()
        this.#previousFlow = previousFlow
        if (coroutineExceptionHandler.constructor.name === "GeneratorFunction") {
            this.#coroutineExceptionHandler = coroutineExceptionHandler as (value: unknown) => Coroutine<void>
        } else {
            this.#coroutineExceptionHandler = function* (error) {
                coroutineExceptionHandler(error)
            }
        }
    }

    override* collect(collector?: (value: T) => (void | Coroutine<void>)): Coroutine<void> {
        try {
            yield* this.#previousFlow.collect(unifyCollector(collector))
        } catch (error) {
            yield* this.#coroutineExceptionHandler(error)
        }
    }

    override* collectLatest(collector: (value: T) => Coroutine<void>): Coroutine<void> {
        try {
            yield* this.#previousFlow.collectLatest(collector)
        } catch (error) {
            yield* this.#coroutineExceptionHandler(error)
        }
    }
}

class OnEachFlow<T> extends BaseFlowImpl<T> {
    readonly #previousFlow: Flow<T>
    readonly #run: (value: T) => Coroutine<void>

    constructor(previousFlow: Flow<T>, run: (value: T) => (void | Coroutine<void>)) {
        super()
        this.#previousFlow = previousFlow
        if (run.constructor.name === "GeneratorFunction") {
            this.#run = run as (value: T) => Coroutine<void>
        } else {
            this.#run = function* (value) {
                run(value)
            }
        }
    }

    override* collect(collector?: (value: T) => (void | Coroutine<void>)): Coroutine<void> {
        const run = this.#run
        const c = unifyCollector(collector)
        yield* this.#previousFlow.collect(function* (value) {
            yield* run(value)
            yield* c(value)
        })
    }

    override* collectLatest(collector: (value: T) => Coroutine<void>): Coroutine<void> {
        const run = this.#run

        yield* this.#previousFlow.collectLatest(function* (value) {
            yield* run(value)
            yield* collector(value)
        })
    }
}

class FlowOf<T> extends BaseFlowImpl<T> {
    readonly #values: T[]

    constructor(...vararg: T[]) {
        super()
        this.#values = vararg
    }

    override* collect(collector?: (value: T) => (void | Coroutine<void>)): Coroutine<void> {
        const c = unifyCollector(collector)
        for (const i of this.#values) {
            yield* c(i)
        }
    }

    override* collectLatest(collector: (value: T) => Coroutine<void>): Coroutine<void> {
        if (this.#values.length > 0) {
            yield* collector(this.#values[this.#values.length - 1]!)
        }
    }
}

class FlowEmit<T> extends BaseFlowImpl<T> {
    readonly #previousFlow: (emit: (value: T) => Coroutine<void>) => Coroutine<void>

    constructor(previousFlow: (emit: (value: T) => Coroutine<void>) => Coroutine<void>) {
        super()
        this.#previousFlow = previousFlow
    }

    override* collect(collector?: (value: T) => (void | Coroutine<void>)): Coroutine<void> {
        yield* this.#previousFlow(unifyCollector(collector))
    }

    override* collectLatest(collector: (value: T) => Coroutine<void>): Coroutine<void> {
        const previousFlow = this.#previousFlow
        yield* coroutineScope(function* () {
            const chan = channel<T>()

            this.launch(function* () {
                yield* previousFlow(function* (value) {
                    yield* chan.send(value)
                })
                chan.close()
            })

            let job: Job | null = null
            try {
                for (; ;) {
                    const x = yield* chan.receive()
                    job?.cancel()
                    job = this.launch(function* () {
                        yield* collector(x)
                    })
                }
            } catch (error) {
                if (error !== ChannelClosed) throw error
            }
        })
    }
}

class FlatMapFlow<T, R> extends BaseFlowImpl<R> {
    readonly #previousFlow: Flow<T>
    readonly #flatMapper: (value: T) => Coroutine<Flow<R>>

    constructor(previousFlow: Flow<T>, flatMapper: (value: T) => (Flow<R> | Coroutine<Flow<R>>)) {
        super()
        this.#previousFlow = previousFlow
        if (flatMapper.constructor.name === "GeneratorFunction") {
            this.#flatMapper = flatMapper as (value: T) => Coroutine<Flow<R>>
        } else {
            this.#flatMapper = function* (value) {
                return flatMapper(value) as Flow<R>
            }
        }
    }

    override* collect(collector?: (value: R) => (void | Coroutine<void>)): Coroutine<void> {
        const coroutine = this.#flatMapper
        const c = unifyCollector(collector)
        yield* this.#previousFlow.collect(function* (value) {
            yield* (yield* coroutine(value)).collect(c)
        })
    }

    override* collectLatest(collector: (value: R) => Coroutine<void>): Coroutine<void> {
        const coroutine = this.#flatMapper
        yield* this.#previousFlow.collectLatest(function* (value) {
            yield* (yield* coroutine(value)).collectLatest(collector)
        })
    }
}

class FlatMapLatestFlow<T, R> extends BaseFlowImpl<R> {
    readonly #previousFlow: Flow<T>
    readonly #flatMapper: (value: T) => Coroutine<Flow<R>>

    constructor(previousFlow: Flow<T>, flatMapper: (value: T) => (Flow<R> | Coroutine<Flow<R>>)) {
        super()
        this.#previousFlow = previousFlow
        if (flatMapper.constructor.name === "GeneratorFunction") {
            this.#flatMapper = flatMapper as (value: T) => Coroutine<Flow<R>>
        } else {
            this.#flatMapper = function* (value) {
                return flatMapper(value) as Flow<R>
            }
        }
    }

    override* collect(collector: (value: R) => (void | Coroutine<void>)): Coroutine<void> {
        const coroutine = this.#flatMapper
        const c = unifyCollector(collector)
        yield* this.#previousFlow.collectLatest(function* (value) {
            yield* (yield* coroutine(value)).collect(c)
        })
    }

    override* collectLatest(collector: (value: R) => Coroutine<void>): Coroutine<void> {
        const coroutine = this.#flatMapper
        yield* this.#previousFlow.collectLatest(function* (value) {
            yield* (yield* coroutine(value)).collect(collector)
        })
    }
}

class FlatMapMergeFlow<T, R> extends BaseFlowImpl<R> {
    readonly #previousFlow: Flow<T>
    readonly #flatMapper: (value: T) => Coroutine<Flow<R>>

    constructor(previousFlow: Flow<T>, flatMapper: (value: T) => (Flow<R> | Coroutine<Flow<R>>)) {
        super()
        this.#previousFlow = previousFlow
        if (flatMapper.constructor.name === "GeneratorFunction") {
            this.#flatMapper = flatMapper as (value: T) => Coroutine<Flow<R>>
        } else {
            this.#flatMapper = function* (value) {
                return flatMapper(value) as Flow<R>
            }
        }
    }

    override* collect(collector: (value: R) => (void | Coroutine<void>)): Coroutine<void> {
        const previousFlow = this.#previousFlow
        const flatMapper = this.#flatMapper
        const c = unifyCollector(collector)
        yield* coroutineScope(function* () {
            const scope = this

            yield* flow<R>(function* (emit) {
                yield* previousFlow.collect(function* (inValue) {
                    scope.launch(function* () {
                        yield* (yield* flatMapper(inValue)).collect(emit)
                    })
                })
            }).collect(c)
        })
    }

    override* collectLatest(collector: (value: R) => Coroutine<void>): Coroutine<void> {
        const previousFlow = this.#previousFlow
        const flatMapper = this.#flatMapper

        yield* coroutineScope(function* () {
            const scope = this

            yield* flow<R>(function* (emit) {
                yield* previousFlow.collect(function* (inValue) {
                    scope.launch(function* () {
                        yield* (yield* flatMapper(inValue)).collect(emit)
                    })
                })
            }).collectLatest(collector)
        })
    }
}

class MapFlow<T, R> extends BaseFlowImpl<R> {
    readonly #previousFlow: Flow<T>
    readonly #mapper: (value: T) => Coroutine<R>

    constructor(previousFlow: Flow<T>, mapper: (value: T) => (void | Coroutine<R>)) {
        super()
        this.#previousFlow = previousFlow
        if (mapper.constructor.name === "GeneratorFunction") {
            this.#mapper = mapper as (value: T) => Coroutine<R>
        } else {
            this.#mapper = function* (value): Coroutine<R> {
                return mapper(value) as R
            }
        }
    }

    override* collect(collector?: (value: R) => (void | Coroutine<void>)): Coroutine<void> {
        const mapper = this.#mapper
        const c = unifyCollector(collector)
        yield* this.#previousFlow.collect(function* (value) {
            yield* c(yield* mapper(value))
        })
    }

    override* collectLatest(collector: (value: R) => Coroutine<void>): Coroutine<void> {
        const coroutine = this.#mapper
        yield* this.#previousFlow.collectLatest(function* (value) {
            yield* collector(yield* coroutine(value))
        })
    }
}

class MapLatestFlow<T, R> extends BaseFlowImpl<R> {
    readonly #previousFlow: Flow<T>
    readonly #mapper: (value: T) => Coroutine<R>

    constructor(previousFlow: Flow<T>, mapper: (value: T) => Coroutine<R>) {
        super()
        this.#previousFlow = previousFlow
        this.#mapper = mapper
    }

    override* collect(collector?: (value: R) => (void | Coroutine<void>)): Coroutine<void> {
        const mapper = this.#mapper
        const c = unifyCollector(collector)
        yield* this.#previousFlow.collectLatest(function* (inValue) {
            yield* c(yield* mapper(inValue))
        })
    }

    override* collectLatest(collector: (value: R) => Coroutine<void>): Coroutine<void> {
        const coroutine = this.#mapper
        yield* this.#previousFlow.collectLatest(function* (value) {
            yield* collector(yield* coroutine(value))
        })
    }
}


class MutableStateFlowImpl<T> extends BaseFlowImpl<T> implements MutableStateFlow<T> {
    #lock = false
    #value: T
    #collectors: Set<(value: T) => void>

    constructor(value: T) {
        super()
        this.#value = value
        this.#collectors = new Set()
    }

    get(): T {
        return this.#value
    }

    set(value: T) {
        if (this.#lock) throw new ConcurrentWrite() // tried to write from a collector
        if (this.#value === value) return
        this.#lock = true
        this.#value = value
        const collectors = this.#collectors
        this.#collectors = new Set()
        for (const i of collectors) {
            i(value)
        }
        this.#lock = false
    }

    override* collect(collector?: (value: T) => (void | Coroutine<void>)): Coroutine<void> {
        const c = unifyCollector(collector)

        // Value may change while processing collector, so we loop until it hasn't changed while processing.
        let value: T
        do {
            value = this.#value
            yield* c(value)
        } while (value !== this.#value)

        for (; ;) {
            yield* c(yield* suspendCancellableCoroutine<T>((resultCallback) => {
                const collectors = this.#collectors

                const callback = (value: T) => {
                    resultCallback({ value })
                }

                collectors.add(callback)

                return () => {
                    collectors.delete(callback)
                }
            }))
        }
    }

    override* collectIndexed(collector: (index: number, value: T) => (void | Coroutine<void>)): Coroutine<void> {
        let c: (index: number, value: T) => Coroutine<void>

        if (collector.constructor.name === "GeneratorFunction") {
            c = collector as (index: number, value: T) => Coroutine<void>
        } else {
            c = function* (index, value) {
                collector(index, value)
            }
        }

        let i = 0
        yield* this.collect(function* (value) {
            yield* c(i, value)
            i++
        })
    }

    override* collectLatest(collector: (value: T) => Coroutine<void>): Coroutine<void> {
        yield* this.collector(function* (collect) {
            yield* coroutineScope(function* () {
                let job: Job | null = null
                for (; ;) {
                    const value = yield* collect()
                    job?.cancel()
                    job = this.launch(function* () {
                        collector(value)
                    })
                }
            })
        })
    }

    override* collector<R>(collector: (collect: () => Coroutine<T>) => Coroutine<R>): Coroutine<R> {
        const that = this
        let lastValue: T | null = null

        return yield* collector(function* () {
            if (lastValue !== that.#value) {
                lastValue = that.#value
                return that.#value
            } else {
                return yield* suspendCancellableCoroutine<T>((resultCallback) => {
                    const collectors = that.#collectors

                    const callback = (value: T) => {
                        lastValue = value
                        resultCallback({ value })
                    }

                    collectors.add(callback)

                    return () => {
                        collectors.delete(callback)
                    }
                })
            }
        })
    }
}

class MutableSharedFlowImpl<T> extends BaseFlowImpl<T> implements MutableSharedFlow<T> {
    #lock = false
    #replay: number
    #values: Queue<T> = new Queue()
    #collectors: Set<(value: T) => void>

    constructor(replay: number = 0) {
        super()
        this.#replay = replay
        this.#collectors = new Set()
    }

    emit(value: T) {
        if (this.#lock) throw new ConcurrentWrite() // tried to write from collector
        this.#lock = true
        while (this.#values.length() > 0 && this.#values.length() > this.#replay) {
            this.#values.dequeue()
        }
        if (this.#values.length() < this.#replay) {
            this.#values.enqueue(value)
        }
        const collectors = this.#collectors
        this.#collectors = new Set()
        for (const i of collectors) {
            i(value)
        }
        this.#lock = false
    }

    override* collect(collector?: (value: T) => (void | Coroutine<void>)): Coroutine<void> {
        const c = unifyCollector(collector)

        for (const i of this.#values) {
            yield* c(i)
        }

        for (; ;) {
            yield* c(yield* suspendCancellableCoroutine<T>((resultCallback) => {
                const collectors = this.#collectors

                const callback = (value: T) => {
                    resultCallback({ value })
                }

                collectors.add(callback)

                return () => {
                    collectors.delete(callback)
                }
            }))
        }
    }

    override* collectIndexed(collector: (index: number, value: T) => (void | Coroutine<void>)): Coroutine<void> {
        let c: (index: number, value: T) => Coroutine<void>

        if (collector.constructor.name === "GeneratorFunction") {
            c = collector as (index: number, value: T) => Coroutine<void>
        } else {
            c = function* (index, value) {
                collector(index, value)
            }
        }

        let i = 0
        yield* this.collect(function* (value) {
            yield* c(i, value)
            i++
        })
    }

    override* collectLatest(collector: (value: T) => Coroutine<void>): Coroutine<void> {
        yield* this.collector(function* (collect) {
            yield* coroutineScope(function* () {
                let job: Job | null = null
                for (; ;) {
                    const value = yield* collect()
                    job?.cancel()
                    job = this.launch(function* () {
                        collector(value)
                    })
                }
            })
        })
    }

    override* collector<R>(collector: (collect: () => Coroutine<T>) => Coroutine<R>): Coroutine<R> {
        const that = this

        return yield* collector(function* () {
            return yield* suspendCancellableCoroutine<T>((resultCallback) => {
                const collectors = that.#collectors

                const callback = (value: T) => {
                    resultCallback({ value })
                }

                collectors.add(callback)

                return () => {
                    collectors.delete(callback)
                }
            })
        })
    }
}

const unifyCollector = <T>(collector?: (value: T) => (void | Coroutine<void>)): (value: T) => Coroutine<void> => {
    if (!collector) {
        return function* () {
        }
    } else if (collector.constructor.name !== "GeneratorFunction") {
        return function* (value) {
            collector(value)
        }
    } else {
        return collector as (value: T) => Coroutine<void>
    }
}

export const flow: <T>(flow: (emit: (value: T) => Coroutine<void>) => Coroutine<void>) => Flow<T> = (flow) => {
    return new FlowEmit(flow)
}

export const flowOf: <T>(...vararg: T[]) => Flow<T> = (...vararg) => {
    return new FlowOf(...vararg)
}

const EmptyFlow = flowOf<never>()

export const emptyFlow: () => Flow<never> = () => EmptyFlow

export const mutableStateFlow: <T>(value: T) => MutableStateFlow<T> =
    (value) => new MutableStateFlowImpl(value)

export const mutableSharedFlow: <T>(replay?: number) => MutableSharedFlow<T> =
    (replay?: number) => new MutableSharedFlowImpl(replay)
