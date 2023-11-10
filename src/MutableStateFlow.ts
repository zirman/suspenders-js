import { StateFlow } from "./StateFlow.js"

/**
 * MutableStateFlow
 */
export interface MutableStateFlow<T> extends StateFlow<T> {
    set(value: T): void
}
