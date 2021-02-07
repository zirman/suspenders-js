/**
 * Thrown when attempting to consume a Flow that has already been consumed.
 */
export class FlowConsumedError extends Error {
  name = `FlowConsumedError`
  message = `This flow can only be consumed once. Use .sharedState() or .sharedEvent() to share flows.`
}

/**
 * Thrown when attempting to launch a coroutine in a scope that is finishing.
 */
export class ScopeFinishingError extends Error {
  name = `ScopeFinishingError`
  message = `Tried to launch new coroutine after scope marked as finishing.`
}
