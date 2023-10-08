import { ensureActive } from "../Common.js"
import { assertFlow } from "../internal/Assert.js"
import { mutableSharedFlow } from "../internal/FlowImpl.js"
import { GlobalScope } from "../internal/JobImpl.js"

describe("MutableSharedFlow tests", () => {
    it("mutableSharedFlow().emit()", (done) => {
        GlobalScope.coroutineScope(function* () {
            const values = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]
            const sf = mutableSharedFlow<number>()

            let job = this.launch(function* () {
                yield* assertFlow(sf, ...values)
            })

            for (let value of values) {
                sf.emit(value)
            }

            // MutableStateFlows never complete so we just cancel assertFlow()
            job.cancel()

            // checks if assertFlow() failed
            yield* ensureActive()
            done()
        })
    })

    it("mutableSharedFlow(1).emit()", (done) => {
        GlobalScope.coroutineScope(function* () {
            const values = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]
            const sf = mutableSharedFlow<number>()

            sf.emit(values[0]!)

            let job = this.launch(function* () {
                yield* assertFlow(sf, ...values)
            })

            for (let value of values.slice(1)) {
                sf.emit(value)
            }

            // MutableStateFlows never complete so we just cancel assertFlow()
            job.cancel()

            // checks if assertFlow() failed
            yield* ensureActive()
            done()
        })
    })
})
