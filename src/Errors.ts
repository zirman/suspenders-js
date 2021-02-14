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
 * Thrown when attempting to emit on an observer that was not observing.
 */
export class FlowEmitError extends Error {
  name = `FlowEmitError`
  message = `Tried to emit on an observer that was not observing.`
}

/**
 * Thrown when attempting to complete on an observer that was not observing.
 */
export class FlowCompleteError extends Error {
  name = `FlowCompleteError`
  message = `Tried to complete on an observer that was not observing.`
}

/**
 * Thrown when attempting to emit or complete a completed flow.
 */
export class FlowHasCompletedError extends Error {
  name = `FlowCompleteError`
  message = `Tried to emit ore complete a completed flow.`
}

/**
 * Thrown when attempting to launch a coroutine in a scope that is finishing.
 */
export class ScopeFinishingError extends Error {
  name = `ScopeFinishingError`
  message = `Tried to launch new coroutine after scope marked as finishing.`
}
