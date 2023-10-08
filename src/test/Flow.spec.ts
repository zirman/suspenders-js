import { assert } from "chai"
import { delay } from "../Common.js"
import { assertFlow } from "../internal/Assert.js"
import { NoSuchElementException } from "../internal/Errors.js"
import { emptyFlow, flow, flowOf } from "../internal/FlowImpl.js"
import { GlobalScope, coroutineScope } from "../internal/JobImpl.js"

describe("Flow tests", () => {
    it("flowOf().first()", (done) => {
        GlobalScope.launch(function* () {
            for (let i = 0; i < 1_000; i++) {
                const value = yield* flowOf(1, 2, 3).first()
                assert(value === 1)
            }
            done()
        })
    })

    it("flowOf().first(predicate)", (done) => {
        GlobalScope.launch(function* () {
            for (let i = 0; i < 1_000; i++) {
                const value = yield* flowOf(1, 2, 3).first((value) => value === 2)
                assert(value === 2)
            }

            done()
        })
    })

    it("flow().first()", (done) => {
        GlobalScope.launch(function* () {
            for (let i = 0; i < 1_000; i++) {
                let isSkipped = true
                let runFinally = false
                const value = yield* flow<number>(function* (emit) {
                    try {
                        yield* emit(1)
                        yield* emit(2)
                        isSkipped = false
                        yield* emit(3)
                    } finally {
                        runFinally = true
                    }
                }).first()

                assert(isSkipped)
                assert(runFinally)
                assert(value === 1)
            }

            done()
        })
    })

    it("flow().first(predicate)", (done) => {
        GlobalScope.launch(function* () {
            for (let i = 0; i < 1_000; i++) {
                let runFinally = false
                const value = yield* flow<number>(function* (emit) {
                    try {
                        let i = 0
                        for (; ;) {
                            yield* emit(i++)
                        }
                    } finally {
                        runFinally = true
                    }
                }).first((value) => value >= 100)

                assert(runFinally)
                assert(value === 100)
            }

            done()
        })
    })

    it("flow().last()", (done) => {
        GlobalScope.launch(function* () {
            for (let i = 0; i < 1_000; i++) {
                const value = yield* flowOf(1, 2, 3).last()
                assert(value === 3)
            }

            done()
        })
    })

    it("flow().last(): empty list", (done) => {
        GlobalScope.launch(function* () {
            for (let i = 0; i < 1_000; i++) {
                try {
                    yield* emptyFlow().first()
                } catch (error) {
                    assert(error === NoSuchElementException)
                }
            }
            done()
        })
    })

    it("coroutineScope(): throw error", (done) => {
        GlobalScope.launch(function* () {
            let hasErrored = false

            try {
                yield* coroutineScope(function* () {
                    throw new Error()
                })
            } catch {
                hasErrored = true
            }

            assert(hasErrored)
            done()
        })
    })

    it("ChannelFlow.collect()", (done) => {
        GlobalScope.launch(function* () {
            let sum = 0
            yield* flow<number>(function* (emit) {
                yield* coroutineScope(function* () {
                    this.launch(function* () {
                        yield* emit(1)
                    })

                    this.launch(function* () {
                        yield* emit(2)
                    })

                    this.launch(function* () {
                        yield* emit(3)
                    })
                })
            }).collect(function* (value) {
                sum += value
            })

            assert(sum === 6)
            done(0)
        })
    })

    it("ChannelFlow.collectLatest()", (done) => {
        GlobalScope.launch(function* () {
            let completed = false
            yield* flow<number>(function* (emit) {
                yield* coroutineScope(function* () {
                    this.launch(function* () {
                        yield* delay(0)
                        yield* emit(1)
                    })

                    this.launch(function* () {
                        yield* delay(0)
                        yield* emit(2)
                    })

                    this.launch(function* () {
                        yield* delay(0)
                        yield* emit(3)
                    })
                })
            }).collectLatest(function* (value) {
                yield* delay(100)
                assert(value === 3)
                completed = true
            })

            done()
        })
    })

    it("flowOf().collect()", (done) => {
        GlobalScope.launch(function* () {
            let sum = 0
            yield* flowOf(1, 2, 3)
                .collect(function* (value) {
                    sum += value
                })

            assert(sum === 6)
            done()
        })
    })

    it("flowOf().collectLatest()", (done) => {
        GlobalScope.launch(function* () {
            let sum = 0
            yield* flowOf(1, 2, 3)
                .collectLatest(function* (value) {
                    sum += value
                })

            assert(sum === 3)
            done()
        })
    })

    it("flowOf().map().collect()", (done) => {
        GlobalScope.launch(function* () {
            let sum = 0
            yield* flowOf(1, 2, 3)
                .map(function* (value) {
                    return value + 1
                })
                .collect(function* (value) {
                    sum += value
                })

            assert(sum === 9)
            done()
        })
    })

    it("flowOf().map().collectLatest()", (done) => {
        GlobalScope.launch(function* () {
            let sum = 0
            yield* flowOf(1, 2, 3)
                .map(function* (value) {
                    return value + 1
                })
                .collectLatest(function* (value) {
                    yield* delay(100)
                    sum += value
                })

            assert(sum === 4)
            done()
        })
    })

    it("flowOf().mapLatest().collect()", (done) => {
        GlobalScope.launch(function* () {
            yield* assertFlow(
                flow<number>(function* (emit) {
                    yield* coroutineScope(function* () {
                        this.launch(function* () {
                            yield* delay(0)
                            yield* emit(1)
                        })
                        this.launch(function* () {
                            yield* delay(10)
                            yield* emit(2)
                        })
                    })
                })
                    .mapLatest(function* (value) {
                        yield* delay(20)
                        return value + 1
                    }),
                3
            )

            done()
        })
    })

    it("new FlowEmit().mapLatest().collect()", (done) => {
        GlobalScope.launch(function* () {
            let sum = 0
            yield* flow<number>(function* (emit) {
                yield* delay(0)
                yield* emit(1)
                yield* delay(0)
                yield* emit(2)
                yield* delay(0)
                yield* emit(3)
            })
                .mapLatest(function* (value) {
                    try {
                        yield* delay(100)
                        return value + 1
                    } finally {
                    }
                })
                .collect(function* (value) {
                    sum += value
                })

            assert(sum === 4)
            done()
        })
    })

    it("new FlowEmit().mapLatest().collect(): 2", (done) => {
        GlobalScope.launch(function* () {
            let sum = 0
            yield* flow<number>(function* (emit) {
                yield* delay(0)
                yield* emit(1)
                yield* delay(0)
                yield* emit(2)
                yield* delay(0)
                yield* emit(3)
            })
                .mapLatest(function* (value) {
                    try {
                        yield* delay(100)
                        return value + 1
                    } finally {
                    }
                })
                .collect(function* (value) {
                    sum += value
                })

            assert(sum === 4)
            done()
        })
    })

    it("new FlowOf().onEach().collect()", (done) => {
        GlobalScope.launch(function* () {
            let sum = 0
            yield* flowOf(1, 2, 3)
                .onEach(function* (value) {
                    sum += value
                })
                .collect()

            assert(sum === 6)
            done()
        })
    })

    it("new FlowEmit().catch().collect()", (done) => {
        GlobalScope.launch(function* () {
            yield* flow<number>(function* () {
                throw new Error()
            })
                .catch(function* () {
                    done()
                })
                .collect()
        })
    })

    it("new FlowEmit().onCompletion().collect()", (done) => {
        GlobalScope.launch(function* () {
            yield* assertFlow(
                flow<number>(function* (emit) {
                    yield* emit(1)
                })
                    .onCompletion(function* (emit) {
                        yield* emit(2)
                    }),
                1, 2
            )

            done()
        })
    })

    it("new FlowEmit().mapNotNull()", (done) => {
        GlobalScope.launch(function* () {
            yield* assertFlow(
                flow<number | null>(function* (emit) {
                    yield* emit(1)
                    yield* emit(null)
                    yield* emit(2)
                })
                    .mapNotNull(function* (value) {
                        return value
                    }),
                1, 2
            )

            done()
        })
    })

    it("new FlowEmit().onStart()", (done) => {
        GlobalScope.launch(function* () {
            yield* assertFlow(
                flow<number | null>(function* (emit) {
                    yield* emit(2)
                })
                    .onStart(function* (emit) {
                        yield* emit(1)
                    }),
                1, 2
            )

            done()
        })
    })

    it("new FlowEmit().onEmpty(): empty case", (done) => {
        GlobalScope.launch(function* () {
            yield* assertFlow(
                flow<number | null>(function* () {
                })
                    .onEmpty(function* (emit) {
                        yield* emit(1)
                    }),
                1
            )

            done()
        })
    })

    it("new FlowEmit().onEmpty(): not empty case", (done) => {
        GlobalScope.launch(function* () {
            yield* assertFlow(
                flow<number | null>(function* (emit) {
                    yield* emit(1)
                })
                    .onEmpty(function* (emit) {
                        yield* emit(2)
                    }),
                1
            )

            done()
        })
    })

    it("new FlowEmit().transformConcat()", (done) => {
        GlobalScope.launch(function* () {
            yield* assertFlow(
                flow<number>(function* (emit) {
                    yield* emit(1)
                    yield* emit(2)
                    yield* emit(3)
                })
                    .transform<number>(function* (value, emit) {
                        yield* emit(value + 1)
                        yield* emit(value + 1)
                    }),
                2, 2, 3, 3, 4, 4
            )

            done()
        })
    })

    it("new FlowEmit().transformLatest()", (done) => {
        GlobalScope.launch(function* () {
            yield* assertFlow(
                flow<number>(function* (emit) {
                    yield* emit(1)
                    yield* emit(2)
                    yield* emit(3)
                })
                    .transformLatest<number>(function* (value, emit) {
                        yield* delay(0)
                        yield* emit(value)
                    }),
                3
            )

            done()
        })
    })

    it("new FlowEmit().transformWhile(): Runs to completion", (done) => {
        GlobalScope.launch(function* () {
            yield* assertFlow(
                flow<number>(function* (emit) {
                    yield* emit(1)
                    yield* emit(2)
                    yield* emit(3)
                    yield* emit(4)
                    yield* emit(5)
                })
                    .transformWhile<number>(function* (value, emit) {
                        if (value > 5) return false
                        yield* emit(value)
                        return true
                    }),
                1, 2, 3, 4, 5
            )

            done()
        })
    })

    it("new FlowEmit().transformWhile(): Flow ends early", (done) => {
        GlobalScope.launch(function* () {
            let hasSkipped = true
            let ranFinally = false
            yield* assertFlow(
                flow<number>(function* (emit) {
                    try {
                        yield* emit(1)
                        yield* emit(2)
                        yield* emit(3)
                        yield* emit(4)
                        hasSkipped = false
                        yield* emit(5)
                    } finally {
                        ranFinally = true
                    }
                })
                    .transformWhile<number>(function* (value, emit) {
                        if (value > 2) return false
                        yield* emit(value)
                        return true
                    }),
                1, 2
            )

            yield* delay(0)
            assert(hasSkipped)
            assert(ranFinally)
            done()
        })
    })

    it("new FlowEmit().transformWhile().collectLatest(): Runs to completion", (done) => {
        GlobalScope.launch(function* () {
            yield* flow<number>(function* (emit) {
                yield* delay(0)
                yield* emit(1)
                yield* delay(0)
                yield* emit(3)
                yield* delay(0)
                yield* emit(5)
                yield* delay(0)
                yield* emit(7)
                yield* delay(0)
                yield* emit(9)
            })
                .transformWhile(function* (value, emit) {
                    if (value > 3) return false
                    yield* delay(0)
                    yield* emit(value)
                    yield* delay(0)
                    yield* emit(value + 1)
                    return true
                })
                .collectLatest(function* () {
                })

            done()
        })
    })

    it("new FlowEmit().flatMapLatest()", (done) => {
        GlobalScope.launch(function* () {
            yield* flow<number>(function* (emit) {
                yield* emit(1)
                yield* emit(3)
                yield* emit(5)
                yield* emit(7)
                yield* emit(9)
            })
                .flatMapLatest<number>(function* () {
                    return flowOf(1)
                })
                .collect(function* () {
                })

            done()
        })
    })

    it("flowOf().collect(): regular function", (done) => {
        GlobalScope.launch(function* () {
            const values: number[] = [1, 2, 3]
            let i = 0
            yield* flowOf(...values)
                .collect(value => {
                    assert(value === values[i])
                    i++
                })
            done()
        })
    })
})
