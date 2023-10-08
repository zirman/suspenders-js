import { Deferred } from "./Deferred.js"
import { Scope } from "./Scope.js"
import { Coroutine } from "./Types.js"

export interface SubScope extends Scope {
    async<T>(coroutine: () => Coroutine<T>): Deferred<T>
}
