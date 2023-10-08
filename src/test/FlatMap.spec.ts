import { delay } from "../Common.js"
import { assertFlow } from "../internal/Assert.js"
import { emptyFlow, flow, flowOf } from "../internal/FlowImpl.js"
import { GlobalScope } from "../internal/JobImpl.js"

describe("FlatMap tests", () => {
    it("flowOf(): double", (done) => {
        GlobalScope.launch(function* () {
            yield* assertFlow(
                flowOf(1, 2, 3)
                    .flatMapConcat(function* (value) {
                        return flowOf(value, value)
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
                    .flatMapConcat(function* () {
                        return emptyFlow()
                    }),
            )

            done()
        })
    })

    it("flowOf(): empty empty", (done) => {
        GlobalScope.launch(function* () {
            yield* assertFlow(
                emptyFlow()
                    .flatMapConcat(function* () {
                        return emptyFlow()
                    }),
            )

            done()
        })
    })

    it("flowOf().flatMapLatest: empty empty", (done) => {
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
                    .flatMapLatest(function* (value) {
                        yield* delay(100)
                        return flowOf(value)
                    }),
                3
            )

            done()
        })
    })

    it("flowOf().flatMapMerge()", (done) => {
        GlobalScope.launch(function* () {
            yield* assertFlow(
                flowOf(30, 20, 10)
                    .flatMapMerge(function* (value) {
                        return flow(function* (emit) {
                            yield* delay(value)
                            yield* emit(value)
                        })
                    }),
                10, 20, 30
            )

            done()
        })
    })
})
