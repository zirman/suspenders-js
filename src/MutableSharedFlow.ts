import { Flow } from "./Flow.js"

/**
 * MutableSharedFlow
 */
export interface MutableSharedFlow<T> extends Flow<T> {
    emit(value: T): void
}
