import { assert } from "chai"
import { delay } from "../Common.js"
import { channel } from "../internal/ChannelImpl.js"
import { ChannelClosed } from "../internal/Errors.js"
import { GlobalScope, coroutineScope } from "../internal/JobImpl.js"

describe("Channel tests", () => {
    it("Channel to collect", (done) => {
        const c = 1_000
        GlobalScope.coroutineScope(function* () {
            const chan = channel<number>()

            this.launch(function* () {
                let sum = 0

                try {
                    for (; ;) {
                        sum += yield* chan.receive()
                    }
                } catch (error) {
                    if (error !== ChannelClosed) throw error
                }

                assert(sum === c)
                done()
            })

            yield* coroutineScope(function* () {
                for (let i = 0; i < c; i++) {
                    this.launch(function* () {
                        yield* delay(0)
                        yield* chan.send(1)
                    })
                }
            })

            chan.close()
        })
    })

    it("Channel to fan out", (done) => {
        const c = 1_000
        GlobalScope.coroutineScope(function* () {
            const fanout = channel<number>()
            const fanin = channel<number>()

            // producer
            this.launch(function* () {
                for (let i = 0; i < c; i++) {
                    yield* fanout.send(1)
                }

                fanout.close()
            })

            // fan-out processors
            this.launch(function* () {
                yield* coroutineScope(function* () {
                    for (let i = 0; i < c; i++) {
                        this.launch(function* () {
                            try {
                                for (; ;) {
                                    yield* fanin.send(yield* fanout.receive())
                                }
                            } catch (error) {
                                if (error !== ChannelClosed) throw error
                            }
                        })
                    }
                })

                fanin.close()
            })


            // fan-in
            this.launch(function* () {
                let sum = 0
                try {
                    for (; ;) {
                        sum += yield* fanin.receive()
                    }
                } catch (error) {
                    if (error !== ChannelClosed) throw error
                }

                assert(sum === c)
                done()
            })
        })
    })
})
