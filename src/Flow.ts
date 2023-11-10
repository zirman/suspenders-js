import { LaunchScope, Scope } from "./Scope.js";
import { Coroutine } from "./Types.js";

/**
 *
 */
export interface Flow<T> {
    /**
     * The terminal operator that returns the first element emitted by the flow and then cancels flow's collection when
     * no predicate given. Throws NoSuchElementException if the flow was empty.
     *
     * When given a predicate, returns first element emitted by the flow matching the given predicate and then cancels
     * flow's collection. Throws NoSuchElementException if the flow has not contained elements matching the predicate.
     *
     * @param {<T>(value: T) => boolean} [predicate] - predication function
     */
    first(predicate?: (value: T) => boolean): Coroutine<T>;

    /**
     * The terminal operator that returns the last element emitted by the flow. Throws NoSuchElementException if the
     * flow was empty.
     */
    last(): Coroutine<T>

    /**
     * The terminal operator that returns the last element emitted by the flow or null if the flow was empty.
     */
    lastOrNull(): Coroutine<T | null>

    /**
     * Applies transform function to each value of the given flow. The receiver of the transform is FlowCollector and
     * thus transform is a flexible function that may transform emitted element, skip it or emit it multiple times. This
     * operator generalizes filter and map operators and can be used as a building block for other operators, for
     * example:
     * @example
     * function skipOddAndDuplicateEven(flow: Flow<number>): Flow<Int> {
     *     return flow.transformConcat(function* (value, emit) {
     *         if (value % 2 === 0) { // Emit only even values, but twice
     *             yield* emit(value)
     *             yield* emit(value)
     *         } // Do nothing if odd
     *     })
     * }
     * @param {<T, R>(inValue: T, emit: (outValue: R) => Coroutine<void>) => Coroutine<void>} transformer
     */
    transform<R>(transformer: (inValue: T, emit: (outValue: R) => Coroutine<void>) => Coroutine<void>): Flow<R>

    /**
     * Returns a flow that produces element by transform function every time the original flow emits a value. When the
     * original flow emits a new value, the previous transform block is cancelled, thus the name transformLatest.
     * For example, the following flow:
     * @example
     * flow(function* (emit) {
     *     yield* emit('a')
     *     yield* delay(100)
     *     yield* emit('b')
     * }).transformLatest(function* (value) {
     *     yield* emit(value)
     *     yield* delay(200)
     *     yield* emit(value + '_last')
     * })
     *
     * produces a b b_last.
     * This operator is buffered by default and size of its output buffer can be changed by applying subsequent buffer
     * operator.
     * @param {<T, R>(inValue: T, emit: (outValue: R) => Coroutine<void>} transformer
     */
    transformLatest<R>(transformer: (inValue: T, emit: (outValue: R) => Coroutine<void>) => Coroutine<void>): Flow<R>

    /**
     * Applies transform function to each value of the given flow while this function returns true.
     * The receiver of the transformWhile is FlowCollector and thus transformWhile is a flexible function that may
     * transform emitted element, skip it or emit it multiple times.
     * This operator generalizes takeWhile and can be used as a building block for other operators. For example, a flow
     * of download progress messages can be completed when the download is done but emit this last message (unlike
     * takeWhile):
     * @example
     * function completeWhenDone(flow: Flow<DownloadProgress>): Flow<DownloadProgress> {
     *     return flow.transformWhile(function* (progress) {
     *         yield* emit(progress) // always emit progress
     *         return !progress.isDone() // continue while download is not done
     *     })
     * }
     * @param {<T, R>(inValue: T, emit: (outValue: R) => Coroutine<void>) => Coroutine<boolean>} transformer
     */
    transformWhile<R>(transformer: (inValue: T, emit: (outValue: R) => Coroutine<void>) => Coroutine<boolean>): Flow<R>

    /**
     * Returns a flow containing the results of applying the given transform function to each value of the original
     * flow.
     * @param {<T, R>(value: T) => (void | Coroutine<R>)} mapper
     */
    map<R>(mapper: (value: T) => (void | Coroutine<R>)): Flow<R>

    /**
     * Returns a flow that emits elements from the original flow transformed by transform function. When the original
     * flow emits a new value, computation of the transform block for previous value is canceled.
     * For example, the following flow:
     * @example
     * flow(function* () {
     *     yield* emit('a')
     *     yield* delay(100)
     *     yield* emit('b')
     * }).mapLatest(function* (value) {
     *     console.log(`Started computing ${value}`)
     *     yield* delay(200)
     *     return `Computed ${value}`
     * })
     *
     * will print "Started computing a" and "Started computing b", but the resulting flow will contain only "Computed b"
     * value.
     * This operator is buffered by default and size of its output buffer can be changed by applying subsequent buffer
     * operator.
     * @param {<T, R>(value: T) => Coroutine<R>} collector
     */
    mapLatest<R>(collector: (value: T) => Coroutine<R>): Flow<R>

