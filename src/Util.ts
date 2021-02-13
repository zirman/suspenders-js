import { CoroutineSuspender, Suspender } from "./Types";

/**
 * Suspends the current coroutine until the suspender results with a value/error or is canceled.
 * @param {Suspender<T>} suspender
 */
export function* suspend<T>(suspender: Suspender<T>): CoroutineSuspender<T> {
  return (yield suspender) as T;
}

/**
 * Suspends on a promise.
 * @param {Promise<T>} promise
 * @return {Suspender<T>}
 */
export function* suspendPromise<T>(promise: Promise<T>): CoroutineSuspender<T> {
  return (yield (resultCallback) => {
    promise.then(
      (value) => { resultCallback({ value }); },
      (error) => { resultCallback({ tag: `error`, error}); }
    );
  }) as T;
}

export function wait(time: number): Suspender<void> {
  return (resultCallback) => {
    const timeout = setTimeout(() => {
      resultCallback({ value: undefined });
    }, time);
    return () => {
      clearTimeout(timeout);
    };
  };
}

export function awaitCancelation(): Suspender<void> {
  return () => {};
}

export function httpGet(url: string): Suspender<string> {
  return (resultCallback) => {
    const xhttp = new XMLHttpRequest();

    xhttp.onloadend = function() {
      if (this.status === 200) {
        resultCallback({ value: this.responseText });
      } else {
        resultCallback({
          tag: `error`,
          error: new Error(`code: ${this.status} text: ${this.statusText}`)
        });
      }
    };

    xhttp.open(`GET`, url, true);
    xhttp.send();

    return () => { xhttp.abort(); };
  };
}
