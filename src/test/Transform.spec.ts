import { delay } from "../Common.js"
import { assertFlow } from "../internal/Assert.js"
import { emptyFlow, flow, flowOf } from "../internal/FlowImpl.js"
import { GlobalScope } from "../internal/JobImpl.js"

describe("Transform tests", () => {
    it("flowOf(): double", (done) => {
        GlobalScope.launch(function* () {
            yield* assertFlow(
                flowOf(1, 2, 3)
                    .transform(function* (value, emit) {
                        yield* emit(value)
                        yield* emit(value)
                    }),
                1, 1, 2, 2, 3, 3,
            )

            done()
        })
    })

    it("flowOf(): empty", (done) => {
        GlobalScope.launch(function* () {
            yield* assertFlow(
                flowOf(1, 2, 3)
                    .transform(function* () {
                    }),
            )

            done()
        })
    })

    it("flowOf(): empty empty", (done) => {
        GlobalScope.launch(function* () {
            yield* assertFlow(emptyFlow().transform(function* () {
            }))

            done()
        })
    })

    it("flowOf().transformLatest(): empty empty", (done) => {
        GlobalScope.launch(function* () {
            yield* assertFlow(
                flow<number>(function* (emit) {
                    yield* delay(0)
                    yield* emit(1)
                    yield* delay(0)
                    yield* emit(2)
                    yield* delay(0)
                    yield* emit(3)
                })
                    .transformLatest(function* (value, emit) {
                        yield* delay(100)
                        yield* emit(value)
                    }),
                3
            )

            done()
        })
    })
})