    /**
     * Returns a flow that contains only non-null results of applying the given transform function to each value of the
     * original flow.
     * @param {<T, R>(value: T) => ((R | null) | Coroutine<R | null>)} mapper
     */
    mapNotNull<R>(mapper: (value: T) => ((R | null) | Coroutine<R | null>)): Flow<R>

    /**
     * Transforms elements emitted by the original flow by applying transform, that returns another flow, and then
     * concatenating and flattening these flows.
     * This method is a shortcut for map(transform).flattenConcat(). See flattenConcat.
     * Note that even though this operator looks very familiar, we discourage its usage in a regular
     * application-specific flows. Most likely, suspending operation in map operator will be sufficient and linear
     * transformations are much easier to reason about.
     * @param {<T, R>(value: T) => (Flow<R> | Coroutine<Flow<R>>)} flatMapper
     */
    flatMapConcat<R>(flatMapper: (value: T) => (Flow<R> | Coroutine<Flow<R>>)): Flow<R>

    /**
     * Returns a flow that switches to a new flow produced by transform function every time the original flow emits a
     * value. When the original flow emits a new value, the previous flow produced by transform block is cancelled.
     * For example, the following flow:
     * @example
     * flow(function* (emit) {
     *     yield* emit('a')
     *     yield* delay(100)
     *     yield* emit('b')
     * }).flatMapLatest(function* (value) {
     *     flow(function* (emit) {
     *         yield* emit(value)
     *         yield* delay(200)
     *         yield* emit(value + '_last')
     *     })
     * })
     *
     * // produces a b b_last
     * // This operator is buffered by default and size of its output buffer can be changed by applying subsequent buffer
     * // operator.
     * @param {<T, R>(value: T) => (Flow<R> | Coroutine<Flow<R>>)} flatMapper
     */
    flatMapLatest<R>(flatMapper: (value: T) => (Flow<R> | Coroutine<Flow<R>>)): Flow<R>

    /**
     * Transforms elements emitted by the original flow by applying transform, that returns another flow, and then
     * merging and flattening these flows.
     * This operator calls transform sequentially and then merges the resulting flows with a concurrency limit on the
     * number of concurrently collected flows. It is a shortcut for map(transform).flattenMerge(concurrency). See
     * flattenMerge for details.
     * Note that even though this operator looks very familiar, we discourage its usage in a regular
     * application-specific flows. Most likely, suspending operation in map operator will be sufficient and linear
     * transformations are much easier to reason about.
     * Operator fusion
     * Applications of flowOn, buffer, and produceIn after this operator are fused with its concurrent merging so that
     * only one properly configured channel is used for execution of merging logic.
     * Params:
     * concurrency - controls the number of in-flight flows, at most concurrency flows are collected at the same time.
     * By default, it is equal to DEFAULT_CONCURRENCY.
     * @param {<T, R>(value: T) => (Flow<R> | Coroutine<Flow<R>>)} flatMapper
     */
    flatMapMerge<R>(flatMapper: (value: T) => (Flow<R> | Coroutine<Flow<R>>)): Flow<R>

    /**
     * Returns a flow that invokes the given action before each value of the upstream flow is emitted downstream.
     * @param {<T>(value: T) => (void | Coroutine<void>)} run
     */
    onEach(run: (value: T) => (void | Coroutine<void>)): Flow<T>

    /**
     * Returns a flow that invokes the given action after the flow is completed or canceled, passing the cancellation exception or failure as cause parameter of action.
     * Conceptually, onCompletion is similar to wrapping the flow collection into a finally block, for example the following imperative snippet:
     * @example
     * try {
     *     yield* myFlow.collect(function* (value) {
     *         console.log(value)
     *     })
     * } finally {
     *     console.log('Done')
     * }
     *
     * // can be replaced with a declarative one using onCompletion:
     * @example
     * yield* myFlow
     *     .onEach(function* () { console.log(it) })
     *     .onCompletion(function* () { console.log('Done') })
     *     .collect()
     *
     * // Unlike catch, this operator reports exception that occur both upstream and downstream and observe exceptions that
     * // are thrown to cancel the flow. Exception is empty if and only if the flow had fully completed successfully.
     * // Conceptually, the following code:
     * @example
     * yield* myFlow.collect(function* (value) {
     *     console.log(value)
     * })
     *
     * // console.log('Completed successfully')
     *
     * // can be replaced with:
     * @example
     * yield* myFlow
     *     .onEach(function* () { console.log(it) })
     *     .onCompletion(function* () { if (it === null) console.log('Completed successfully') })
     *     .collect()
     *
     * // The receiver of the action is FlowCollector and this operator can be used to emit additional elements at the
     * // end if it completed successfully. For example:
     * @example
     * yield* flowOf('a', 'b', 'c')
     *     .onCompletion(function* (emit) { yield* emit('Done') })
     *     .collect(function* (value) { console.log(value) }) // prints a, b, c, Done
     *
     * // In case of failure or cancellation, any attempt to emit additional elements throws the corresponding
     * // exception. Use catch if you need to suppress failure and replace it with emission of elements.
     * @param {<T>(emit: (value: T) => (void | Coroutine<void>), error?: unknown) => Coroutine<void>} emitter
     */
    onCompletion(emitter: (emit: (value: T) => (void | Coroutine<void>), error?: unknown) => Coroutine<void>): Flow<T>

