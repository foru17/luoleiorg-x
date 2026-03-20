"use client";

import { useEffect } from "react";
import { dispatchRouteTransitionComplete } from "@/lib/route-transition";

export function RouteTransitionComplete() {
  useEffect(() => {
    dispatchRouteTransitionComplete();
  }, []);

  return null;
}
