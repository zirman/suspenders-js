import { Flow } from "./Flow.js"

/**
 * StateFlow
 */
export interface StateFlow<T> extends Flow<T> {
    get(): T
}
