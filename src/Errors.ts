/**
 * Thrown when attempting to consume a Flow that has already been consumed.
 */
export class FlowConsumedError extends Error {
  name = `FlowConsumedError`
  message = `This flow can only be consumed once. Use .sharedState() or .sharedEvent() to share flows.`
}

/**
 * Thrown when attempting to remove an observer from a flow was not added first.
 */
export class FlowRemoveObserverError extends Error {
  name = `FlowRemoveObserverError`
  message = `Tried to remove an observer from a flow that was not added first.`
}

/**
 * Thrown when attempting to emit, complete or error on an observer that was not observing.
 */
export class ObserverError extends Error {
  name = `ObserverError`
  message = `Tried to emit, complete or error on an observer that was not observing.`
}

/**
 * Thrown when attempting to emit or complete a completed flow.
 */
export class HasCompletedError extends Error {
  name = `HasCompletedError`
  message = `Tried to emit, complete or error on a completed observer.`
}

/**
 * Thrown when attempting to launch a coroutine in a scope that is finishing.
 */
export class ScopeFinishingError extends Error {
  name = `ScopeFinishingError`
  message = `Tried to launch new coroutine after scope marked as finishing.`
}
