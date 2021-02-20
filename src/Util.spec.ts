import { Scope } from "./Scope";
import { race, promiseSuspender, wait } from "./Util";

describe(`Util tests`, () => {
  it(`race cancels slower coroutine 1`, (done) => {
    new Scope({ errorCallback: (error) => { done(error); }})
      .launch(function* () {
        let finallyCalled = false

        const result = yield* this.suspend(race(
          this.callAsync(function* () {
            yield wait(0);
            return 0;
          }),
          this.callAsync(function* () {
            try {
              yield wait(5);
              done(`this should not run`);
              this.cancel();
              return 1;
            } finally {
              finallyCalled = true;
            }
          }),
        ));

        if (result === 0 && finallyCalled) {
          done();
        } else {
          done(`result: ${result} finallyCalled: ${finallyCalled}`);
        }

        this.cancel();
      });
  });

  it(`race cancels slower coroutine 2`, (done) => {
    new Scope({ errorCallback: (error) => { done(error); }})
      .launch(function* () {
        let finallyCalled = false

        const result = yield* this.suspend(race(
          this.callAsync(function* () {
            try {
              yield wait(5);
              done(`this should not run`);
              this.cancel();
              return 1;
            } finally {
              finallyCalled = true;
            }
          }),
          this.callAsync(function* () {
            yield wait(0);
            return 0;
          }),
        ));

        if (result === 0 && finallyCalled) {
          done();
        } else {
          done(`result: ${result} finallyCalled: ${finallyCalled}`);
        }

        this.cancel();
      });
  });

  it(`suspending on a promise`, (done) => {
    const scope = new Scope({ errorCallback: (error) => { done(error); }});

    scope.launch(function* () {
      const x = yield* this.suspend(promiseSuspender(new Promise<number>((r) => { r(1); })));

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
        yield* this.suspend(promiseSuspender(new Promise<number>((_, r) => { r(1); })));
      } catch (error) {
        if (error === 1) {
          done();
          this.cancel();
        }
      }
    });
  });
});
