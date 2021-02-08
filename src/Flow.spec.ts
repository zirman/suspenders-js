import { flowOf, flowOfValues } from "./Flow";
import { Scope } from "./Scope";
import { wait } from "./Util";

describe("scope error callback is called when an error occurs in a flow", () => {
  it("throwing error in .map() calls scope error callback", (done) => {
    const scope = new Scope({ errorCallback: () => { done(); }});

    flowOfValues(1, 2, 3)
      .map(() => { throw new Error(); })
      .launchIn(scope);
  });

  it("throwing error in .filter() calls scope error callback", (done) => {
    const scope = new Scope({ errorCallback: () => { done(); }});

    flowOfValues(1, 2, 3)
      .filter(() => { throw new Error(); })
      .launchIn(scope);
  });

  it("throwing error in .flatMap() calls scope error callback", (done) => {
    const scope = new Scope({ errorCallback: () => { done(); }});

    flowOfValues(1, 2, 3)
      .flatMap(() => { throw new Error(); })
      .launchIn(scope);
  });

  it("throwing error in .onEach() calls scope error callback", (done) => {
    const scope = new Scope({ errorCallback: () => { done(); }});

    flowOfValues(1, 2, 3)
      .onEach(() => { throw new Error(); })
      .launchIn(scope);
  });

  it("throwing error in .collect() calls scope error callback", (done) => {
    const scope = new Scope({ errorCallback: () => { done(); }});

    scope.launch(function*() {
      yield flowOfValues(1, 2, 3)
        .collect(this, () => { throw new Error(); });
    });
  });

  it("throwing error in .collectLatest() calls scope error callback", (done) => {
    const scope = new Scope({ errorCallback: () => { done(); }});

    scope.launch(function*() {
      yield flowOfValues(1, 2, 3)
        .collectLatest(this, () => function*() { throw new Error(); });
    });
  });

  it("throwing error in .transform() calls scope error callback", (done) => {
    const scope = new Scope({ errorCallback: () => { done(); }});

    flowOfValues(1, 2, 3)
      .transform<null>((value, observer) => function*() { throw new Error(); })
      .launchIn(scope);
  });

  it("parent scope error callback is called when child scope errors", (done) => {
    const parent = new Scope({ errorCallback: () => { done(); }});
    const scope = new Scope({ parent });

    flowOfValues(1, 2, 3)
      .map((value) => { throw new Error(); })
      .launchIn(scope);
  });

  // it("parent scope error callback is called when child scope errors", (done) => {
  //   const scope = new Scope({ errorCallback: (error) => { done(error); }});

  //   flowOf<number>((observer) => function* () {
  //     yield wait(1);
  //     observer.emit(1);
  //   })
  //     .onEach((x) => {
  //       strictAssert();
  //     })
  //     .launchIn(scope);
  // });
});
