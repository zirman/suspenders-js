# Suspenders.js: Structured concurrency for JavaScript

# Suspenders.js 0.0.1 (alpha)

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
completion. Suspenders.js automatically cancels coroutines who's results are no longer needed, making
more efficient use of resources.

## Why another async programming library?

Why choose Suspenders.js over JavaScript Promises? Promises are good when your async process is
short running and will never need to be canceled. With Suspenders.js, your async processes can run
for as long as required and then canceled when they are no longer needed.

Why choose Suspenders.js over async generators? Async generators can be canceled by calling
.return() on their iterator. If their finally block requires another async operation it will not run
to completion. Also the last promise in an async generator cannot be canceled because promises are
not cancelable. Async generators cannot be canceled as a group or raced to get the fastest result.

Why choose Suspsnders.js over async/await? Async await doesn't have structured concurrency and
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
import { Scope, Observer } from "suspenders-js";

const scope = new Scope();

flowOf((consumer: Consumer<number>) => function*() {
  for (let i = 1; i <= 200; i++) {
    consumer.emit(i);
  }
})
  .filter(x => x % 2 === 1)
  .map(x => x + x)
  .onEach(x => console.log(x))
  .launchIn(scope);
```

## References

[Notes on structured concurrency, or: Go statement considered harmful](https://vorpus.org/blog/notes-on-structured-concurrency-or-go-statement-considered-harmful/)

[Structured Concurrency](https://250bpm.com/blog:71/)

[Roman Elizarov — Structured concurrency](https://www.youtube.com/watch?v=Mj5P47F6nJg)

[Taming the Asynchronous Beast with CSP Channels in JavaScript](https://archive.jlongster.com/Taming-the-Asynchronous-Beast-with-CSP-in-JavaScript)

[Communicating Sequential Processes](http://www.usingcsp.com/cspbook.pdf)
