import { CancelFunction, Result, ResultCallback, Suspender } from "./Types";

/**
 * Starts the suspender but doesn't wait for it's result. Returns a new suspender that returns the
 * result.
 * @param {Suspender<T>} suspender
 * @return {Suspender<T>}
 */
export const async = <T>(suspender: Suspender<T>): Suspender<T> => {
  let result: Result<T> | undefined;
  let resultCallback: ResultCallback<T> | undefined;

  return (resCallback) => {
    if (result !== undefined) {
      resCallback(result);
    } else {
      resultCallback = resCallback;
    }

    return suspender((res) => {
      if (resultCallback !== undefined) {
        resultCallback(res);
      } else {
        result = res;
      }
    });
  };
}

/**
 * Returns the first suspender to resolve successfully. All other pending suspenders are canceled.
 * If all suspenders error, throws the last error.
 * @params {Array<Suspender<T>>} suspenders
 * @return {Suspender<T>}
 */
export const race = <T>(...suspenders: Array<Suspender<T>>): Suspender<T> => {
  return (resultCallback) => {
    const cancelCallbacks: Array<CancelFunction | void | null> = [];

    for (let [index, suspender] of suspenders.entries()) {
      cancelCallbacks.push(suspender((value) => {
        cancelCallbacks[index] = null;

        // cancel all other suspenders
        for (let m = 0; m < suspenders.length; m++) {
          const cancel = cancelCallbacks[m];

          if (cancel) {
            cancel();
          } else {
            cancelCallbacks[m] = null;
          }
        }

        resultCallback(value);
      }));
    }

    return () => {
      for (const cancelCallback of cancelCallbacks) {
        if (cancelCallback) {
          cancelCallback();
        }
      }
    };
  };
}

/**
 * Returns a suspender that resolves with given timout.
 * @param {number} millis
 * @return {Suspender<void>}
 */
export const wait = (millis: number): Suspender<void> => {
  return (resultCallback) => {
    const timeout = setTimeout(() => {
      resultCallback({ value: undefined });
    }, millis);
    return () => {
      clearTimeout(timeout);
    };
  };
}

export const awaitCancelation = (): Suspender<void> => {
  return () => {};
}

/**
 * Converts a Promise<T> to a Suspender<T>.
 * @param {Promise<T>} promise
 * @return {Suspender<T>}
 */
export const promiseSuspender = <T>(promise: Promise<T>): Suspender<T> => {
  return (resultCallback: ResultCallback<T>) => {
    promise.then(
      (value) => { resultCallback({ value }); },
      (error) => { resultCallback({ tag: `error`, error}); }
    );
  };
}

/**
 * Performs an http get on url. Returns body on 200 or throws error.
 * @param {string} url
 * @return {Suspender<T>}
 */
export const httpGet = (url: string): Suspender<string> => {
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