    /**
     * Invokes the given action when this flow completes without emitting any elements. The receiver of the action is
     * FlowCollector, so onEmpty can emit additional elements. For example:
     * @example
     * yield* emptyFlow<number>().onEmpty(function* (emit) {
     *     yield* emit(1)
     *     yield* emit(2)
     * }).collect(function* () { console.log(it) }) // prints 1, 2
     * @param {<T>(emit: (value: T) => (void | Coroutine<void>)) => Coroutine<void>} emitter
     */
    onEmpty(emitter: (emit: (value: T) => (void | Coroutine<void>)) => Coroutine<void>): Flow<T>

    /**
     * Returns a flow that invokes the given action before this flow starts to be collected.
     * The action is called before the upstream flow is started, so if it is used with a SharedFlow there is no
     * guarantee that emissions from the upstream flow that happen inside or immediately after this onStart action will
     * be collected (see onSubscription for an alternative operator on shared flows).
     * The receiver of the action is FlowCollector, so onStart can emit additional elements. For example:
     * @example
     * yield* flowOf('a', 'b', 'c')
     *     .onStart(function* (emit) { yield* emit('Begin') })
     *     .collect(function* (value) { console.log(value) }) // prints Begin, a, b, c
     * @param {<T>(emit: (value: T) => Coroutine<void>) => Coroutine<void>} emitter
     */
    onStart(emitter: (emit: (value: T) => (void | Coroutine<void>)) => Coroutine<void>): Flow<T>

    /**
     * @param {(error: unknown) => (void | Coroutine<void>)} coroutineErrorHandler
     */
    catch(coroutineErrorHandler: (error: unknown) => (void | Coroutine<void>)): Flow<T>

    /**
     * Terminal flow operator that collects the given flow with a provided action that takes the index of an element
     * (zero-based) and the element. If any exception occurs during collect or in the provided flow, this exception is
     * rethrown from this method.
     * See also collect and withIndex.
     * @param {<T>(index: number, value: T) => (void | Coroutine<void>)} collector
     */
    collectIndexed(collector: (index: number, value: T) => (void | Coroutine<void>)): Coroutine<void>

    /**
     * Terminal flow operator that launches the collection of the given flow in the scope. It is a shorthand for
     * scope.launch(function* () { yield* flow.collect() }).
     * This operator is usually used with onEach, onCompletion and catch operators to process all emitted values handle
     * an exception that might occur in the upstream flow or during processing, for example:
     * @example
     * flow
     *     .onEach(function* (value) { updateUi(value) })
     *     .onCompletion(function* (cause) { updateUi(cause === null ? 'Done' : 'Failed') }
     *     .catch(function* (cause) { console.error(`Exception: ${cause}`) }
     *     .launchIn(uiScope)
     *
     * Note that the resulting value of launchIn is not used and the provided scope takes care of cancellation.
     * @param {ICoroutineScope} scope
     */
    launchIn(scope: LaunchScope): void

    /**
     * Terminal flow operator that collects the given flow but ignores all emitted values. If any exception occurs
     * during collect or in the provided flow, this exception is rethrown from this method.
     * This operator is usually used with onEach, onCompletion and catch operators to process all emitted values and
     * handle an exception that might occur in the upstream flow or during processing, for example:
     * @example
     * yield* flow
     *     .onEach(function* (value) { process(value) })
     *     .catch(function* (e) { handleException(e) })
     *     .collect() // trigger collection of the flow
     * @param {<T>(value: T) => (void | Coroutine<void>)} [collector]
     */
    collect(collector?: (value: T) => (void | Coroutine<void>)): Coroutine<void>

    /**
     * Terminal flow operator that collects the given flow with a provided action. The crucial difference from collect
     * is that when the original flow emits a new value then the action block for the previous value is cancelled.
     * It can be demonstrated by the following example:
     * @example
     * yield* flow(function* (emit) {
     *     yield* emit(1)
     *     yield* delay(50)
     *     yield* emit(2)
     * }).collectLatest(function* (value) {
     *     console.log(`Collecting ${value}`)
     *     yield* delay(100) // Emulate work
     *     console.log(`${value} collected`)
     * })
     *
     * // prints "Collecting 1, Collecting 2, 2 collected"
     * @param {<T>(value: T) => (void | Coroutine<void>)} collector
     */
    collectLatest(collector: (value: T) => (void | Coroutine<void>)): Coroutine<void>

    /**
     * Collects the flow with a collector.
     * @example
     * yield* flowOf(1, 2, 3)
     *     .collector(function* (collect) {
     *         try {
     *             for (;;) {
     *                 console.log(yield* collect())
     *             }
     *         } catch {}
     *     })
     * @param {<T, R>(collect: () => Coroutine<T>) => Coroutine<R>} collector
     */
    collector<R>(collector: (collect: () => Coroutine<T>) => Coroutine<R>): Coroutine<R>
}
