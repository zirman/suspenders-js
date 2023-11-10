# Suspenders.js: Structured concurrency for JavaScript

# Suspenders.js 0.0.9 (alpha)

Suspenders.js is a library for asynchronous programming that supports coroutines, functional
reactive programming, communicating sequential processes and "structured concurrency". Suspenders.js
takes inspiration from Kotlin's coroutines to combine functional and imperative programming styles
for asynchronous programming.

[Apache 2.0 License](LICENSE)

## Intro

Anyone who has written a large amount of asynchronous code in JavaScript is familiar with callback
hell. Coroutines flatten those callbacks into what looks like regular synchronous code. Coroutines
are special JavaScript generators that suspend using the 'yield*' keyword whenever it would block.
When an asynchronous result is ready, it resumes the coroutine where it left off without needing a
callback. Unlike Promises or Async/Await, coroutines can be canceled. Any asynchronous tasks that
stopped, and their finally blocks will be called to clean up resources.

What is structured concurrency? It organizes running coroutines, also known as `Job`s, into
`CoroutineScope`s to better reason about their lifetimes. A coroutine is launched within a
`CoroutineScope`. Where it run until it completes, throws an error, or the `CoroutineScope` is
canceled. When a coroutine throws an error, the error is propagated to it's parent `CoroutineScope`,
which can either handle the error, or throw it to it's parent `CoroutineScope` and so on. A
`CoroutineScope` that doesn't handle the error it's automatically canceled which canceles all it's
children coroutines.

Coroutines allow for more efficient resource management through cancellation. For example if a file
is opened in a coroutine's `try` block and closed in the `finally` block, it is guarenteed that the
file is closed regardless of if the coroutine completes or is canceled. This is because all
`finally` blocks are run automatically when a coroutine is canceled.

## Why another async programming library?

Why choose Suspenders.js over JavaScript Promises? Promises are good when your async process is
simple, short running and will never need to be canceled. With Suspenders.js, your async processes
can run for as long as required and then canceled when they are no longer needed. Coroutines provide
a simpler sytnax that is similar to async/await but also have advanced features that are better for
long running groups of processes that need to be coordinated together and canceled together.

Why choose Suspenders.js over async/await? Async await doesn't have structured concurrency and
cancellation. Coroutines has advanced features that are better for long running groups of processes
that need to be coordinated together and canceled together.

Why choose Suspenders.js over Rx.js. Suspenders.js coroutines have a simpler syntax using the
`yield*` keyword for unwrapping values. For example `const x = yield* await()` to get an single
value asynchronously instead of `await().flatMap((x) => ...)`. Also coordinging a tree of processes
using structured concurrency has no analog in Rx.js.

## Examples

