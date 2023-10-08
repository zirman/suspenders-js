import { assert } from "chai"
import { Flow } from "../Flow.js"
import { Coroutine } from "../Types.js"

export function* assertFlow<T>(flow: Flow<T>, ...vararg: T[]): Coroutine<void> {
    let length = 0

    yield* flow.collectIndexed(function* (index, value) {
        // error if flow emits too many values
        assert(index < vararg.length)
        // error if value does not match expected
        assert(vararg[index] === value)
        length++
    })

    // error if number of emitted values equals expected length
    assert(length === vararg.length)
}
