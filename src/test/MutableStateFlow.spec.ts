import { assert } from "chai"
import { ensureActive } from "../Common.js"
import { assertFlow } from "../internal/Assert.js"
import { mutableStateFlow } from "../internal/FlowImpl.js"
import { GlobalScope } from "../internal/JobImpl.js"

describe("MutableStateFlow tests", () => {
    it("mutableStateFlow().setValue()", (done) => {
        GlobalScope.coroutineScope(function* () {
            const values = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]
            const sf = mutableStateFlow(values[0])

            let job = this.launch(function* () {
                yield* assertFlow(sf, ...values)
            })

            for (let value of values.slice(1)) {
                sf.set(value)
            }

            // MutableStateFlows never complete so we just cancel assertFlow()
            job.cancel()

            // checks if assertFlow() failed
            yield* ensureActive()
            done()
        })
    })

    it("mutableStateFlow().setValue() 2", (done) => {
        GlobalScope.coroutineScope(function* () {
            const values = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]
            const sf = mutableStateFlow(values[0])

            let lastValue: number | null = null
            let job = this.launch(function* () {
                yield* sf.collectIndexed((index, value) => {
                    assert(index === value)
                    lastValue = value
                })
            })

            for (let value of values.slice(1)) {
                sf.set(value)
            }
            job.cancel()
            yield* ensureActive()

            assert(lastValue === values[values.length - 1])
            done()
        })
    })

    // it("mutableStateFlow().setValue() 3", (done) => {
    //     GlobalScope.coroutineScope(function* () {
    //         const values = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]
    //         const sf = mutableStateFlow(values[0])
    //
    //         // let lastValue: number | null = null
    //         let job = this.launch(function* () {
    //             yield* sf.collectLatest((value) => {
    //                 // assert(index === value)
    //                 // lastValue = value
    //             })
    //         })
    //
    //         for (let value of values.slice(1)) {
    //             sf.setValue(value)
    //         }
    //         job.cancel()
    //         yield* ensureActive()
    //
    //         assert(lastValue === values[values.length - 1])
    //         done()
    //     })
    // })
})