```ts
import {awaitPromise, channel, flowOf, CoroutineScope} from "suspenders-js"

// Structured concurrency
// Scopes have ownership of coroutines. Coroutines are launched in a scope. If that scope is
// canceled, then any coroutines and subscopes within it will be canceled as well. If a coroutine
// throws an error, it cancels it's owning scope with an error. Scopes canceled with an error
// will bubble the the error up to it's parent, canceling the whole tree.

// For example if scope1 is canceled all coroutines would be canceled in the graph below. But if
// scope2 is canceled, only coroutine3 and coroutine4 are canceled. If coroutine3 throws an error,
// all the coroutines and scopes are canceled.

// + - scope1
//   |
//   + - coroutine1
//   |
//   + - coroutine2
//   |
//   + - scope2
//     |
//     + - coroutine3
//     |
//     + - coroutine4

const scope = CoroutineScope()

function* returnAfter2Seconds(): Coroutine<string> {
    yield* delay(2_000) // suspends for 2 seconds
    return "resolved"
}

scope.launch(function* () {
    console.log('calling')
    const result = yield* returnAfter2Seconds()
    console.log(result)
    // Expected output: "resolved"
})

// Flows emit multiple async values. They provide a typical functional interface like map() and
// .filter(). Flows are cold, meaning they don't emit values unless they have an observer.

flow<number>(function* (emit) {
    for (let i = 1; i <= 200; i++) {
        yield* emit(i)
    }
})
    .filter(function* (x) { return x % 2 === 1 })
    .map(function* (x) { return x + x })
    .onEach(function* (x) { return console.log(x) })
    // This will start the flow in scope.
    .launchIn(scope)

// This starts a coroutine that consumes two flows in order.

scope.launch(function* () {
    // suspends until flow completes

    yield* flowOf<number>(function* (emit) {
        for (let i = 1; i <= 200; i++) {
            yield* emit(i)
        }
    })
        .filter(function* (x) { return x % 2 === 1 })
        .map(function* (x) { return x + x })
        // Collect() consumes the flow until it completes.
        // Resumes the coroutine once the flow has completed.
        .collect(function* (x) { return console.log(x) })

    yield* flow<number>(function* (emit) {
        for (let i = 1; i <= 200; i++) {
            yield* emit(i)
        }
    })
        .filter(function* (x) { return x % 2 === 1 })
        .map(function* (x) { return x + x })
        .collect(function* (x) { return console.log(x) })
});

// Channels are for communication between coroutines.

const channel = new Channel<number>();

// Producer/consumer coroutines communicating through a channel.

scope.launch(function* () {
    for (let i = 1; i <= 200; i++) {
        yield channel.send(i);
    }
});

scope.launch(function* () {
    for (; ;) {
        const x = yield* this.suspend(channel.receive);

        if (x % 2 === 1) {
            const y = x + x;
            console.log(y);
        }
    }
});

// Transform() is a powerful way to process values emitted by a flow. It takes a coroutine that can
// perform more asynchronous tasks and emit 0 or more values downstream.

const eventSubject = new EventSubject<number>();

scope.launch(function* () {
    yield* eventSubject
        .transform<number>(function* (x, emit) {
            if (x % 2 === 1) {
                yield* delay(10)
                yield* emit(x + x)
            }
        })
        .collect(x => {
            console.log(x)
        })
})

// Pushes events to observers on eventSubject.

for (let i = 1; i <= 200; i++) {
    eventSubject.emit(i);
}

// Calling another coroutine from a coroutine.

function* anotherCoroutine(this: Scope) {
    yield wait(100);

    // This doesn't wait for the result of the launched coroutine.
    this.launch(function* () {
        yield wait(200);
    });

    return 1;
}

scope.launch(function* () {
    // This ensures all coroutines launched from anotherCoroutine() are completed before resuming.
    const x = yield* anotherCoroutine();
    console.log(x);
});

// Asynchronously call coroutines.

function* jobA(this: Scope) {
    yield wait(100);
    return 1;
}

function* jobB(this: Scope) {
    yield wait(200);
    return 2;
}

// scope.launch<void>(function* () {
//   // Runs both jobs concurrently.

//   const resultA = this.async(jobA);
//   const resultB = this.async(jobB);

//   yield* resultA.await();

//   const [resultA, resultB] = yield* this.suspend2(
//     this.callAsync(jobA),
//     this.callAsync(jobB),
//   );

//   console.log(`${resultA} ${resultB}`);
// });

scope.launch<void>(function* () {
    // Races jobA with jobB to get the faster result. Cancels the slower job.

    const fastestResult = yield* this.suspend(race(
        this.callAsync(jobA),
        this.callAsync(jobB),
    ));

    console.log(fastestResult);
});
```

## References

[Kotlin Coroutines](https://github.com/Kotlin/KEEP/blob/master/proposals/coroutines.md)

[Notes on structured concurrency, or: Go statement considered harmful](https://vorpus.org/blog/notes-on-structured-concurrency-or-go-statement-considered-harmful/)

[Structured Concurrency](https://250bpm.com/blog:71/)

[Roman Elizarov — Structured concurrency](https://www.youtube.com/watch?v=Mj5P47F6nJg)

[Taming the Asynchronous Beast with CSP Channels in JavaScript](https://archive.jlongster.com/Taming-the-Asynchronous-Beast-with-CSP-in-JavaScript)

[Communicating Sequential Processes](http://www.usingcsp.com/cspbook.pdf)
