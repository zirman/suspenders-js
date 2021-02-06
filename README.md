Suspenders.js is a library for asynchronous programming that supports "structured concurrency"
functional reactive programming and CSP using JavaScript generators. Suspenders.js take
inspiration from Kotlin's coroutines to combine imperitive and functional programming styles for
asynchronous programming.

Everyone who has written a large amount of asynchronous code in JavaScript is familiar with the
stair step of doom caused by nested callbacks (callback hell). With coroutines those steps get
flattened into a single set of curley braces.

Additinally "Structured Concurrency" allows for automatic cancelation of coroutines that are no
longer needed. It is common to race two Promises and only take the result of the first to
complete. Unfortunately the second promise cannot be canceled once started and will continue to
run, wasting resources. Suspenders.js automatically cancel coroutines whos results are no longer
needed, making more efficient use of resources.

Coroutines are similar to green threads. It looks like regular imperitive code that blocks when
waiting for a result. Using JS Generators, it can suspend with the yield keyword and resume when
the value is ready without a callback.

Why choose Suspenders.js over async generators? Async generators can be canceled with .return()
On their iterator but their last async request cannot be canceled because promises cannot be
canceled. Also there isn't an easy way to cancel groups of related async generators.

Why choose Suspsnders.js over async/await?

Why structured concurrency? It organizes concurrently running coroutines to better reason about
their lifetimes, error handling and cancelation. Coroutines are launched within a scope where
they run until complete, throw an error or the scope is canceled. A coroutine's finally block
will run even after being canceled. This ensures that resources like network connections or
file descriptors are always closed when no longer needed. If a coroutine throws an error, the
containing scope cancels with an error. Canceled scopes propagate cancelation to all coroutines
within it. And scoped that canceled with an error, call their error callback and bubble up the
error to their parent scope.

Why choose Suspenders.js over JavaScript Promises? Promises are good when your async process is
short running and will never need to be canceled once started. With Suspenders.js, your async
processes can run for as long as required and then canceled when they are no longer needed,
freeing up any resources they were using.

Why choose Suspenders.js over Rx.js. Suspenders.js coroutines are a cleaner way of handling
chains of single async values. RxJava2 has the Single<T> class for this purpose. Since Rx.js does
not currently support Single<T>, Suspenders.js should be used to handle chains of single values.

Why choose Suspenders.js over JS-CSP? Suspenders.js makes controling the lifetime and cancelation
of processes simple through scopes using "Structured Concurrency". Suspenders.js has support
for functional reactive programming style using Flow, EventSubject (hot events) and StateSubject
(hot state). Suspenders.js also has Channels to support communicating sequential processes.
However, channels are error prone and can lead to communication deadlocks, and therefore should
be avoided if other less error prone abstrations can be used.

ref - https://vorpus.org/blog/notes-on-structured-concurrency-or-go-statement-considered-harmful/
ref - https://www.youtube.com/watch?v=Mj5P47F6nJg
ref - https://250bpm.com/blog:71/
ref - https://archive.jlongster.com/Taming-the-Asynchronous-Beast-with-CSP-in-JavaScript
ref - http://www.usingcsp.com/cspbook.pdf
