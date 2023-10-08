import { Flow } from "./Flow.js"

export interface MutableSharedFlow<T> extends Flow<T> {
    emit(value: T): void
}
