import { Scope } from "./Scope";
import { suspendPromise } from "./Util";

describe(`Util tests`, () => {
  it(`suspending on a promise`, (done) => {
    const scope = new Scope({ errorCallback: (error) => { done(error); }});

    scope.launch(function* () {
      const x = yield* suspendPromise(new Promise<number>((r) => { r(1); }));

      if (x !== 1) {
        done(`unexpected result`);
      }

      done();
      this.cancel();
    });
  });

  it(`suspending on a promise error`, (done) => {
    const scope = new Scope({ errorCallback: (error) => { done(error); }});

    scope.launch(function* () {
      try {
        yield* suspendPromise(new Promise<number>((_, r) => { r(1); }));
      } catch (error) {
        if (error === 1) {
          done();
          this.cancel();
        }
      }
    });
  });
});
