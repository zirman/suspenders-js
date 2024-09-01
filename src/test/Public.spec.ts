import { assert } from "chai"
import { measureTimeMillis } from "../Common.js"
import { job, SupervisorScope } from "../internal/JobImpl.js"
import { Queue } from "../internal/Queue.js"
import {
    awaitCancelation as awaitCancelation,
    awaitPromise,
    coroutineScope,
    CoroutineScope,
    delay,
    ensureActive,
    Failure,
    GlobalScope,
    supervisorScope,
    suspendCancellableCoroutine,
    suspendCoroutine,
} from "../main.js"

describe("CoroutineScope tests", () => {
    it("CoroutineScope().launch()", (done) => {
        CoroutineScope().launch(function* () {
            done()
        })
    })

    it("SupervisorScope().launch()", (done) => {
        SupervisorScope().launch(function* () {
            done()
        })
    })

    it("GlobalScope.launch()", (done) => {
        GlobalScope.launch(function* () {
            done()
        })
    })

    it("Throwing in 'CoroutineScope().launch()' cancels scope", (done) => {
        const scope = CoroutineScope()

        let hasErrored = false
        scope.launch(function* () {
            try {
                hasErrored = true
                throw new Error()
            } finally {
                done()
            }
        });
        assert(hasErrored)
        assert(!scope.isActive())
    })

    it("Launching a coroutine in canceled scope does not start it", (done) => {
        const scope = CoroutineScope()
        scope.cancel()

        let hasRun = false
        const job = scope.launch(function* () {
            hasRun = true
        })

        assert(!hasRun)
        assert(!job.isActive())
        done()
    })

    it("Throwing in child job of a SupervisorScope does not cancel the supervisor", (done) => {
        const scope = SupervisorScope()

        let hasErrored = false
        scope.launch(function* () {
            hasErrored = true
            throw new Error()
        });

        assert(hasErrored)
        assert((scope as any).isRunning())

        scope.launch(function* () {
            done()
        })
    })

    it("CoroutineScope.cancel()", (done) => {
        const scope = CoroutineScope()

        scope.launch(function* () {
            try {
                yield* awaitCancelation()
            } finally {
                done()
            }
        })

        scope.cancel()
    })

    it("Test awaitCancelation() suspends a coroutine and finish block is called on Job.cancel()", (done) => {
        GlobalScope.launchCoroutineScope(function* () {
            let hasStarted = false
            let hasFinished = false

            const job = this.launch(function* () {
                try {
                    hasStarted = true
                    yield* awaitCancelation()
                } finally {
                    hasFinished = true
                }
            })

            // ensure coroutine has started
            assert(hasStarted)
            assert(!hasFinished)
            assert((job as any).isRunning())
            job.cancel()
            assert(!(job as any).isRunning())
            assert(hasFinished)
            assert(!(job as any).isRunning())
            done()
        })
    })

    it("An error in a child cancels it's siblings", (done) => {
        const scope = CoroutineScope()

        let hasRun = false
        scope.launch(function* () {
            try {
                hasRun = true
                yield* awaitCancelation()
            } finally {
                done()
            }
        })

        assert(hasRun)

        scope.launch(function* () {
            throw new Error()
        })
    })

    it("CoroutineScope.coroutineScope()", (done) => {
        CoroutineScope().launchCoroutineScope(function* () {
            done()
        })
    })

    it("CoroutineScope.coroutineScope(): launch()", (done) => {
        CoroutineScope().launchCoroutineScope(function* () {
            this.launch(function* () {
                done()
            })
        })
    })

    it("CoroutineScope.coroutineScope(): async()", (done) => {
        CoroutineScope().launchCoroutineScope(function* () {
            this.async(function* () {
                done()
            })
        })
    })

    it("CoroutineScope.supervisorScope()", (done) => {
        CoroutineScope().launchSupervisorScope(function* () {
            done()
        })
    })

    it("CoroutineScope.supervisorScope(): launch()", (done) => {
        CoroutineScope().launchSupervisorScope(function* () {
            this.launch(function* () {
                done()
            })
        })
    })

    it("CoroutineScope.supervisorScope().async()", (done) => {
        CoroutineScope().launchSupervisorScope(function* () {
            this.async(function* () {
                done()
            })
        })
    })

    it("GlobalScope does is not cancelable", (done) => {
        GlobalScope.cancel()
        assert((GlobalScope as any).isActive())
        GlobalScope.launch(function* () {
            done()
        })
    })

    it("Canceling a coroutine", (done) => {
        GlobalScope.launchCoroutineScope(function* () {
            let isRunning = false

            const job = this.launch(function* () {
                isRunning = true
                yield* awaitCancelation()
            })

            assert(isRunning)
            job.cancel()
            assert(!job.isActive())
            done()
        })
    })

    it("Canceling a coroutine supervisor", (done) => {
        GlobalScope.launchSupervisorScope(function* () {
            let isRunning = false

            this.launch(function* () {
                isRunning = true
                throw new Error()
            })

            assert(isRunning)
            done()
        })
    })

    it("Throwing calls finally block", (done) => {
        GlobalScope.launch(function* () {
            try {
                throw new Error()
            } finally {
                done()
            }
        })
    })

    it("Canceling job calls finally block", (done) => {
        GlobalScope.launchCoroutineScope(function* () {
            let isRunning = false

            const job = this.launch(function* () {
                try {
                    isRunning = true
                    yield* awaitCancelation()
                } finally {
                    done()
                }
            })

            assert(isRunning)
            job.cancel()
        })
    })

    it("Canceling job calls nested finally block", (done) => {
        GlobalScope.launchCoroutineScope(function* () {
            let isRunning = false

            const job = this.launch(function* () {
                yield* coroutineScope(function* () {
                    const that = this
                    that.launch(function* () {
                        try {
                            isRunning = true
                            yield* awaitCancelation()
                        } finally {
                            done()
                        }
                    })
                })
            })

            assert(isRunning)
            job.cancel()
        })
    })

    it("Throwing in launched coroutine calls finally block", (done) => {
        GlobalScope.launchCoroutineScope(function* () {
            try {
                this.launch(function* () {
                    throw new Error()
                })

                yield* awaitCancelation()
            } finally {
                done()
            }
        })
    })

    it("Throwing in launched coroutine calls finally block after delay", (done) => {
        GlobalScope.launchCoroutineScope(function* () {
            try {
                this.launch(function* () {
                    yield* delay(0)
                    throw new Error()
                })

                yield* awaitCancelation()
            } finally {
                done()
            }
        })
    })

    it("Error in child job propagates up the job tree", (done) => {
        GlobalScope.launch(function* () {
            try {
                yield* coroutineScope(function* () {
                    this.launch(function* () {
                        throw new Error()
                    })
                })

                yield* awaitCancelation()
            } finally {
                done()
            }
        })
        console.log()
    })

    it("Error while suspended propagates", (done) => {
        GlobalScope.launch(function* () {
            try {
                yield* coroutineScope(function* () {
                    this.launch(function* () {
                        yield* delay(0)
                        throw new Error()
                    })
                })

                yield* awaitCancelation()
            } finally {
                done()
            }
        })
    })

    it("Async", (done) => {
        GlobalScope.launch(function* () {
            const sum = yield* coroutineScope(function* () {
                const asyncX = this.async(function* () {
                    return 2
                })

                const asyncY = this.async(function* () {
                    return 2
                })

                return (yield* asyncX.await()) + (yield* asyncY.await())
            })

            assert(sum === 4)
            done()
        })
    })

    it("Async after delay", (done) => {
        GlobalScope.launchCoroutineScope(function* () {
            const asyncX = this.async(function* () {
                yield* delay(0)
                return 2
            })

            const asyncY = this.async(function* () {
                yield* delay(0)
                return 2
            })

            const sum = (yield* asyncX.await()) + (yield* asyncY.await())
            assert(sum === 4)
            done()
        })
    })

    it("Deferred with error throws when calling await()", (done) => {
        GlobalScope.launchSupervisorScope(function* () {
            const asyncY = this.async(function* () {
                throw new Error()
            })

            try {
                yield* asyncY.await()
            } finally {
                done()
            }
        })
    })

    it("Deferred with error throws when calling await() after delay", (done) => {
        GlobalScope.launch(function* () {
            yield* supervisorScope(function* () {
                const asyncX = this.async(function* () {
                    yield* delay(0)
                    return 2
                })

                const asyncY = this.async(function* () {
                    yield* delay(0)
                    throw new Error()
                })

                try {
                    (yield* asyncX.await()) + (yield* asyncY.await())
                    yield* awaitCancelation()
                } finally {
                    done()
                }
            })
        })
    })

    it("awaitPromise()", (done) => {
        const value = Math.random()

        GlobalScope.launch(function* () {
            const result = yield* awaitPromise(new Promise<number>((resolve) => {
                setTimeout(() => resolve(value), 0)
            }))
            assert(result === value)
            done()
        })
    })

    it("awaitPromise() on an error", (done) => {
        const value = Math.random()

        GlobalScope.launch(function* () {
            try {
                yield* awaitPromise(new Promise<number>((_, error) => {
                    setTimeout(() => error(value), 0)
                }))
            } catch (error) {
                assert(error === value)
                done()
            }
        })
    })

    it("A yield* inside a finally block moves job to GlobalScope", (done) => {
        GlobalScope.launchCoroutineScope(function* () {
            const j = CoroutineScope().launch(function* () {
                try {
                    yield* awaitCancelation()
                } finally {
                    yield* delay(0)
                    assert(((GlobalScope as any).children).has(yield* job()))
                    done()
                }
            })

            j.cancel()
        })
    })

    it("Test suspendCoroutine() resumes on result", (done) => {
        GlobalScope.launch(function* () {
            yield* suspendCoroutine((resultCallback) => {
                setTimeout(() => resultCallback(undefined))
            })

            done()
        })
    })

    it("Test suspendCoroutine() throws on error", (done) => {
        GlobalScope.launch(function* () {
            try {
                yield* suspendCoroutine((resultCallback) => {
                    setTimeout(() => resultCallback(new Failure(new Error())))
                })
            } catch {
                done()
            }
        })
    })

    it("Test suspendCancellableCoroutine() resumes on result", (done) => {
        GlobalScope.launch(function* () {
            yield* suspendCancellableCoroutine((resultCallback) => {
                const timeout = setTimeout(() => resultCallback(undefined))
                return () => {
                    clearInterval(timeout)
                }
            })

            done()
        })
    })

    it("Test suspendCancellableCoroutine() throws on error", (done) => {
        GlobalScope.launch(function* () {
            try {
                yield* suspendCancellableCoroutine((resultCallback) => {
                    const timeout = setTimeout(() => resultCallback(new Failure(new Error())))
                    return () => {
                        clearInterval(timeout)
                    }
                })
            } catch {
                done()
            }
        })
    })

    it("Test suspendCancellableCoroutine() cancel", (done) => {
        GlobalScope.launchCoroutineScope(function* () {
            const job = this.launch(function* () {
                yield* suspendCancellableCoroutine(() => () => done())
            })

            // delay is needed to ensure suspendCancellableCoroutine has started
            yield* delay(0)
            job.cancel()
        })
    })

    it("ensureActive() finishes a coroutine that has been canceled", (done) => {
        GlobalScope.launchCoroutineScope(function* () {
            const job = this.launch(function* () {
                try {
                    let x = 1
                    for (; ;) {
                        if (x % 1_000 === 0) {
                            yield* ensureActive()
                        }
                        x++
                    }
                } finally {
                    done()
                }
            })

            yield* delay(0)
            job.cancel()
        })
    })

    it("Two concurrent await() on a Deferred", (done) => {
        GlobalScope.launchCoroutineScope(function* () {
            const deferred = this.async(function* () {
                yield* delay(0)
                return 1
            })

            this.launch(function* () {
                yield* deferred.await()
            })

            yield* deferred.await()
            done()
        })
    })

    it("Two concurrent await() on a Deferred again", (done) => {
        GlobalScope.launchCoroutineScope(function* () {
            const deferred = this.async(function* () {
                yield* delay(0)
                return 1
            })

            this.launch(function* () {
                yield* deferred.await()
                done()
            })

            yield* deferred.await()
        })
    })

    it("Queue.dequeueOldest()", (done) => {
        const queue = new Queue<number>()
        queue.enqueue(1)
        queue.enqueue(2)
        queue.enqueue(3)

        assert(queue.dequeue() === 1)
        assert(queue.dequeue() === 2)
        assert(queue.dequeue() === 3)
        assert(queue.dequeue() === null)

        done()
    })

    it("Performance test 1", (done) => {
        const c = 1_000
        GlobalScope.launch(function* () {
            const t = yield* measureTimeMillis(function* () {
                let sum = 0

                yield* coroutineScope(function* () {
                    for (let i = 0; i < c; i++) {
                        this.launch(function* () {
                            yield* delay(100)
                            sum++
                        })
                    }
                })

                assert(sum === c)
            })

            assert(t < 200)
            done()
        })
    })

    it("Performance test 2", (done) => {
        GlobalScope.launch(function* () {
            const t = yield* measureTimeMillis(function* () {
                const c = 1_000
                let sum = 0

                yield* coroutineScope(function* () {
                    for (let i = 0; i < c; i++) {
                        this.launch(function* () {
                            const x = yield* coroutineScope(function* () {
                                yield* delay(100)
                                return 1
                            })
                            sum += x
                        })
                    }
                })

                assert(sum === c)
            })

            assert(t < 200)
            done()
        })
    })
})
