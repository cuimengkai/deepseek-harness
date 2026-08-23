import { RouterService } from "./router.js";
export { RouterService } from "./router.js";
/** No injected services: the router provides `ctx.router`, it does not consume. */
export const inject = [];
/**
 * Mount the RouterService.
 * @param ctx - client root context.
 */
export function apply(ctx) {
    ctx.plugin(RouterService);
}
//# sourceMappingURL=index.js.map