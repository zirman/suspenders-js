# Suspenders.js: Structured concurrency for JavaScript

# Suspenders.js 0.0.9 (alpha)

Suspenders.js is a library for asynchronous programming that supports coroutines and
"structured concurrency". Suspenders.js takes inspiration from Kotlin's coroutines to combine
functional and imperative programming styles for asynchronous programming.

[Apache 2.0 License](LICENSE)

## Intro

Anyone who has written a large amount of asynchronous code in JavaScript is familiar with callback
hell. Callback hell can be mitigated through the use of JavaScript generators (aka coroutines).
Coroutines are implemented using JavaScript generators that suspend when there is an
asynchronous operation. When the asynchronous operation resolves, the coroutine is resumed where it
was suspended with the result. Unlike Promises or Async/Await, coroutines can be halted at any time.
Coroutines are guaranteed to run their cleanup logic inside finally blocks when they are
canceled. This ensures that resources are not leaked.

Coroutines allow for more efficient resource management through cancellation. For example, if a
database connection is opened in a coroutine's `try` block and closed in the `finally` block, it is
guaranteed that the db connection is closed regardless of if the coroutine completes or is canceled.
This is because all `finally` blocks are run automatically when a coroutine is canceled.

## Why another async programming library?

Why choose Suspenders.js over JavaScript Promises? Promises are good when your async process is
simple, short-running and will never need to be canceled. With Suspenders.js, your async processes
can run for as long as required and then be canceled when they are no longer needed. Structured
concurrency provides a simpler syntax that is similar to async/await but also has advanced features
for managing trees of processes.

Why choose Suspenders.js over async/await? Async await doesn't have methods for canceling running
processes or structuring related processes. Structured concurrency has advanced features for longer
running trees of processes that need to be coordinated together and canceled together.

Why choose Suspenders.js over Rx.js. Suspenders.js coroutines have a simpler syntax using the
`yield*` keyword for unwrapping values. For example `const x = yield* getValue()` to get an single
value asynchronously instead of `getValue().flatMap((x) => ...)`. Also, coordinating a tree of related
processes using structured concurrency has no analog in Rx.js. Coroutines are cleaner to write because
they do not require a large library of combinators functions. Reading coroutines is more natural due
to the syntax being indistinguishable from normal synchronous code.

## Structured Concurrency Terminology

What is structured concurrency? It is a way of organizing running processes into a tree and
managing the error handling this tree of processes. Nodes on this tree are `Job`s. `Job`s have one of
three states, RUNNING, COMPLETING or COMPLETED. A `Job` tree automatically removes `Job`s that have
COMPLETED. A COMPLETING `Job` is waiting for all of its children to complete before COMPLETING
itself. No new RUNNING child `Job`s can be added as a direct child to a COMPLETING `Job`.

A `CoroutineScope` is a special type of `Job` for starting, also known as building, a coroutine. A
coroutine has an associated node in the `Job` tree with the parent being the `CoroutineScope` `Job`.

Unhandled thrown errors are propagated up the tree until it is either handled by an error handler
function associated with a `Job` or special type of `Job` called a `SupervisorScope`. Unlike all
other `Job`s, `SupervisorScope`s do not propagate errors up the `Job` tree for unhandled errors
in their children and do not cancel their other child `Job`s.

## Structured Concurrency error propagation

    An example of a tree of running Jobs
    -* CoroutineScope-1
     |-* CoroutineJob-1
     |-* CoroutineJob-2
     |-* CoroutineScope-2
     | |-* CoroutineJob-3
     | \-* CoroutineJob-4
     \-* SupervisorScope-1
       |-* CoroutineJob-5
       \-* CoroutineJob-6

## Flows

*TODO*

## Examples

```ts
import { awaitPromise, channel, Coroutine, CoroutineScope, Deferred, Scope } from "suspenders-js"

// Coroutine that suspends for 2 seconds and then returns "resolved"
function* returnAfter2Seconds(): Coroutine<string> {
    yield* delay(2_000) // yield* is required for generator to suspend
    return "resolved"
}

// Starts a coroutine in a `CoroutineScope`
CoroutineScope().launch(function* () {
    // *print* "hello"
    console.log("hello")
    // *wait 2 seconds* and returns "resolved"
    const result = yield* returnAfter2Seconds() // yield* is required to call other coroutines
    // *print* "resolved"
    console.log(result)
})

// Asynchronously call coroutines.

function* jobA(): Coroutine<number> {
    yield* delay(100)
    return 1
}

function* jobB(): Coroutine<number> {
    yield* delay(200)
    return 2
}

CoroutineScope().launchCoroutineScope(function* (this: Scope) {
    // Starts a child coroutine without suspending the current coroutine
    const deferredA: Deferred<number> = this.async(function* () {
        return yield* jobA() // runs concurrently
    })

    const deferredB: Deferred<number> = this.async(jobB) // simplified syntax

    // This suspends the current coroutine until there is a result for deferredA
    const resultA = yield* resultA.await()
    const resultB = yield* resultB.await()
})

// Flows emit multiple async values. They provide a typical functional interface like map() and
// .filter(). Flows are cold, meaning they don't start producing values unless they have an
// observer.

flow<number>(function* (emit) {
    for (let i = 1; i <= 200; i++) {
        yield* emit(i) // yield* is required for back pressure
    }
})
    .filter(x => x % 2 === 1)
    .map(x => x + x)
    .onEach(x => console.log(x))
    // This will start the flow in a `Scope`.
    .launchIn(CoroutineScope())

// This starts a coroutine that consumes two flows in order.

CoroutineScope().launch(function* () {
    // suspends until flow completes

    yield* flowOf<number>(function* (emit) {
        for (let i = 1; i <= 200; i++) {
            yield* emit(i)
        }
    })
        .filter(x => x % 2 === 1)
        .map(x => x + x)
        // Collect() consumes the flow until it completes.
        // Resumes the coroutine once the flow has completed.
        .collect(x => console.log(x))

    yield* flow<number>(function* (emit) {
        for (let i = 1; i <= 200; i++) {
            yield* emit(i)
        }
    })
        .filter(x => x % 2 === 1)
        .map(x => x + x)
        .collect(x => console.log(x))
})

// Channels are for communication between coroutines.

const channel = channel<number>()

// Producer/consumer coroutines communicating through a channel.

CoroutineScope().launch(function* () {
    for (let i = 1; i <= 200; i++) {
        yield* channel.send(i)
    }
})

CoroutineScope().launch(function* () {
    for (; ;) {
        const x = yield* this.suspend(channel.receive)

        if (x % 2 === 1) {
            const y = x + x
            console.log(y)
        }
    }
})
```

## References

[Kotlin Coroutines](https://github.com/Kotlin/KEEP/blob/master/proposals/coroutines.md)

[Notes on structured concurrency, or: Go statement considered harmful](https://vorpus.org/blog/notes-on-structured-concurrency-or-go-statement-considered-harmful/)

[Structured Concurrency](https://250bpm.com/blog:71/)

[Roman Elizarov — Structured concurrency](https://www.youtube.com/watch?v=Mj5P47F6nJg)

[Taming the Asynchronous Beast with CSP Channels in JavaScript](https://archive.jlongster.com/Taming-the-Asynchronous-Beast-with-CSP-in-JavaScript)

[Communicating Sequential Processes](http://www.usingcsp.com/cspbook.pdf)
