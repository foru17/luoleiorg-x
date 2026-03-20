export const ROUTE_TRANSITION_START_EVENT = "luolei:route-transition-start";
export const ROUTE_TRANSITION_COMPLETE_EVENT = "luolei:route-transition-complete";

interface RouteTransitionDetail {
  href?: string;
}

export function dispatchRouteTransitionStart(detail?: RouteTransitionDetail) {
  if (typeof window === "undefined") return;

  window.dispatchEvent(
    new CustomEvent<RouteTransitionDetail>(ROUTE_TRANSITION_START_EVENT, {
      detail,
    }),
  );
}

export function dispatchRouteTransitionComplete() {
  if (typeof window === "undefined") return;

  window.dispatchEvent(new CustomEvent(ROUTE_TRANSITION_COMPLETE_EVENT));
}
