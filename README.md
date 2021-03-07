# Suspenders.js: Structured concurrency for JavaScript

# Suspenders.js 0.0.8 (alpha)

Suspenders.js is a library for asynchronous programming that supports coroutines, functional
reactive programming, communicating sequential processes and "structured concurrency".
Suspenders.js takes inspiration from Kotlin's coroutines to combine functional and imperative
programming styles for asynchronous programming.

[Apache 2.0 License](LICENSE)

## Intro

Anyone who has written a large amount of asynchronous code in JavaScript is familiar with callback
hell. Coroutines flatten those callbacks into what looks like regular synchronous code. Coroutines
are special JavaScript generators that suspend using the 'yield' keyword whenever it would block.
When an asynchronous result is ready, it resumes the coroutine where it left off without needing a
callback. Unlike Promises or Async/Await, coroutines can be canceled after started. Any asynchronous
tasks they are suspended on will be stopped and their finally blocks will be called to clean up
resources.

What is structured concurrency? It organizes running coroutines into scopes to better reason about
their lifetimes, error handling and cancelation. Coroutines are launched within a scope where they
run until complete, throw an error or the scope is canceled. A coroutine's finally block will run
even after being canceled. This ensures that resources like network connections or file descriptors
are always closed when no longer needed. If a coroutine throws an error, the containing scope
cancels with an error. Canceled scopes propagate cancelation to all coroutines within it. And scopes
that canceled with an error, call their error callback and bubble up the error to their parent
scope.

Additionally "Structured Concurrency" allows for automatic cancelation of coroutines that are no
longer needed. For example, it is common to race two Promises and only take the result of the first
to complete. The second promise cannot be canceled once started and will continue to run to
completion. Suspenders.js automatically cancels coroutines who's results are no longer needed,
making more efficient use of resources.

## Why another async programming library?

Why choose Suspenders.js over JavaScript Promises? Promises are good when your async process is
short running and will never need to be canceled. With Suspenders.js, your async processes can run
for as long as required and then canceled when they are no longer needed.

Why choose Suspenders.js over async generators? Async generators can be canceled by calling
.return() on their iterator. If their finally block requires another async operation it will not run
to completion. Also the last promise in an async generator cannot be canceled because promises are
not cancelable. Async generators cannot be canceled as a group or raced to get the fastest result.

Why choose Suspenders.js over async/await? Async await doesn't have structured concurrency and
cancelation.

Why choose Suspenders.js over Rx.js. Suspenders.js coroutines are a cleaner way of handling
chains of single async values. RxJava2 has the Single<T> class for this purpose. Since Rx.js does
not currently support Single<T>, Suspenders.js should be used to handle chains of async singles.

Why choose Suspenders.js over JS-CSP? Suspenders.js makes controlling the lifetime and cancelation
of processes simple through "Structured Concurrency". Suspenders.js has support for functional
reactive programming style using Flow, EventSubject (hot events) and StateSubject (hot state).
Suspenders.js also has channels to support communicating sequential processes. However, channels are
error prone and can lead to communication deadlocks, and should be avoided if other less error prone
abstractions can be used.

## Examples

```ts
import {
  Channel,
  EventSubject,
  flowOf,
  Scope,
  race,
  wait,
} from "suspenders-js";

const scope = new Scope();

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

const scope = new Scope();

// Flows emit multiple async values. They provide a typical functional interface like map() and
// .filter(). Flows are cold, meaning they don't emit values unless they have an observer.

flowOf<number>((collector) => function*() {
  for (let i = 1; i <= 200; i++) {
    collector.emit(i);
  }
})
  .filter(x => x % 2 === 1)
  .map(x => x + x)
  .onEach(x => console.log(x))
  // This will start the flow in scope.
  .launchIn(scope);

// This starts a coroutine that consumes two flows in order.

scope.launch(function* () {
  // suspends until flow completes

  yield flowOf<number>((collector) => function*() {
    for (let i = 1; i <= 200; i++) {
      collector.emit(i);
    }
  })
    .filter(x => x % 2 === 1)
    .map(x => x + x)
    // Collect() consumes the flow until it completes.
    // Resumes the coroutine once the flow has completed.
    .collect(x => console.log(x));

  yield flowOf<number>((collector) => function*() {
    for (let i = 1; i <= 200; i++) {
      collector.emit(i);
    }
  })
    .filter(x => x % 2 === 1)
    .map(x => x + x)
    .collect(x => console.log(x));
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
  for (;;) {
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
  yield eventSubject
    .transform<number>((x, collector) => function* () {
      if (x % 2 === 1) {
        yield wait(10);
        collector.emit(x + x);
      }
    })
    .collect(x => {
      console.log(x);
    });
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
  const x = yield* this.call(anotherCoroutine);
  console.log(x);
});

scope.launch(function* () {
  // This will resume before all coroutines launched from anotherCoroutine() have completed.
  const x = yield* anotherCoroutine.call(this);
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

scope.launch<void>(function* () {
  // Runs both jobs concurrently.

  const [resultA, resultB] = yield* this.suspend2(
    this.callAsync(jobA),
    this.callAsync(jobB),
  );

  console.log(`${resultA} ${resultB}`);
});

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
